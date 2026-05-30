# QuickBooks Integration - Quick Setup Guide

Step-by-step instructions to get QuickBooks integration running.

---

## Prerequisites

- ✅ Supabase project created
- ✅ QuickBooks Online account
- ✅ QuickBooks Developer account
- ✅ Netlify account (or deployment platform)

---

## Step 1: Install Dependencies

```bash
cd "Fleet OS"
npm install
```

This installs:
- `@supabase/supabase-js` - Supabase client
- `@netlify/functions` - Netlify Functions SDK
- `typescript` - TypeScript compiler
- `@types/node` - Node.js type definitions

---

## Step 2: Database Migration

1. Open Supabase Dashboard
2. Go to **SQL Editor**
3. Click **New Query**
4. Copy contents of `supabase/migrations/002_quickbooks_integration.sql`
5. Paste and click **Run**

This creates:
- `quickbooks_connections` table
- `financial_accounts` table
- `webhook_events` table
- `notifications` table
- `sync_jobs` table
- `transaction_categories` table
- Enhanced `transactions` table with QB fields

---

## Step 3: Create Storage Bucket

1. Go to Supabase Dashboard → **Storage**
2. Click **New Bucket**
3. Name: `receipts`
4. Settings:
   - **Public**: ❌ No (keep private)
   - **File size limit**: 10MB
   - **Allowed MIME types**: 
     - `image/jpeg`
     - `image/png`
     - `application/pdf`
5. Click **Create Bucket**

---

## Step 4: QuickBooks App Setup

### Create App

1. Go to https://developer.intuit.com/
2. Click **My Apps** → **Create an app**
3. Select **QuickBooks Online and Payments**
4. Name your app (e.g., "Fleet OS Integration")

### Configure App

1. Go to **Keys & OAuth**
2. Copy your **Client ID** and **Client Secret**
3. Under **Redirect URIs**, add:
   ```
   https://your-domain.netlify.app/.netlify/functions/qb-callback
   http://localhost:8888/.netlify/functions/qb-callback
   ```
4. Click **Save**

### Generate Webhook Token

```bash
# Generate a secure random token
openssl rand -base64 32
```

Save this token - you'll need it for environment variables.

---

## Step 5: Environment Variables

### Local Development

Create `.env.local`:

```bash
# Supabase
SUPABASE_URL=https://hnypmigzwfavwcwarmnk.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
SUPABASE_ANON_KEY=your_supabase_anon_key

# QuickBooks OAuth
QB_CLIENT_ID=your_qb_client_id
QB_CLIENT_SECRET=your_qb_client_secret
QB_ENVIRONMENT=sandbox

# QuickBooks Webhook
QB_WEBHOOK_TOKEN=your_generated_webhook_token

# Netlify
URL=http://localhost:8888
```

### Production (Netlify)

1. Go to Netlify Dashboard
2. Select your site
3. Go to **Site settings** → **Environment variables**
4. Add all variables from above (use production values)
5. Set `QB_ENVIRONMENT=production` for live QuickBooks
6. Set `URL=https://your-domain.netlify.app`

---

## Step 6: Deploy to Netlify

