import { Handler } from '@netlify/functions';
import {
  decodeState,
  extractCollection,
  finexerRequest,
  getRedirectBaseUrl,
  getSupabaseAdmin,
  mapTransactionDirection,
  mapTransactionStatus,
  normaliseFinexerStatus,
} from './_finexer';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const redirectBase = getRedirectBaseUrl();

  try {
    const params = event.queryStringParameters || {};
    const { state, error: providerError, error_description: errorDescription, consent_id: consentIdFromQuery, status } = params;

    if (!state) {
      throw new Error('Missing Finexer state');
    }

    const stateData = decodeState<{
      accountId: number;
      connectionId: string;
      historyDays: number;
      displayName?: string;
      accountType?: string;
    }>(state);

    const supabase = getSupabaseAdmin();
    const { data: connection, error: connectionError } = await supabase
      .from('bank_connections')
      .select('*')
      .eq('id', stateData.connectionId)
      .single();

    if (connectionError || !connection) {
      throw new Error(connectionError?.message || 'Bank connection not found');
    }

    if (providerError) {
      await supabase
        .from('bank_connections')
        .update({
          status: 'error',
          last_error: errorDescription || providerError,
        })
        .eq('id', connection.id);

      return {
        statusCode: 302,
        headers: {
          Location: `${redirectBase}/?finexer_error=${encodeURIComponent(errorDescription || providerError)}`,
        },
        body: '',
      };
    }

    const providerConsentId = consentIdFromQuery || connection.provider_connection_id;
    const providerCustomerId = connection.provider_customer_id;
    let remoteConsent: any = null;

    if (providerConsentId) {
      try {
        remoteConsent = await finexerRequest(`/consents/${providerConsentId}`, { method: 'GET' });
      } catch (error) {
        console.warn('Finexer consent fetch failed:', error);
      }
    }

    const { data: existingConsents } = await supabase
      .from('bank_consents')
      .select('id')
      .eq('bank_connection_id', connection.id)
      .limit(1);

    if (providerConsentId && !existingConsents?.length) {
      await supabase.from('bank_consents').insert({
        account_id: stateData.accountId,
        bank_connection_id: connection.id,
        provider: 'finexer',
        provider_consent_id: providerConsentId,
        status: normaliseFinexerStatus(remoteConsent?.status || status),
        raw_payload: remoteConsent || params,
      });
    } else if (providerConsentId) {
      await supabase
        .from('bank_consents')
        .update({
          status: normaliseFinexerStatus(remoteConsent?.status || status),
          raw_payload: remoteConsent || params,
        })
        .eq('bank_connection_id', connection.id);
    }

    let syncedAccounts = 0;

    if (providerCustomerId) {
      const bankAccountsPayload = await finexerRequest(`/customers/${providerCustomerId}/bank_accounts`, { method: 'GET' });
      const remoteAccounts = extractCollection(bankAccountsPayload);

      for (const remoteAccount of remoteAccounts) {
        const displayName =
          stateData.displayName ||
          remoteAccount.display_name ||
          remoteAccount.name ||
          `${remoteAccount.provider || 'Bank'} ${remoteAccount.class || 'account'}`;

        const bankAccountRecord = {
          account_id: stateData.accountId,
          bank_connection_id: connection.id,
          provider: 'finexer',
          provider_account_id: remoteAccount.id,
          account_name: remoteAccount.name || displayName,
          display_name: displayName,
          account_type: remoteAccount.type || stateData.accountType || null,
          account_subtype: remoteAccount.class || null,
          currency: String(remoteAccount.currency || 'GBP').toUpperCase(),
          masked_account_number: remoteAccount.account_number ? String(remoteAccount.account_number).slice(-4) : null,
          sort_code: remoteAccount.sort_code || null,
          active: true,
          last_feed_sync_at: new Date().toISOString(),
        };

        const { data: localBankAccount, error: bankAccountError } = await supabase
          .from('bank_accounts')
          .upsert(bankAccountRecord, { onConflict: 'provider,provider_account_id' })
          .select()
          .single();

        if (bankAccountError) {
          throw new Error(bankAccountError.message);
        }

        syncedAccounts += 1;

        try {
          const transactionsPayload = await finexerRequest(`/bank_accounts/${remoteAccount.id}/transactions`, { method: 'GET' });
          const transactions = extractCollection(transactionsPayload);
          if (transactions.length) {
            const rows = transactions.map((transaction: any) => {
              const timestamp = transaction.timestamp || transaction.created_at || new Date().toISOString();
              const date = String(timestamp).slice(0, 10);
              return {
                account_id: stateData.accountId,
                bank_account_id: localBankAccount.id,
                provider: 'finexer',
                provider_transaction_id: transaction.id,
                direction: mapTransactionDirection(transaction.type),
                status: mapTransactionStatus(transaction.status),
                amount: Math.abs(Number(transaction.amount || 0)),
                currency: String(transaction.currency || 'GBP').toUpperCase(),
                transaction_date: date,
                booked_at: timestamp,
                value_date: date,
                reference: transaction.reference || null,
                description: transaction.description || transaction.notes || null,
                merchant_name: transaction.merchant || null,
                merchant_category: transaction.category || null,
                counterparty_name: transaction.merchant || null,
                bank_transaction_code: transaction.category || null,
                running_balance: transaction.balance || null,
                raw_payload: transaction,
              };
            });

            await supabase
              .from('bank_transactions')
              .upsert(rows, { onConflict: 'provider,provider_transaction_id' });
          }
        } catch (error) {
          console.warn('Finexer transaction sync skipped:', error);
        }
      }
    }

    await supabase
      .from('bank_connections')
      .update({
        provider_connection_id: providerConsentId || connection.provider_connection_id,
        status: syncedAccounts > 0 ? 'active' : normaliseFinexerStatus(remoteConsent?.status || status),
        last_synced_at: new Date().toISOString(),
        onboarding_complete: syncedAccounts > 0,
        last_error: null,
      })
      .eq('id', connection.id);

    const query = syncedAccounts > 0
      ? '?finexer_connected=true'
      : '?finexer_pending=true';

    return {
      statusCode: 302,
      headers: {
        Location: `${redirectBase}/${query}`,
      },
      body: '',
    };
  } catch (error: any) {
    console.error('Finexer callback error:', error);
    return {
      statusCode: 302,
      headers: {
        Location: `${redirectBase}/?finexer_error=${encodeURIComponent(error.message || 'Unable to finish Finexer connection')}`,
      },
      body: '',
    };
  }
};
