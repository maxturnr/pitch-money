# QuickBooks Online Integration Guide

Complete guide for integrating QuickBooks Online with Fleet OS for automatic transaction syncing and bank balance management.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Setup Instructions](#setup-instructions)
4. [Database Schema](#database-schema)
5. [API Endpoints](#api-endpoints)
6. [Webhook Configuration](#webhook-configuration)
7. [Transaction Flow](#transaction-flow)
8. [User Workflow](#user-workflow)
9. [Troubleshooting](#troubleshooting)
10. [Security Considerations](#security-considerations)

---

## Overview

This integration enables Fleet OS to:

- **Automatically sync transactions** from QuickBooks Online via webhooks
- **Sync bank account balances** on demand or scheduled
- **Allow users to assign transactions** to vehicles, categories, and add receipts
- **Maintain QuickBooks as the source of truth** for accounting
- **Provide operational finance layer** on top of accounting data

### Key Features

✅ OAuth2 authentication with QuickBooks  
✅ Real-time webhook notifications  
✅ Automatic token refresh  
✅ Idempotent transaction processing  
✅ Receipt/invoice upload to Supabase Storage  
✅ In-app notifications for unassigned transactions  
✅ Bank balance synchronization  
✅ Support for multiple transaction types  

---

## Architecture

```
┌─────────────────┐
│  QuickBooks     │
│  Online         │
└────────┬────────┘
         │
         │ Webhook
         ▼
┌─────────────────┐      ┌──────────────┐
│  Netlify        │      │  Supabase    │
│  Functions      │◄────►│  PostgreSQL  │
│                 │      │  Storage     │
└────────┬────────┘      └──────────────┘
         │
         │ API
         ▼
┌─────────────────┐
│  Fleet OS       │
│  Web App        │
└─────────────────┘
```

### Components

1. **QuickBooks OAuth Flow** - Secure connection setup
2. **Webhook Handler** - Receives and processes QB events
3. **Transaction Service** - Normalizes and stores transactions
4. **Balance Sync** - Fetches current bank balances
5. **Assignment UI** - User interface for transaction management
6. **Storage** - Receipt and invoice file uploads

---

## Setup Instructions

### 1. QuickBooks Developer Account

1. Go to https://developer.intuit.com/
2. Sign in or create an account
3. Create a new app or use existing
4. Note your **Client ID** and **Client Secret**

### 2. Configure Redirect URIs

Add these URLs to your QuickBooks app settings:

**Production:**
```
https://your-domain.netlify.app/.netlify/functions/qb-callback
```

**Development:**
```
http://localhost:8888/.netlify/functions/qb-callback
```

### 3. Database Setup

Run the migration script in Supabase SQL Editor:

```bash
# Navigate to Supabase project
# SQL Editor → New Query → Paste contents of:
supabase/migrations/002_quickbooks_integration.sql
```

### 4. Create Supabase Storage Bucket

1. Go to Supabase Dashboard → Storage
2. Create new bucket: `receipts`
3. Settings:
   - **Public**: No (private)
   - **Allowed MIME types**: `image/jpeg, image/png, application/pdf`
   - **Max file size**: 10MB

### 5. Environment Variables

Update `.env.local` or Netlify environment variables:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key_here
SUPABASE_ANON_KEY=your_anon_key_here

# QuickBooks OAuth
QB_CLIENT_ID=your_qb_client_id_here
QB_CLIENT_SECRET=your_qb_client_secret_here
QB_ENVIRONMENT=sandbox  # or 'production'

# QuickBooks Webhook
QB_WEBHOOK_TOKEN=your_random_secure_token_here

# Netlify
URL=https://your-domain.netlify.app
```

**Generate webhook token:**
```bash
openssl rand -base64 32
```

### 6. Install Dependencies

```bash
npm install
```

### 7. Deploy to Netlify

```bash
# Deploy
npm run deploy

# Or connect GitHub repo for automatic deployments
```

### 8. Configure QuickBooks Webhook

1. Go to Intuit Developer Portal
2. Select your app → Webhooks
3. Add webhook endpoint:
   ```
   https://your-domain.netlify.app/.netlify/functions/qb-webhook
   ```
4. Enter your webhook verifier token (from QB_WEBHOOK_TOKEN)
5. Select entities to monitor:
   - ✅ Purchase
   - ✅ Bill
   - ✅ Expense
   - ✅ Deposit
   - ✅ Payment
   - ✅ Invoice
   - ✅ SalesReceipt
6. Save and test the webhook

---

## Database Schema

### New Tables

#### `quickbooks_connections`
Stores OAuth tokens and connection metadata.

```sql
- id (UUID, PK)
- account_id (BIGINT, FK → accounts)
- realm_id (TEXT) - QuickBooks company ID
- access_token (TEXT)
- refresh_token (TEXT)
- token_expires_at (TIMESTAMP)
- refresh_token_expires_at (TIMESTAMP)
- company_name (TEXT)
- environment (TEXT) - 'sandbox' or 'production'
- is_active (BOOLEAN)
- last_synced_at (TIMESTAMP)
- created_at, updated_at (TIMESTAMP)
```

#### `financial_accounts`
Bank/cash account balances from QuickBooks.

```sql
- id (UUID, PK)
- account_id (BIGINT, FK → accounts)
- quickbooks_account_id (TEXT)
- account_name (TEXT)
- account_type (TEXT) - 'Bank', 'Credit Card', etc.
- current_balance (NUMERIC)
- currency (TEXT)
- is_active (BOOLEAN)
- last_synced_at (TIMESTAMP)
- created_at, updated_at (TIMESTAMP)
```

#### `webhook_events`
Audit log of all webhook events.

```sql
- id (UUID, PK)
- account_id (BIGINT, FK → accounts)
- event_type (TEXT)
- realm_id (TEXT)
- entity_name (TEXT) - 'Purchase', 'Bill', etc.
- entity_id (TEXT)
- operation (TEXT) - 'Create', 'Update', 'Delete'
- payload (JSONB) - Full webhook payload
- processed (BOOLEAN)
- processed_at (TIMESTAMP)
- error_message (TEXT)
- retry_count (INTEGER)
- created_at (TIMESTAMP)
```

#### `notifications`
In-app notifications for users.

```sql
- id (UUID, PK)
- account_id (BIGINT, FK → accounts)
- user_id (UUID, FK → auth.users)
- type (TEXT) - 'transaction', 'sync', 'error', 'info'
- title (TEXT)
- message (TEXT)
- link (TEXT)
- read (BOOLEAN)
- created_at (TIMESTAMP)
- read_at (TIMESTAMP)
```

### Enhanced Existing Tables

#### `transactions` (enhanced)
Added QuickBooks-specific fields:

```sql
+ quickbooks_id (TEXT, UNIQUE)
+ transaction_type (TEXT)
+ currency (TEXT)
+ vendor_name (TEXT)
+ memo (TEXT)
+ transaction_date (DATE)
+ quickbooks_account_id (TEXT)
+ quickbooks_account_name (TEXT)
+ assigned_vehicle_id (BIGINT, FK → cars)
+ receipt_url (TEXT)
+ raw_payload (JSONB)
```

---

## API Endpoints

### OAuth Endpoints

#### `GET /.netlify/functions/qb-connect`
Initiates QuickBooks OAuth flow.

**Query Parameters:**
- `accountId` (required) - Fleet OS account ID

**Response:**
- Redirects to QuickBooks authorization page

**Example:**
```javascript
window.location.href = `/.netlify/functions/qb-connect?accountId=1`;
```

---

#### `GET /.netlify/functions/qb-callback`
OAuth callback handler.

**Query Parameters:**
- `code` - Authorization code from QuickBooks
- `state` - State parameter containing accountId
- `realmId` - QuickBooks company ID

**Response:**
- Redirects to Fleet OS dashboard with success message

---

### Webhook Endpoint

#### `POST /.netlify/functions/qb-webhook`
Receives webhook notifications from QuickBooks.

**Headers:**
- `intuit-signature` - HMAC signature for verification

**Request Body:**
```json
{
  "eventNotifications": [{
    "realmId": "123456789",
    "dataChangeEvent": {
      "entities": [{
        "name": "Purchase",
        "id": "123",
        "operation": "Create",
        "lastUpdated": "2024-01-15T10:30:00Z"
      }]
    }
  }]
}
```

**Response:**
```json
{
  "success": true
}
```

**Features:**
- ✅ Signature verification
- ✅ Idempotent processing
- ✅ Automatic retry on failure
- ✅ Full audit logging

---

### Sync Endpoint

#### `POST /.netlify/functions/qb-sync-balances`
Manually trigger bank balance sync.

**Request Body:**
```json
{
  "accountId": 1
}
```

**Response:**
```json
{
  "success": true,
  "message": "Bank balances synced successfully"
}
```

---

## Webhook Configuration

### Signature Verification

Webhooks are verified using HMAC-SHA256:

```javascript
const hash = crypto
  .createHmac('sha256', QB_WEBHOOK_TOKEN)
  .update(payload)
  .digest('base64');

if (hash !== signature) {
  throw new Error('Invalid signature');
}
```

### Supported Entities

| Entity | Description | Processed |
|--------|-------------|-----------|
| Purchase | Direct purchases with payment | ✅ |
| Expense | General expenses | ✅ |
| Bill | Vendor invoices | ✅ |
| Deposit | Bank deposits | ✅ |
| Payment | Customer payments | ⚠️ Future |
| Invoice | Sales invoices | ⚠️ Future |
| SalesReceipt | Direct sales | ⚠️ Future |

### Retry Logic

- Webhook events are logged immediately
- Processing failures are recorded with error message
- Failed events can be manually reprocessed
- Retry count is tracked

---

## Transaction Flow

### 1. Transaction Created in QuickBooks

User creates a purchase, expense, or bill in QuickBooks Online.

### 2. Webhook Notification

QuickBooks sends webhook to Fleet OS:
```
POST /.netlify/functions/qb-webhook
```

### 3. Signature Verification

Webhook signature is verified using HMAC-SHA256.

### 4. Event Logging

Raw webhook payload is saved to `webhook_events` table.

### 5. Transaction Fetch

Full transaction details are fetched from QuickBooks API:
```
GET /v3/company/{realmId}/purchase/{id}
```

### 6. Data Normalization

Transaction is normalized to Fleet OS format:
```javascript
{
  quickbooks_id: "123",
  transaction_type: "Purchase",
  amount: 150.00,
  vendor_name: "Parts Supplier Ltd",
  memo: "Brake pads",
  transaction_date: "2024-01-15",
  status: "unassigned",
  assigned: false,
  source: "quickbooks",
  raw_payload: { /* full QB data */ }
}
```

### 7. Database Storage

Transaction is saved to `transactions` table using upsert (idempotent).

### 8. Notification Created

In-app notification is created for unassigned transaction.

### 9. User Assignment

User opens transaction queue and assigns transaction to:
- Vehicle (or mark as overhead)
- Category
- Notes
- Receipt/invoice upload

### 10. Dashboard Update

Assigned transaction appears in vehicle P&L and dashboard.

---

## User Workflow

### Connecting QuickBooks

1. User clicks "Connect QuickBooks" in Fleet OS
2. Redirected to QuickBooks authorization page
3. User signs in and grants permissions
4. Redirected back to Fleet OS
5. Connection status shows "Connected"

### Reviewing Unassigned Transactions

1. User receives notification: "New unassigned transactions"
2. Clicks notification or navigates to `/transactions/unassigned`
3. Sees list of unassigned transactions with:
   - Date
   - Vendor
   - Type
   - Account
   - Memo
   - Amount

### Assigning a Transaction

1. User clicks "Assign" button
2. Modal opens with transaction details
3. User selects:
   - **Vehicle** - from dropdown or "Mark as Overhead"
   - **Category** - Fuel, Parts, Mechanics, etc.
   - **Notes** - optional additional information
   - **Receipt** - optional file upload (JPG, PNG, PDF)
4. User clicks "Assign Transaction"
5. Transaction moves to assigned status
6. Dashboard updates automatically

### Ignoring a Transaction

For transactions that shouldn't be tracked:
1. Click "Assign" button
2. Click "Ignore" in modal
3. Transaction is marked as ignored and hidden

### Syncing Bank Balances

1. User clicks "Sync Balances" button
2. System fetches current balances from QuickBooks
3. Dashboard balance sheet updates with latest values

---

## Troubleshooting

### Webhook Not Receiving Events

**Check:**
1. Webhook URL is correct in QuickBooks Developer Portal
2. Webhook token matches in both places
3. SSL certificate is valid (required by QuickBooks)
4. Netlify function is deployed and accessible

**Test:**
```bash
curl -X POST https://your-domain.netlify.app/.netlify/functions/qb-webhook \
  -H "Content-Type: application/json" \
  -H "intuit-signature: test" \
  -d '{"eventNotifications":[]}'
```

### Transactions Not Appearing

**Check:**
1. Webhook events table for errors
2. QuickBooks connection is active
3. Access token hasn't expired
4. Entity type is supported

**Query webhook events:**
```sql
SELECT * FROM webhook_events 
WHERE processed = false 
ORDER BY created_at DESC;
```

### Token Expired

Tokens are automatically refreshed, but if issues persist:

1. Check `quickbooks_connections` table
2. Verify `token_expires_at` timestamp
3. Manually trigger refresh or reconnect

**Reconnect:**
```javascript
// Disconnect
await supabase
  .from('quickbooks_connections')
  .update({ is_active: false })
  .eq('account_id', accountId);

// Reconnect via OAuth flow
window.location.href = `/.netlify/functions/qb-connect?accountId=${accountId}`;
```

### Receipt Upload Failing

**Check:**
1. Supabase Storage bucket `receipts` exists
2. Bucket is configured correctly (private, correct MIME types)
3. File size is under 10MB
4. File type is allowed (JPG, PNG, PDF)

**Test upload:**
```javascript
const { data, error } = await supabase.storage
  .from('receipts')
  .upload('test.jpg', file);

console.log(data, error);
```

---

## Security Considerations

### Token Storage

- ✅ Access tokens stored encrypted in database
- ✅ Refresh tokens stored securely
- ✅ Tokens never exposed to client
- ✅ Service role key used for server operations

### Webhook Security

- ✅ HMAC signature verification required
- ✅ Webhook token is strong random string
- ✅ HTTPS required for all endpoints
- ✅ Rate limiting via Netlify

### File Uploads

- ✅ Files stored in private Supabase bucket
- ✅ File type validation (whitelist)
- ✅ File size limits enforced
- ✅ Unique file names prevent collisions

### API Access

- ✅ Supabase RLS can be enabled for multi-user
- ✅ Account ID validation on all operations
- ✅ User authentication required for UI
- ✅ Service-to-service auth for webhooks

### Best Practices

1. **Rotate webhook token** periodically
2. **Monitor webhook events** for suspicious activity
3. **Enable Supabase RLS** for production multi-user
4. **Use environment-specific credentials** (sandbox vs production)
5. **Log all API requests** for audit trail
6. **Implement rate limiting** on public endpoints
7. **Regular security audits** of dependencies

---

## Future Enhancements

### Planned Features

- [ ] Automatic scheduled balance sync (daily/weekly)
- [ ] Email notifications for unassigned transactions
- [ ] WhatsApp notifications via Twilio
- [ ] AI-powered transaction categorization
- [ ] Bulk transaction assignment
- [ ] Transaction splitting across multiple vehicles
- [ ] OCR for receipt parsing
- [ ] Export to PDF reports
- [ ] Multi-currency support
- [ ] Additional data sources (Stripe, Plaid, Open Banking)

### Extensibility

The system is designed to support multiple data sources:

```javascript
// Generic transaction structure
{
  source: 'quickbooks' | 'stripe' | 'plaid' | 'manual',
  external_id: 'source-specific-id',
  // ... normalized fields
}
```

Adding new sources requires:
1. New OAuth/API integration
2. Webhook handler for that source
3. Normalization function
4. Update UI to show source

---

## Support

### Resources

- **QuickBooks API Docs**: https://developer.intuit.com/app/developer/qbo/docs
- **Supabase Docs**: https://supabase.com/docs
- **Netlify Functions**: https://docs.netlify.com/functions/overview/

### Common Issues

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Token expired, reconnect QB |
| 429 Too Many Requests | Rate limited, wait and retry |
| 500 Server Error | Check Netlify function logs |
| Webhook not firing | Verify webhook configuration |
| Transaction duplicate | Already processed (idempotent) |

### Getting Help

1. Check Netlify function logs
2. Check Supabase logs
3. Review webhook_events table
4. Test with QuickBooks sandbox
5. Contact support with error details

---

## Changelog

### v3.0.0 (Current)
- ✅ Full QuickBooks OAuth integration
- ✅ Webhook handler with signature verification
- ✅ Transaction ingestion and normalization
- ✅ Bank balance sync
- ✅ Transaction assignment UI
- ✅ Receipt upload to Supabase Storage
- ✅ In-app notifications
- ✅ Comprehensive documentation

### v2.0.0
- Manual transaction entry
- Vehicle inventory management
- Balance sheet dashboard

---

**Last Updated**: January 2024  
**Version**: 3.0.0  
**Status**: Production Ready
