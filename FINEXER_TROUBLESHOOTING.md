# Finexer Bank Integration Troubleshooting Guide

## Issue: Bank accounts not showing after consent link completion

### Step 1: Run Database Migration

**CRITICAL**: You must run this SQL migration first in Supabase SQL Editor:

```sql
-- Open Supabase Dashboard → SQL Editor → New Query
-- Copy and paste the contents of: files/ADD_FINEXER_BANK_INTEGRATION.sql
-- Click "Run" to execute
```

This creates the required tables and columns:
- `bank_connections` table
- `bank_transactions` table  
- `reconciliations` table
- Adds Finexer columns to `bank_accounts` table
- Adds `finexer_customer_id` to `accounts` table

### Step 2: Verify Database Schema

Run this query to check if tables exist:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('bank_connections', 'bank_accounts', 'bank_transactions', 'reconciliations');
```

You should see all 4 tables listed.

### Step 3: Check Bank Connection Status

```sql
SELECT * FROM bank_connections WHERE account_id = YOUR_ACCOUNT_ID;
```

You should see a row with:
- `status = 'active'` or `'pending'`
- `provider_customer_id` populated
- `provider_connection_id` populated

### Step 4: Test Manual Sync

1. Open the app in your browser
2. Go to Bank Accounts page
3. Open browser DevTools (F12 or Cmd+Option+I)
4. Go to Console tab
5. Click the "🔄 Sync Now" button
6. Watch the console for errors

### Step 5: Check Supabase Edge Function Logs

1. Go to Supabase Dashboard → Edge Functions
2. Click on `finexer-sync-accounts`
3. Click "Logs" tab
4. Look for recent invocations and any errors

Common errors:
- **"Account not found or not connected to Finexer"** → No `finexer_customer_id` in accounts table
- **"Bank connection not found"** → No row in `bank_connections` table
- **Column does not exist** → Migration not run

### Step 6: Manual Sync via Edge Function

If the button doesn't work, you can test the Edge Function directly:

```bash
curl -X POST \
  https://hnypmigzwfavwcwarmnk.supabase.co/functions/v1/finexer-sync-accounts \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"account_id": YOUR_ACCOUNT_ID}'
```

Replace:
- `YOUR_ACCESS_TOKEN` with your Supabase session token (from browser DevTools → Application → Local Storage)
- `YOUR_ACCOUNT_ID` with your account ID

### Step 7: Check Finexer API Response

Look at the Edge Function logs for the Finexer API response. It should show:

```json
{
  "data": [
    {
      "id": "acc_xxx",
      "nickname": "Current Account",
      "holder_name": "John Doe",
      "type": "current",
      "currency": "gbp",
      "identification": {
        "account_number": "12345678",
        "sort_code": "12-34-56"
      }
    }
  ]
}
```

### Step 8: Verify Data in Database

After sync, check if accounts were inserted:

```sql
SELECT 
  id,
  account_name,
  account_type,
  account_number,
  sort_code,
  current_balance,
  provider,
  finexer_account_id
FROM bank_accounts 
WHERE account_id = YOUR_ACCOUNT_ID;
```

### Step 9: Check Frontend Data Loading

In browser console, check if data is loaded:

```javascript
// Check if bankAccounts array has data
console.log('Bank Accounts:', bankAccounts);

// Force reload
await loadAll(true);
```

## Common Issues & Solutions

### Issue: "No Finexer connection found"
**Solution**: Complete the consent flow again by clicking "+ Add Bank Account"

### Issue: Accounts sync but don't display
**Solution**: 
1. Check browser console for JavaScript errors
2. Verify `renderBankAccounts()` is being called
3. Check if `bankAccounts` array is populated

### Issue: "Column does not exist" error
**Solution**: Run the migration SQL file (`ADD_FINEXER_BANK_INTEGRATION.sql`)

### Issue: Consent link expires
**Solution**: Consent links expire after 90 days. Create a new one.

### Issue: Balance shows as £0.00
**Solution**: 
- Finexer may not have balance data yet
- Try clicking "Sync Now" after a few minutes
- Check if `balance_as_of` field is populated

## Testing Checklist

- [ ] Database migration run successfully
- [ ] `bank_connections` table has a row for your account
- [ ] `accounts` table has `finexer_customer_id` populated
- [ ] Edge Function `finexer-sync-accounts` deploys without errors
- [ ] Edge Function `finexer-create-consent-link` deploys without errors
- [ ] Consent flow completes and redirects back to app
- [ ] "Sync Now" button triggers sync without errors
- [ ] Bank accounts appear in the table
- [ ] Account details show: name, type, balance, account number, sort code

## Debug Mode

To enable detailed logging, add this to browser console:

```javascript
// Enable debug mode
localStorage.setItem('debug_finexer', 'true');

// Then reload and try sync
location.reload();
```

## Contact Support

If issues persist, provide:
1. Screenshot of browser console errors
2. Screenshot of Supabase Edge Function logs
3. Result of Step 3 SQL query (bank_connections check)
4. Result of Step 8 SQL query (bank_accounts check)
