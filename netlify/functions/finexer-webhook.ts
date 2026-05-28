import { Handler } from '@netlify/functions';
import { getSupabaseAdmin, normaliseFinexerStatus } from './_finexer';

function resolveWebhookSecret(event: Parameters<Handler>[0]) {
  return (
    event.headers['x-finexer-signature'] ||
    event.headers['x-webhook-secret'] ||
    event.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
    null
  );
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const expectedSecret = process.env.FINEXER_WEBHOOK_SECRET;
    const receivedSecret = resolveWebhookSecret(event);
    if (expectedSecret && receivedSecret !== expectedSecret) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid webhook secret' }) };
    }

    const payload = event.body ? JSON.parse(event.body) : {};
    const eventType = payload.type || payload.event_type || payload.event || 'unknown';
    const providerEventId = payload.id || payload.event_id || payload.webhook_id || null;
    const providerCustomerId = payload.customer || payload.customer_id || payload.data?.customer || payload.data?.customer_id || null;
    const providerConsentId = payload.consent || payload.consent_id || payload.data?.consent || payload.data?.consent_id || null;
    const status = payload.status || payload.data?.status || null;

    const supabase = getSupabaseAdmin();
    let accountId: number | null = null;
    const filters = [
      providerCustomerId ? `provider_customer_id.eq.${providerCustomerId}` : null,
      providerConsentId ? `provider_connection_id.eq.${providerConsentId}` : null,
    ].filter(Boolean) as string[];

    const { data: connection } = filters.length
      ? await supabase
          .from('bank_connections')
          .select('id, account_id')
          .or(filters.join(','))
          .limit(1)
          .maybeSingle()
      : { data: null };

    if (connection?.account_id) {
      accountId = connection.account_id;
    }

    await supabase.from('bank_webhook_events').upsert({
      account_id: accountId,
      provider: 'finexer',
      provider_event_id: providerEventId,
      event_type: eventType,
      event_received_at: new Date().toISOString(),
      payload,
      processed: true,
      processed_at: new Date().toISOString(),
    }, { onConflict: 'provider,provider_event_id' });

    if (connection?.id && status) {
      await supabase
        .from('bank_connections')
        .update({
          status: normaliseFinexerStatus(status),
          last_synced_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', connection.id);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error: any) {
    console.error('Finexer webhook error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
