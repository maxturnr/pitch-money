# Finexer Integration - Quick Start (5 Minutes)

## 🚀 Deploy in 5 Steps

### 1. Set Secrets (2 min)
```bash
# In Supabase Dashboard → Project Settings → Edge Functions → Secrets
FINEXER_API_KEY=your_api_key_here
FINEXER_WEBHOOK_SECRET=your_webhook_secret
APP_URL=https://your-domain.com
```

### 2. Deploy Functions (1 min)
```bash
cd "/Users/maxturner/Library/Mobile Documents/com~apple~CloudDocs/Documents/THG/Fleet OS Bank First"
supabase link --project-ref aestjnijiiimduyfpdgt
supabase functions deploy finexer-create-consent-link
supabase functions deploy finexer-webhook
supabase functions deploy finexer-sync-accounts
```

### 3. Register Webhook (1 min)
In Finexer Dashboard:
- **URL**: `https://aestjnijiiimduyfpdgt.supabase.co/functions/v1/finexer-webhook`
- **Events**: `consent.accepted`, `consent.canceled`, `bank_account.import`

### 4. Test (1 min)
```bash
curl -X POST \
  'https://aestjnijiiimduyfpdgt.supabase.co/functions/v1/finexer-create-consent-link' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"account_id": 1}'
```

### 5. Add to Frontend (30 sec)
```javascript
// Connect Bank Button
async function connectBank() {
  const res = await fetch('https://aestjnijiiimduyfpdgt.supabase.co/functions/v1/finexer-create-consent-link', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ account_id: 1 }),
  });
  const data = await res.json();
  window.location.href = data.consent_url;
}
```

## ✅ Done!

Users can now connect their banks and transactions will automatically sync.

---

## 📖 Full Documentation

- **Setup Guide**: `FINEXER_INTEGRATION_SETUP.md`
- **Architecture**: `FINEXER_INTEGRATION_SUMMARY.md`
- **Bank First Docs**: `BANK_FIRST_ARCHITECTURE.md`
