# Finexer Integration Setup Guide

Complete guide to deploying and using the Finexer bank integration for Fleet OS Bank First.

---

## ✅ Prerequisites

1. **Supabase Project**: `pitch-bank` (aestjnijiiimduyfpdgt)
2. **Finexer Account**: With API credentials
3. **Supabase CLI**: Installed locally

---

## 📦 Step 1: Database Migration

Already completed! ✅

The migration `008_finexer_integration_fields.sql` has been run successfully.

---

## 🔑 Step 2: Set Environment Variables

### In Supabase Dashboard:

1. Go to **Project Settings** → **Edge Functions** → **Secrets**
2. Add the following secrets:

```bash
FINEXER_API_KEY=your_finexer_api_key_here
FINEXER_WEBHOOK_SECRET=your_webhook_secret_here
APP_URL=https://your-fleet-os-domain.com
```

### Get Your Finexer API Key:

1. Log into Finexer Dashboard
2. Go to **Settings** → **API Keys**
3. Copy your API key

---

## 🚀 Step 3: Deploy Edge Functions

### Install Supabase CLI (if not installed):

```bash
brew install supabase/tap/supabase
```

### Login to Supabase:

```bash
supabase login
```

### Link to Your Project:

```bash
cd "/Users/maxturner/Library/Mobile Documents/com~apple~CloudDocs/Documents/THG/Fleet OS Bank First"
supabase link --project-ref aestjnijiiimduyfpdgt
```

### Deploy All Functions:

```bash
supabase functions deploy finexer-create-consent-link
supabase functions deploy finexer-webhook
supabase functions deploy finexer-sync-accounts
```

---

## 🔗 Step 4: Configure Finexer Webhook

### Get Your Webhook URL:

After deployment, your webhook URL will be:
```
https://aestjnijiiimduyfpdgt.supabase.co/functions/v1/finexer-webhook
```

### Register Webhook in Finexer Dashboard:

1. Log into Finexer Dashboard
2. Go to **Webhooks** → **Create Webhook**
3. **URL**: `https://aestjnijiiimduyfpdgt.supabase.co/functions/v1/finexer-webhook`
4. **Events**: Select these events:
   - `consent.accepted`
   - `consent.canceled`
   - `consent.failed`
   - `bank_account.created`
   - `bank_account.import`
5. **Secret**: Copy the webhook secret and add it to Supabase secrets
6. Click **Create**

---

## 🧪 Step 5: Test the Integration

### Test 1: Create Consent Link

```bash
curl -X POST \
  'https://aestjnijiiimduyfpdgt.supabase.co/functions/v1/finexer-create-consent-link' \
  -H 'Authorization: Bearer YOUR_SUPABASE_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "account_id": 1,
    "return_url": "https://your-app.com/banking/callback"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "consent_url": "https://finexer.com/c/xxxxx",
  "consent_link_id": "cl_xxxxx",
  "connection_id": "uuid",
  "expires_at": "2024-xx-xx"
}
```

### Test 2: Click Consent URL

1. Open the `consent_url` in a browser
2. Select a bank (use sandbox/test bank)
3. Complete authentication
4. You'll be redirected to `return_url`

### Test 3: Check Webhook Received

```sql
-- Run in Supabase SQL Editor
SELECT * FROM finexer_webhook_events 
ORDER BY created_at DESC 
LIMIT 10;
```

### Test 4: Verify Bank Accounts Synced

```sql
SELECT * FROM bank_accounts 
WHERE provider = 'finexer';
```

### Test 5: Verify Transactions Synced

```sql
SELECT * FROM bank_transactions 
WHERE provider = 'finexer'
ORDER BY transaction_date DESC
LIMIT 20;
```

---

## 🎯 Step 6: Frontend Integration

### Add "Connect Bank" Button

In your Fleet OS frontend, add a button that calls the consent link function:

