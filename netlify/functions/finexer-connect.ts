import { Handler } from '@netlify/functions';
import {
  encodeState,
  extractConsentId,
  extractConsentUrl,
  finexerRequest,
  getRedirectBaseUrl,
  getSupabaseAdmin,
  normaliseFinexerStatus,
} from './_finexer';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { accountId, historyDays, displayName, accountType } = event.queryStringParameters || {};
    if (!accountId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing accountId parameter' }) };
    }

    const historyWindow = Math.max(30, Math.min(365, Number(historyDays || 90)));
    const requestedHistoryStartDate = new Date();
    requestedHistoryStartDate.setDate(requestedHistoryStartDate.getDate() - historyWindow);

    const supabase = getSupabaseAdmin();
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id, dealer_name, legal_name, trading_name, primary_email, company_email')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      throw new Error(accountError?.message || 'Account not found');
    }

    const { data: priorConnection } = await supabase
      .from('bank_connections')
      .select('id, provider_customer_id')
      .eq('account_id', accountId)
      .eq('provider', 'finexer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const providerCustomerId = priorConnection?.provider_customer_id || null;

    if (!providerCustomerId) {
      throw new Error('No Finexer customer found for this account. Finish onboarding first.');
    }

    const connectionPayload = {
      account_id: account.id,
      provider: 'finexer',
      provider_customer_id: providerCustomerId,
      status: 'pending',
      requested_history_days: historyWindow,
      requested_history_start_date: requestedHistoryStartDate.toISOString().slice(0, 10),
      last_error: null,
    };

    const connectionQuery = priorConnection?.id
      ? supabase
          .from('bank_connections')
          .update(connectionPayload)
          .eq('id', priorConnection.id)
      : supabase
          .from('bank_connections')
          .insert(connectionPayload);

    const { data: connection, error: connectionError } = await connectionQuery
      .select()
      .single();

    if (connectionError || !connection) {
      throw new Error(connectionError?.message || 'Failed to create bank connection');
    }

    const redirectUrl = `${getRedirectBaseUrl()}/.netlify/functions/finexer-callback`;
    const state = encodeState({
      accountId: account.id,
      connectionId: connection.id,
      historyDays: historyWindow,
      displayName: displayName || '',
      accountType: accountType || '',
    });

    const consentPayload = await finexerRequest('/consents', {
      method: 'POST',
      body: {
        customer: providerCustomerId,
        redirect_url: redirectUrl,
        return_url: redirectUrl,
        callback_url: redirectUrl,
        state,
        metadata: {
          account_id: account.id,
          connection_id: connection.id,
          history_days: historyWindow,
          display_name: displayName || null,
          account_type: accountType || null,
        },
      } as any,
    });

    const providerConsentId = extractConsentId(consentPayload);
    const consentUrl = extractConsentUrl(consentPayload);
    if (!consentUrl) {
      throw new Error('Finexer did not return a consent URL');
    }

    await supabase
      .from('bank_connections')
      .update({
        provider_connection_id: providerConsentId,
        status: normaliseFinexerStatus(consentPayload?.status),
        last_error: null,
      })
      .eq('id', connection.id);

    if (providerConsentId) {
      await supabase.from('bank_consents').upsert({
        account_id: account.id,
        bank_connection_id: connection.id,
        provider: 'finexer',
        provider_consent_id: providerConsentId,
        status: 'pending',
        raw_payload: consentPayload,
      }, { onConflict: 'provider,provider_consent_id' });
    }

    return {
      statusCode: 302,
      headers: { Location: consentUrl },
      body: '',
    };
  } catch (error: any) {
    console.error('Finexer connect error:', error);
    const message = encodeURIComponent(error.message || 'Unable to start Finexer connection');
    return {
      statusCode: 302,
      headers: {
        Location: `${getRedirectBaseUrl()}/?finexer_error=${message}`,
      },
      body: '',
    };
  }
};
