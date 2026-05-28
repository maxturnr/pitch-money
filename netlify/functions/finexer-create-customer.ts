import { Handler } from '@netlify/functions';
import {
  extractCustomerId,
  finexerRequest,
  getSupabaseAdmin,
} from './_finexer';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const accountId = body.accountId;

    if (!accountId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing accountId' }) };
    }

    const supabase = getSupabaseAdmin();
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id, dealer_name, legal_name, trading_name, primary_email, company_email')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      throw new Error(accountError?.message || 'Account not found');
    }

    const { data: existingConnection, error: connectionError } = await supabase
      .from('bank_connections')
      .select('id, provider_customer_id')
      .eq('account_id', accountId)
      .eq('provider', 'finexer')
      .limit(1)
      .maybeSingle();

    if (connectionError) {
      throw new Error(connectionError.message);
    }

    if (existingConnection?.provider_customer_id) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          providerCustomerId: existingConnection.provider_customer_id,
          bankConnectionId: existingConnection.id,
          reused: true,
        }),
      };
    }

    const customerPayload = await finexerRequest('/customers', {
      method: 'POST',
      body: {
        name: account.trading_name || account.legal_name || account.dealer_name,
        email: account.company_email || account.primary_email,
        metadata: {
          account_id: account.id,
          source: 'pitch-bank',
        },
      } as any,
    });

    const providerCustomerId = extractCustomerId(customerPayload);
    if (!providerCustomerId) {
      throw new Error('Finexer customer was created but no customer id was returned');
    }

    const connectionPayload = {
      account_id: account.id,
      provider: 'finexer',
      provider_customer_id: providerCustomerId,
      status: 'pending',
      last_error: null,
    };

    const connectionQuery = existingConnection?.id
      ? supabase
          .from('bank_connections')
          .update(connectionPayload)
          .eq('id', existingConnection.id)
      : supabase
          .from('bank_connections')
          .insert(connectionPayload);

    const { data: connection, error: upsertError } = await connectionQuery
      .select('id')
      .single();

    if (upsertError || !connection) {
      throw new Error(upsertError?.message || 'Failed to persist bank connection');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        providerCustomerId,
        bankConnectionId: connection.id,
        reused: false,
      }),
    };
  } catch (error: any) {
    console.error('Finexer create customer error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Unable to create Finexer customer' }),
    };
  }
};