```javascript
async function connectBank(accountId) {
  const response = await fetch(
    'https://aestjnijiiimduyfpdgt.supabase.co/functions/v1/finexer-create-consent-link',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_id: accountId,
        return_url: window.location.origin + '/banking/callback',
      }),
    }
  );

  const data = await response.json();
  
  if (data.success) {
    // Redirect user to Finexer consent page
    window.location.href = data.consent_url;
  } else {
    alert('Error: ' + data.error);
  }
}
```

### Add Callback Page

Create a page at `/banking/callback` that shows:
```html
<h1>✅ Bank Connected Successfully!</h1>
<p>Your bank account has been connected. Syncing transactions...</p>
<button onclick="window.location.href='/banking'">View Transactions</button>
```

### Add Manual Sync Button

```javascript
async function syncBankAccounts(accountId) {
  const response = await fetch(
    'https://aestjnijiiimduyfpdgt.supabase.co/functions/v1/finexer-sync-accounts',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ account_id: accountId }),
    }
  );

  const data = await response.json();
  
  if (data.success) {
    alert(`Synced ${data.synced_accounts} accounts and ${data.synced_transactions} transactions`);
  }
}
```

---

## 📊 Step 7: View Reconciliation Inbox

### Query Unreconciled Transactions

```sql
SELECT 
  bt.transaction_date,
  bt.description,
  bt.merchant_name,
  bt.amount,
  bt.direction,
  ba.account_name,
  r.status as reconciliation_status
FROM bank_transactions bt
JOIN bank_accounts ba ON ba.id = bt.bank_account_id
LEFT JOIN reconciliations r ON r.bank_transaction_id = bt.id
WHERE r.status IN ('new', 'needs_review')
ORDER BY bt.transaction_date DESC;
```

---

## 🔄 Ongoing Operations

### Automatic Sync

Webhooks will automatically sync new transactions when they arrive at the bank.

### Manual Sync

Users can click "Sync Now" button which calls `finexer-sync-accounts` function.

### Scheduled Sync (Optional)

Set up a cron job to sync daily:

```bash
# In Supabase Dashboard → Database → Cron Jobs
SELECT cron.schedule(
  'sync-finexer-daily',
  '0 2 * * *', -- 2 AM daily
  $$
  SELECT net.http_post(
    url := 'https://aestjnijiiimduyfpdgt.supabase.co/functions/v1/finexer-sync-accounts',
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY", "Content-Type": "application/json"}'::jsonb,
    body := '{"account_id": 1}'::jsonb
  );
  $$
);
```

---

## 🐛 Troubleshooting

### Check Function Logs

```bash
supabase functions logs finexer-webhook
supabase functions logs finexer-create-consent-link
supabase functions logs finexer-sync-accounts
```

### Common Issues

**1. "FINEXER_API_KEY environment variable is required"**
- Add API key to Supabase secrets

**2. Webhook not receiving events**
- Check webhook URL is correct
- Verify webhook secret matches
- Check Finexer dashboard for failed deliveries

**3. Transactions not syncing**
- Check consent status: `SELECT * FROM bank_consents WHERE status = 'active'`
- Manually trigger sync
- Check function logs for errors

**4. "Account not found or not connected to Finexer"**
- Ensure consent link was created first
- Check `accounts.finexer_customer_id` is populated

---

## 📝 API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/finexer-create-consent-link` | POST | Generate consent URL for user |
| `/finexer-webhook` | POST | Receive Finexer webhook events |
| `/finexer-sync-accounts` | POST | Manually sync accounts & transactions |

---

## ✅ Checklist

- [ ] Database migration run successfully
- [ ] Environment variables set in Supabase
- [ ] Edge functions deployed
- [ ] Webhook registered in Finexer dashboard
- [ ] Test consent link created
- [ ] Test bank connected
- [ ] Webhook events received
- [ ] Bank accounts synced
- [ ] Transactions synced
- [ ] Frontend "Connect Bank" button added
- [ ] Callback page created
- [ ] Reconciliation inbox working

---

## 🎉 You're Done!

Your Finexer integration is now live. Users can:
1. Click "Connect Bank" button
2. Select their bank
3. Authenticate
4. Automatically sync transactions
5. Reconcile transactions in the inbox

All transactions will flow into the bank-first reconciliation system!
