// ═══════════════════════════════════════════════════════════
// FINEXER: CREATE CONSENT LINK
// Creates a consent for a user to connect their bank account
//
// Flow:
//   1. Frontend calls this with account_id + return_url
//   2. We find/create Finexer customer
//   3. Create consent via POST /consents with scopes + retro_date
//   4. Return consent URL → frontend redirects user to bank auth page
//   5. After user authorizes → bank redirects to return_url
//   6. Webhook fires consent.authorized → triggers sync
// ═══════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createFinexerClient } from '../_shared/finexer-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { account_id, return_url, history_days } = await req.json();

    if (!account_id) {
      return new Response(
        JSON.stringify({ error: 'account_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get account
    const { data: account, error: accountError } = await supabaseClient
      .from('accounts')
      .select('*')
      .eq('id', account_id)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: 'Account not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const finexer = createFinexerClient();

    // ── Find or create Finexer customer ──────────────────────────────
    let finexerCustomerId = account.finexer_customer_id;

    if (!finexerCustomerId) {
      console.log('Creating Finexer customer for account:', account_id);

      const customer = await finexer.createCustomer({
        name: account.dealer_name || account.legal_name || 'Unknown',
        email: account.primary_email || user.email!,
        phone: account.phone,
        currency: account.base_currency?.toLowerCase() || 'gbp',
        metadata: {
          fleet_os_account_id: account_id.toString(),
        },
      });

      finexerCustomerId = customer.id;

      // Store Finexer customer ID on the account
      await supabaseClient
        .from('accounts')
        .update({ finexer_customer_id: finexerCustomerId })
        .eq('id', account_id);

      console.log('Created Finexer customer:', finexerCustomerId);
    }

    // ── Calculate retro_date ─────────────────────────────────────────
    // retro_date is a YYYY-MM-DD string that tells Finexer how far back
    // to pull transaction history. Default 90 days, max ~2 years.
    const historyWindow = Math.max(30, Math.min(730, Number(history_days || 365)));
    const retroDate = new Date();
    retroDate.setDate(retroDate.getDate() - historyWindow);
    const retroDateStr = retroDate.toISOString().slice(0, 10);

    // ── Build return URL ─────────────────────────────────────────────
    // Finexer requires HTTPS return URLs
    let finalReturnUrl = return_url;
    if (!finalReturnUrl || !finalReturnUrl.startsWith('https://')) {
      const appUrl = Deno.env.get('APP_URL') || '';
      finalReturnUrl = appUrl.startsWith('https://')
        ? `${appUrl}/banking/callback`
        : 'https://example.com/banking/callback';
    }

    // ── Create consent ───────────────────────────────────────────────
    // POST /consents (form-encoded)
    // • customer — Finexer customer ID
    // • scopes[] — CRITICAL: accounts, balance, transactions
    // • return_url — where Finexer redirects user after bank auth
    // • retro_date — YYYY-MM-DD, how far back to pull history
    console.log('Creating consent for customer:', finexerCustomerId);

    const consent = await finexer.createConsent({
      customer: finexerCustomerId,
      scopes: ['accounts', 'balance', 'transactions'],
      return_url: finalReturnUrl,
      retro_date: retroDateStr,
      metadata: {
        fleet_os_account_id: account_id.toString(),
        created_by_user_id: user.id,
      },
    });

    console.log('Created consent:', consent.id);

    // Extract consent URL — path is response.redirect.consent_url
    const consentUrl = consent?.redirect?.consent_url;
    if (!consentUrl) {
      console.error('Finexer consent response:', JSON.stringify(consent));
      throw new Error('Finexer did not return a consent URL');
    }

    // ── Store connection in DB ───────────────────────────────────────
    const { data: connection, error: connectionError } = await supabaseClient
      .from('bank_connections')
      .upsert({
        account_id: account_id,
        provider: 'finexer',
        provider_customer_id: finexerCustomerId,
        provider_connection_id: consent.id,
        consent_link_id: consent.id,
        consent_link_url: consentUrl,
        consent_link_expires_at: consent.expires_at,
        status: 'pending',
        last_error: null,
      }, {
        onConflict: 'account_id,provider',
      })
      .select()
      .single();

    if (connectionError) {
      console.error('Error storing connection:', connectionError);
      return new Response(
        JSON.stringify({
          error: `Database error: ${connectionError.message || 'Failed to store connection'}`,
          details: connectionError,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Store consent record (optional — table may not exist in older schemas)
    try {
      await supabaseClient
        .from('bank_consents')
        .upsert({
          account_id: account_id,
          bank_connection_id: connection.id,
          provider: 'finexer',
          provider_consent_id: consent.id,
          finexer_consent_id: consent.id,
          status: 'pending',
          expires_at: consent.expires_at,
          raw_payload: consent,
        }, {
          onConflict: 'provider,provider_consent_id',
        });
    } catch (_) {
      // bank_consents table may not exist — connection record is sufficient
      console.log('bank_consents table not available, skipping');
    }

    return new Response(
      JSON.stringify({
        success: true,
        consent_url: consentUrl,
        consent_id: consent.id,
        connection_id: connection.id,
        expires_at: consent.expires_at,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Error creating consent:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