### Option A: CLI Deployment

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Deploy
netlify deploy --prod
```

### Option B: GitHub Integration

1. Push code to GitHub
2. Go to Netlify Dashboard
3. Click **Add new site** → **Import an existing project**
4. Connect GitHub and select repository
5. Build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `files`
   - **Functions directory**: `netlify/functions`
6. Add environment variables
7. Click **Deploy site**

---

## Step 7: Configure QuickBooks Webhook

1. Go to Intuit Developer Portal
2. Select your app
3. Go to **Webhooks** tab
4. Click **Add webhook**
5. Enter webhook URL:
   ```
   https://your-domain.netlify.app/.netlify/functions/qb-webhook
   ```
6. Enter your webhook verifier token (from QB_WEBHOOK_TOKEN)
7. Select entities to monitor:
   - ✅ **Purchase**
   - ✅ **Bill**
   - ✅ **Expense**
   - ✅ **Deposit**
   - ✅ **Payment**
   - ✅ **Invoice**
   - ✅ **SalesReceipt**
8. Click **Save**

### Test Webhook

1. Click **Test** button in webhook settings
2. Check Netlify function logs
3. Should see "Webhook received" message

---

## Step 8: Connect QuickBooks in App

1. Open Fleet OS in browser
2. Click **Connect QuickBooks** button
3. Sign in to QuickBooks
4. Grant permissions
5. You'll be redirected back to Fleet OS
6. Connection status should show **Connected**

---

## Step 9: Test Transaction Flow

### Create Test Transaction in QuickBooks

1. Go to QuickBooks Online
2. Click **+ New** → **Expense**
3. Fill in details:
   - **Payee**: Test Vendor
   - **Payment account**: Select a bank account
   - **Amount**: £50.00
   - **Category**: Auto & Vehicle
4. Click **Save and close**

### Verify in Fleet OS

1. Wait 5-10 seconds for webhook
2. Go to **Unassigned Transactions** page
3. Should see new transaction appear
4. Click **Assign** button
5. Select vehicle, category, add notes
6. Click **Assign Transaction**
7. Transaction should move to assigned status

---

## Step 10: Sync Bank Balances

1. In Fleet OS, click **Sync Balances** button
2. Wait for sync to complete
3. Check dashboard - bank balances should update

---

## Verification Checklist

- [ ] Database migration completed successfully
- [ ] Storage bucket `receipts` created
- [ ] QuickBooks app configured with redirect URIs
- [ ] Environment variables set in Netlify
- [ ] Site deployed to Netlify
- [ ] Webhook configured in QuickBooks
- [ ] Webhook test successful
- [ ] QuickBooks connected in Fleet OS
- [ ] Test transaction created and synced
- [ ] Transaction assigned successfully
- [ ] Bank balances synced

---

## Common Issues

### "Invalid signature" error on webhook

**Fix**: Verify QB_WEBHOOK_TOKEN matches in both:
- Netlify environment variables
- QuickBooks webhook settings

### Transactions not appearing

**Fix**: 
1. Check Netlify function logs
2. Check `webhook_events` table for errors
3. Verify entity types are enabled in webhook

### "Token expired" error

**Fix**: Reconnect QuickBooks (tokens auto-refresh, but may need manual reconnect)

### Receipt upload failing

**Fix**: 
1. Verify `receipts` bucket exists
2. Check bucket is private (not public)
3. Verify MIME types are configured

---

## Development Workflow

### Local Testing

```bash
# Start local dev server
npm run dev

# Functions available at:
# http://localhost:8888/.netlify/functions/qb-connect
# http://localhost:8888/.netlify/functions/qb-callback
# http://localhost:8888/.netlify/functions/qb-webhook
# http://localhost:8888/.netlify/functions/qb-sync-balances
```

### Testing Webhooks Locally

Use ngrok to expose local server:

```bash
# Install ngrok
brew install ngrok

# Expose port 8888
ngrok http 8888

# Update QuickBooks webhook URL to ngrok URL
https://abc123.ngrok.io/.netlify/functions/qb-webhook
```

---

## Next Steps

1. **Customize Categories**: Add/edit transaction categories in database
2. **Add Vehicles**: Import or manually add vehicles to assign transactions
3. **Configure Notifications**: Set up email notifications (future)
4. **Schedule Balance Sync**: Set up automated daily sync (future)
5. **Train Users**: Show team how to assign transactions

---

## Support

For detailed documentation, see:
- `QUICKBOOKS_INTEGRATION_GUIDE.md` - Complete technical guide
- `README.md` - General Fleet OS documentation

For issues:
1. Check Netlify function logs
2. Check Supabase logs
3. Review `webhook_events` table
4. Test with QuickBooks sandbox first

---

**Setup Time**: ~30 minutes  
**Difficulty**: Intermediate  
**Prerequisites**: Basic understanding of OAuth, webhooks, and databases
