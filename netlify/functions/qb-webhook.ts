import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';
import { quickbooksService } from '../../services/quickbooks';
import type { QuickBooksWebhookPayload } from '../../types/quickbooks';

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const signature = event.headers['intuit-signature'];
    const body = event.body;

    if (!body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Empty request body' }),
      };
    }

    if (!verifyWebhookSignature(body, signature)) {
      console.error('Invalid webhook signature');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' }),
      };
    }

    const payload: QuickBooksWebhookPayload = JSON.parse(body);

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    for (const notification of payload.eventNotifications) {
      const realmId = notification.realmId;

      const { data: connection } = await supabase
        .from('quickbooks_connections')
        .select('account_id')
        .eq('realm_id', realmId)
        .eq('is_active', true)
        .single();

      if (!connection) {
        console.log(`No active connection found for realm ${realmId}`);
        continue;
      }

      const accountId = connection.account_id;

      for (const entity of notification.dataChangeEvent.entities) {
        const webhookEventId = await saveWebhookEvent(
          supabase,
          accountId,
          realmId,
          entity,
          payload
        );

        if (shouldProcessEntity(entity.name)) {
          try {
            await quickbooksService.processTransaction(
              accountId,
              entity.name,
              entity.id
            );

            await supabase
              .from('webhook_events')
              .update({
                processed: true,
                processed_at: new Date().toISOString(),
              })
              .eq('id', webhookEventId);
          } catch (error: any) {
            console.error(`Failed to process entity ${entity.name}:${entity.id}`, error);

            await supabase
              .from('webhook_events')
              .update({
                error_message: error.message,
                retry_count: 1,
              })
              .eq('id', webhookEventId);
          }
        } else {
          await supabase
            .from('webhook_events')
            .update({
              processed: true,
              processed_at: new Date().toISOString(),
            })
            .eq('id', webhookEventId);
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error: any) {
    console.error('Webhook processing error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

function verifyWebhookSignature(payload: string, signature?: string): boolean {
  if (!signature) {
    return false;
  }

  const webhookToken = process.env.QB_WEBHOOK_TOKEN;
  if (!webhookToken) {
    console.error('QB_WEBHOOK_TOKEN not configured');
    return false;
  }

  const hash = createHmac('sha256', webhookToken)
    .update(payload)
    .digest('base64');

  return hash === signature;
}

async function saveWebhookEvent(
  supabase: any,
  accountId: number,
  realmId: string,
  entity: any,
  fullPayload: any
): Promise<string> {
  const { data, error } = await supabase
    .from('webhook_events')
    .insert({
      account_id: accountId,
      event_type: 'dataChangeEvent',
      realm_id: realmId,
      entity_name: entity.name,
      entity_id: entity.id,
      operation: entity.operation,
      payload: fullPayload,
      processed: false,
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to save webhook event: ${error.message}`);
  }

  return data.id;
}

function shouldProcessEntity(entityName: string): boolean {
  const supportedEntities = [
    'Purchase',
    'Expense',
    'Bill',
    'Deposit',
    'Payment',
    'Invoice',
    'SalesReceipt',
  ];

  return supportedEntities.includes(entityName);
}
