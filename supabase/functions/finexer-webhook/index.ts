// ═══════════════════════════════════════════════════════════
// FINEXER: WEBHOOK HANDLER
// Receives and processes webhook events from Finexer
// ═══════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createFinexerClient } from '../_shared/finexer-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify webhook signature from Finexer
    const signature = req.headers.get('x-finexer-signature');
    const webhookSecret = Deno.env.get('FINEXER_WEBHOOK_SECRET');
    
    // Basic security: verify webhook secret if provided
    if (webhookSecret && signature) {
      // TODO: Implement proper HMAC signature verification
      console.log('Webhook signature received:', signature);
    } else {
      console.log('Warning: Webhook received without signature verification');
    }

    // Parse webhook payload
    const payload = await req.json();
    console.log('Received webhook event:', payload.type);

    // Initialize Supabase client (service role for webhook processing)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Store webhook event for audit
    const { error: webhookError } = await supabaseClient
      .from('finexer_webhook_events')
      .insert({
        event_id: payload.id,
        event_type: payload.type,
        payload: payload,
        processed: false,
      });

    if (webhookError) {
      console.error('Error storing webhook event:', webhookError);
    }

    // TEMPORARILY DISABLED - webhook processing turned off to prevent rate limiting
    // Just log the event and return success
    console.log('Webhook received (processing disabled):', payload.type);
    
    // Process event based on type
    // switch (payload.type) {
    //   case 'consent.accepted':
    //   case 'consent.authorized':
    //     await handleConsentAccepted(supabaseClient, payload);
    //     break;
    //   
    //   case 'consent.canceled':
    //   case 'consent.failed':
    //     await handleConsentFailed(supabaseClient, payload);
    //     break;
    //   
    //   case 'bank_account.created':
    //   case 'bank_account.synced':
    //     await handleBankAccountCreated(supabaseClient, payload);
    //     break;
    //   
    //   case 'bank_account.import':
    //   case 'bank_account.updated':
    //   case 'transaction.created':
    //   case 'transaction.updated':
    //     await handleBankAccountImport(supabaseClient, payload);
    //     break;
    //   
    //   default:
    //     console.log('Unhandled event type:', payload.type);
    // }

    // Mark webhook as processed
    await supabaseClient
      .from('finexer_webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('event_id', payload.id);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Webhook processing error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ═══════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════

async function handleConsentAccepted(supabase: any, payload: any) {
  console.log('Processing consent.accepted event');
  
  const consent = payload.data.object;
  const finexerCustomerId = consent.customer;
  
  // Find the account by Finexer customer ID
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('finexer_customer_id', finexerCustomerId)
    .single();
  
  if (!account) {
    console.error('Account not found for Finexer customer:', finexerCustomerId);
    return;
  }

  // Update bank connection status
  await supabase
    .from('bank_connections')
    .update({
      status: 'active',
      last_synced_at: new Date().toISOString(),
    })
    .eq('account_id', account.id)
    .eq('provider_customer_id', finexerCustomerId);

  // Store consent details
  await supabase
    .from('bank_consents')
    .insert({
      account_id: account.id,
      bank_connection_id: (await supabase
        .from('bank_connections')
        .select('id')
        .eq('account_id', account.id)
        .eq('provider_customer_id', finexerCustomerId)
        .single()).data?.id,
      provider: 'finexer',
      provider_consent_id: consent.id,
      finexer_consent_id: consent.id,
      status: 'active',
      granted_at: consent.authed_at,
      expires_at: consent.expiry_date,
      raw_payload: consent,
    });

  console.log('Consent accepted and stored');

  // Trigger initial sync
  await syncBankAccounts(supabase, account.id, finexerCustomerId);
}

async function handleConsentFailed(supabase: any, payload: any) {
  console.log('Processing consent failed/canceled event');
  
  const consent = payload.data.object;
  const finexerCustomerId = consent.customer;
  
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('finexer_customer_id', finexerCustomerId)
    .single();
  
  if (!account) return;

  // Update connection status
  await supabase
    .from('bank_connections')
    .update({
      status: payload.type === 'consent.canceled' ? 'revoked' : 'error',
      last_error: consent.failure_message || 'Consent failed',
    })
    .eq('account_id', account.id)
    .eq('provider_customer_id', finexerCustomerId);
}

async function handleBankAccountCreated(supabase: any, payload: any) {
  console.log('Processing bank_account.created/synced event');
  
  const bankAccount = payload.data.object;
  const finexerCustomerId = bankAccount.customer;
  
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('finexer_customer_id', finexerCustomerId)
    .single();
  
  if (!account) return;

  // Trigger transaction sync for this bank account
  await syncTransactions(supabase, account.id, bankAccount.id);
}

async function handleBankAccountImport(supabase: any, payload: any) {
  console.log('Processing bank_account.import event');
  
  const bankAccount = payload.data.object;
  const finexerCustomerId = bankAccount.customer;
  
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('finexer_customer_id', finexerCustomerId)
    .single();
  
  if (!account) return;

  // Trigger transaction sync for this bank account (includes balance update)
  await syncTransactions(supabase, account.id, bankAccount.id);
}

// ═══════════════════════════════════════════════════════════
// SYNC FUNCTIONS
// ═══════════════════════════════════════════════════════════

async function syncBankAccounts(supabase: any, accountId: number, finexerCustomerId: string) {
  console.log('Syncing bank accounts for customer:', finexerCustomerId);
  
  const finexer = createFinexerClient();
  
  // Fetch bank accounts from Finexer
  const response = await finexer.listBankAccounts({ customer: finexerCustomerId });
  const bankAccounts = response.data || [];

  console.log(`Found ${bankAccounts.length} bank accounts`);

  // Get bank connection ID
  const { data: connection } = await supabase
    .from('bank_connections')
    .select('id')
    .eq('account_id', accountId)
    .eq('provider_customer_id', finexerCustomerId)
    .single();

  if (!connection) return;

  // Store each bank account
  for (const ba of bankAccounts) {
    // Fetch balance
    let balance = null;
    try {
      const balanceData = await finexer.getBankAccountBalance(ba.id);
      balance = balanceData.data?.[0]?.current || null;
    } catch (error) {
      console.error('Error fetching balance for account:', ba.id, error);
    }

    // Upsert bank account
    await supabase
      .from('bank_accounts')
      .upsert({
        account_id: accountId,
        bank_connection_id: connection.id,
        provider: 'finexer',
        provider_account_id: ba.id,
        finexer_account_id: ba.id,
        account_name: ba.holder_name || ba.nickname || 'Unknown Account',
        display_name: ba.nickname,
        account_type: ba.type,
        account_subtype: ba.class,
        account_class: ba.class,
        currency: ba.currency?.toUpperCase() || 'GBP',
        masked_account_number: ba.identification?.account_number?.slice(-4),
        sort_code: ba.identification?.sort_code,
        holder_name: ba.holder_name,
        nickname: ba.nickname,
        fingerprint: ba.fingerprint,
        current_balance: balance,
        balance_as_of: balance ? new Date().toISOString() : null,
      }, {
        onConflict: 'provider_account_id',
      });

    console.log('Stored bank account:', ba.id);

    // Sync transactions for this account
    await syncTransactions(supabase, accountId, ba.id);
  }
}

async function syncTransactions(supabase: any, accountId: number, finexerBankAccountId: string) {
  console.log('Syncing transactions for bank account:', finexerBankAccountId);
  
  const finexer = createFinexerClient();

  // Get our bank account record
  const { data: bankAccount } = await supabase
    .from('bank_accounts')
    .select('id')
    .eq('finexer_account_id', finexerBankAccountId)
    .single();

  if (!bankAccount) {
    console.error('Bank account not found:', finexerBankAccountId);
    return;
  }

  // Fetch transactions (last 90 days)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const response = await finexer.listTransactions(finexerBankAccountId, {
    'timestamp.gte': ninetyDaysAgo.toISOString().split('T')[0],
  });

  const transactions = response.data?.[0] || [];
  console.log(`Found ${transactions.length} transactions`);

  // Store each transaction
  for (const txn of transactions) {
    // Check if transaction already exists
    const { data: existing } = await supabase
      .from('bank_transactions')
      .select('id')
      .eq('finexer_transaction_id', txn.id)
      .single();

    if (existing) {
      console.log('Transaction already exists:', txn.id);
      continue;
    }

    // Insert new transaction
    await supabase
      .from('bank_transactions')
      .insert({
        account_id: accountId,
        bank_account_id: bankAccount.id,
        provider: 'finexer',
        provider_transaction_id: txn.id,
        finexer_transaction_id: txn.id,
        direction: txn.type === 'debit' ? 'out' : 'in',
        status: txn.status === 'booked' ? 'booked' : 'pending',
        amount: Math.abs(txn.amount),
        currency: txn.currency?.toUpperCase() || 'GBP',
        transaction_date: txn.timestamp?.split('T')[0],
        booked_at: txn.status === 'booked' ? txn.timestamp : null,
        reference: txn.reference,
        description: txn.description,
        merchant_name: txn.merchant,
        category: txn.category,
        running_balance: txn.balance,
        raw_payload: txn,
      });

    // Create reconciliation record
    await supabase
      .from('reconciliations')
      .insert({
        account_id: accountId,
        bank_transaction_id: (await supabase
          .from('bank_transactions')
          .select('id')
          .eq('finexer_transaction_id', txn.id)
          .single()).data?.id,
        status: 'new',
      });

    console.log('Stored transaction:', txn.id);
  }

  // Update bank account balance after syncing transactions
  await updateBankAccountBalance(supabase, finexerBankAccountId);
}

async function updateBankAccountBalance(supabase: any, finexerBankAccountId: string) {
  console.log('Updating balance for bank account:', finexerBankAccountId);
  
  const finexer = createFinexerClient();
  
  try {
    // Fetch current balance from Finexer
    const balanceData = await finexer.getBankAccountBalance(finexerBankAccountId);
    const balance = balanceData.data?.[0]?.current || null;
    
    if (balance !== null) {
      // Update bank account with new balance
      await supabase
        .from('bank_accounts')
        .update({
          current_balance: balance,
          balance_as_of: new Date().toISOString(),
        })
        .eq('finexer_account_id', finexerBankAccountId);
      
      console.log('Updated balance:', balance);
    }
  } catch (error) {
    console.error('Error updating balance:', error);
  }
}
