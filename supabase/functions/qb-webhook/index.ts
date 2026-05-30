import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const QB_WEBHOOK_TOKEN = Deno.env.get('QB_WEBHOOK_TOKEN') || ''

serve(async (req) => {
  // CORS headers
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'intuit-signature, content-type',
      }
    })
  }

  try {
    const signature = req.headers.get('intuit-signature')
    const payload = await req.text()
    
    // Verify webhook signature (QuickBooks sends this for security)
    // In production, you'd verify the signature matches
    
    const webhookData = JSON.parse(payload)
    console.log('QB Webhook received:', webhookData)
    
    // Process webhook events
    const eventNotifications = webhookData.eventNotifications || []
    
    for (const event of eventNotifications) {
      const realmId = event.realmId
      const dataChangeEvent = event.dataChangeEvent
      
      if (!dataChangeEvent || !dataChangeEvent.entities) continue
      
      // Get account_id from realm_id
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      const { data: settings } = await supabase
        .from('settings')
        .select('account_id')
        .eq('key', 'qb_realm_id')
        .eq('value', realmId)
        .single()
      
      if (!settings) continue
      
      const accountId = settings.account_id
      
      // Process each entity change
      for (const entity of dataChangeEvent.entities) {
        const entityName = entity.name
        const operation = entity.operation
        const entityId = entity.id
        
        console.log(`${operation} on ${entityName} (ID: ${entityId})`)
        
        // Handle different entity types
        if (entityName === 'Purchase' && operation === 'Create') {
          // New transaction created in QB - could trigger a sync
          console.log('New purchase detected - consider syncing')
        }
        
        if (entityName === 'Account' && operation === 'Create') {
          // New bank account created in QB
          console.log('New account detected - consider syncing')
        }
      }
    }
    
    return new Response(
      JSON.stringify({ success: true, processed: eventNotifications.length }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )

  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }
})
