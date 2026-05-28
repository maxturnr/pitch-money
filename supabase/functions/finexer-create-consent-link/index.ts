// ═══════════════════════════════════════════════════════════
// FINEXER: CREATE CONSENT LINK
// Creates a consent link for a user to connect their bank account
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
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Get authenticated user
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

    // Get request body
    const { account_id, return_url } = await req.json();

    if (!account_id) {
      return new Response(
        JSON.stringify({ error: 'account_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get account details
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

    // Initialize Finexer client
    const finexer = createFinexerClient();

    // Create or get Finexer customer
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

      // Store Finexer customer ID
      await supabaseClient
        .from('accounts')
        .update({ finexer_customer_id: finexerCustomerId })
        .eq('id', account_id);

      console.log('Created Finexer customer:', finexerCustomerId);
    }

    // Create consent link
    console.log('Creating consent link for customer:', finexerCustomerId);
    
    // Finexer requires HTTPS URLs only
    // Use provided return_url if it's HTTPS, otherwise use APP_URL or a placeholder
    let finalReturnUrl = return_url;
    if (!finalReturnUrl || !finalReturnUrl.startsWith('https://')) {
      const appUrl = Deno.env.get('APP_URL') || '';
      finalReturnUrl = appUrl.startsWith('https://') 
        ? `${appUrl}/banking/callback`
        : 'https://example.com/banking/callback'; // Placeholder for local testing
    }
    
    const consentLink = await finexer.createConsentLink({
      customer: finexerCustomerId,
      type: 'multiple', // Allow multiple bank connections
      expiry_days: 90, // Standard UK Open Banking
      retro_days: 730, // 2 years of historical data
      scopes: ['accounts', 'balance', 'transactions'],
      return_url: finalReturnUrl,
      metadata: {
        fleet_os_account_id: account_id.toString(),
        created_by_user_id: user.id,
      },
    });

    console.log('Created consent link:', consentLink.id);

    // Store or update consent link in database
    const { data: connection, error: connectionError } = await supabaseClient
      .from('bank_connections')
      .upsert({
        account_id: account_id,
        provider: 'finexer',
        provider_customer_id: finexerCustomerId,
        provider_connection_id: consentLink.id,
        consent_link_id: consentLink.id,
        consent_link_url: consentLink.redirect?.consent_url,
        consent_link_expires_at: consentLink.expires_at,
        status: 'pending',
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
          hint: connectionError.hint,
          code: connectionError.code,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return consent URL to frontend
    return new Response(
      JSON.stringify({
        success: true,
        consent_url: consentLink.redirect?.consent_url,
        consent_link_id: consentLink.id,
        connection_id: connection.id,
        expires_at: consentLink.expires_at,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error creating consent link:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      name: error.name,
      cause: error.cause,
    });
    
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Internal server error',
        details: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
