// ═══════════════════════════════════════════════════════════
// FINEXER: WEBHOOK HANDLER
// Receives and processes webhook events from Finexer.
//
// Valid Finexer events:
//   • consent.authorized — user authorized bank access → sync
//   • bank_account.created — new bank account imported → sync
//   • consent.canceled / consent.expired / consent.failed
//   • reminder.consent_expiry.sent
//
// NOTE: There is NO transaction.created webhook. Real-time
// transaction updates require periodic sync (finexer-sync-accounts).
// ═══════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  createFinexerClient,
  mapTransactionDirection,
  mapTransactionStatus,
  parseMerchantName,
  parseTransactionDate,
} from '../_shared/finexer-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const signature = req.headers.get('x-finexer-signature');
    const webhookSecret = Deno.env.get('FINEXER_WEBHOOK_SECRET');
    if (webhookSecret && signature && signature !== webhookSecret) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers: corsHeaders });
    }

    const payload = await req.json();
    const eventType: string = payload.type || 'unknown';
    const eventId: string = payload.id || crypto.randomUUID();
    console.log('Webhook received:', eventType, eventId);

    // Service role client for webhook processing
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Log event
    await supabase.from('finexer_webhook_events').upsert({
      event_id: eventId,
      event_type: eventType,
      payload,
      processed: false,
    }, { onConflict: 'event_id' }).then(() => {}).catch(() => {});

    // Also log to bank_webhook_events if it exists
    await supabase.from('bank_webhook_events').upsert({
      provider: 'finexer',
      provider_event_id: eventId,
      event_type: eventType,
      event_received_at: new Date().toISOString(),
      payload,
      processed: false,
    }, { onConflict: 'provider,provider_event_id' }).then(() => {}).catch(() => {});

    const eventData = payload.data || {};
    const customerId = eventData.customer || null;

    // Find account by Finexer customer ID
    let accountId: number | null = null;
    let connectionId: string | null = null;
    if (customerId) {
      const { data: acct } = await supabase
        .from('accounts')
        .select('id')
        .eq('finexer_customer_id', customerId)
        .single();
      if (acct) accountId = acct.id;

      const { data: conn } = await supabase
        .from('bank_connections')
        .select('id')
        .eq('provider_customer_id', customerId)
        .eq('provider', 'finexer')
        .limit(1)
        .maybeSingle();
      if (conn) connectionId = conn.id;
    }

    // ── Process by event type ────────────────────────────────────────
    switch (eventType) {
      case 'consent.authorized': {
        if (connectionId) {
          await supabase.from('bank_connections')
            .update({ status: 'active', last_error: null, last_synced_at: new Date().toISOString() })
            .eq('id', connectionId);
          await supabase.from('bank_consents')
            .update({ status: 'active' })
            .eq('bank_connection_id', connectionId);
        }
        // Sync all accounts + transactions
        if (accountId && customerId) {
          await syncAllForCustomer(supabase, accountId, customerId, connectionId);
        }
        break;
      }

      case 'bank_account.created': {
        if (accountId && customerId && eventData.object === 'bank_account') {
          await syncAllForCustomer(supabase, accountId, customerId, connectionId);
        }
        break;
      }

      case 'consent.canceled':
      case 'consent.expired':
      case 'consent.failed': {
        if (connectionId) {
          const status = eventType === 'consent.failed' ? 'error' : 'revoked';
          await supabase.from('bank_connections')
            .update({ status, last_error: `Consent ${eventType.split('.')[1]}` })
            .eq('id', connectionId);
          await supabase.from('bank_consents')
            .update({ status: status === 'error' ? 'rejected' : 'revoked' })
            .eq('bank_connection_id', connectionId);
        }
        break;
      }

      case 'reminder.consent_expiry.sent': {
        console.log('Consent expiry reminder for account:', accountId);
        break;
      }

      default:
        console.log('Unhandled event:', eventType);
    }

    // Mark processed
    await supabase.from('finexer_webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('event_id', eventId);
    await supabase.from('bank_webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('provider', 'finexer').eq('provider_event_id', eventId);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ─── Sync helper (used by webhook) ──────────────────────────────────────

async function syncAllForCustomer(
  supabase: any, accountId: number, customerId: string, connectionId: string | null
) {
  try {
    const finexer = createFinexerClient();
    const bankAccounts = await finexer.listAllBankAccounts({ customer: customerId });

    for (const ba of bankAccounts) {
      try {
        const displayName = ba.nickname || ba.holder_name || `${ba.provider || 'Bank'} Account`;

        const { data: localAccount } = await supabase
          .from('bank_accounts')
          .upsert({
            account_id: accountId,
            bank_connection_id: connectionId,
            provider: 'finexer',
            provider_account_id: ba.id,
            finexer_account_id: ba.id,
            account_name: ba.holder_name || displayName,
            display_name: displayName,
            account_type: ba.type, account_subtype: ba.class, account_class: ba.class,
            currency: (ba.currency || 'GBP').toUpperCase(),
            masked_account_number: ba.identification?.account_number?.slice(-4),
            sort_code: ba.identification?.sort_code,
            holder_name: ba.holder_name, nickname: ba.nickname, fingerprint: ba.fingerprint,
            active: true, last_feed_sync_at: new Date().toISOString(),
          }, { onConflict: 'provider,provider_account_id' })
          .select('id').single();

        if (!localAccount?.id) continue;

        // Sync + pull transactions
        await finexer.syncBankAccountAndWait(ba.id, 45_000);
        const txns = await finexer.listAllTransactions(ba.id);

        if (txns.length > 0) {
          for (let i = 0; i < txns.length; i += 500) {
            const rows = txns.slice(i, i + 500).map((txn: any) => ({
              account_id: accountId,
              bank_account_id: localAccount.id,
              provider: 'finexer',
              provider_transaction_id: txn.id,
              finexer_transaction_id: txn.id,
              direction: mapTransactionDirection(txn.type),
              status: mapTransactionStatus(txn.status),
              amount: Math.abs(Number(txn.amount || 0)),
              currency: (txn.currency || 'GBP').toUpperCase(),
              transaction_date: parseTransactionDate(txn),
              booked_at: txn.status === 'booked' ? txn.timestamp : null,
              reference: txn.reference, description: txn.description,
              merchant_name: parseMerchantName(txn),
              category: txn.category,
              running_balance: txn.balance != null ? Number(txn.balance) : null,
              raw_payload: txn,
            }));
            await supabase.from('bank_transactions')
              .upsert(rows, { onConflict: 'provider,provider_transaction_id' });
          }
        }

        // Balance
        try {
          const bal = await finexer.getBankAccountBalance(ba.id);
          const b = bal?.data?.[0];
          if (b) {
            await supabase.from('bank_accounts').update({
              current_balance: b.current, available_balance: b.available,
              balance_as_of: new Date().toISOString(),
            }).eq('id', localAccount.id);
          }
        } catch (_) {}

        console.log(`Webhook synced ${txns.length} txns for ${ba.id}`);
      } catch (err: any) {
        console.error(`Sync error for ${ba.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('syncAllForCustomer error:', err.message);
  }
}
