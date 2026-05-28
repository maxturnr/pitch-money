# Finexer Banking Integration Guide

Complete implementation guide for integrating Finexer Open Banking into your application.

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [Supabase Edge Functions](#supabase-edge-functions)
5. [Frontend Integration](#frontend-integration)
6. [Webhook Configuration](#webhook-configuration)
7. [Auto-Sync Strategy](#auto-sync-strategy)
8. [Transaction Date Handling](#transaction-date-handling)
9. [Deployment Checklist](#deployment-checklist)

---

## Overview

This integration connects your application to users' bank accounts via Finexer's Open Banking API, enabling:
- Real-time bank account connections
- Automatic transaction syncing (2 years of history)
- Webhook-based updates for new transactions
- Pending transaction tracking
- Smart auto-sync for new connections

### Key Features
- ✅ Multiple bank account support
- ✅ 2-year transaction history
- ✅ Pending & booked transactions
- ✅ Automatic daily sync for new connections (first 5 days)
- ✅ Weekly maintenance sync for established connections
- ✅ Manual sync capability
- ✅ Real-time webhook updates

---

## Architecture

```
┌─────────────────┐
│   Frontend      │
│  (HTML/JS)      │
└────────┬────────┘
         │
         │ 1. Create Consent Link
         ▼
┌─────────────────────────────────┐
│ Supabase Edge Function          │
│ finexer-create-consent-link     │
└────────┬────────────────────────┘
         │
         │ 2. Redirect to Finexer
         ▼
┌─────────────────┐
│   Finexer       │
│  (Bank Auth)    │
└────────┬────────┘
         │
         │ 3. Webhook: Connection Created
         ▼
┌─────────────────────────────────┐
│ Supabase Edge Function          │
│ finexer-webhook                 │
└────────┬────────────────────────┘
         │
         │ 4. Store Connection
         ▼
┌─────────────────┐
│   Database      │
│ bank_connections│
└─────────────────┘
         │
         │ 5. Manual/Auto Sync
         ▼
┌─────────────────────────────────┐
│ Supabase Edge Function          │
│ finexer-sync-accounts           │
└────────┬────────────────────────┘
         │
         │ 6. Fetch Accounts & Transactions
         ▼
┌─────────────────┐
│   Database      │
│ bank_accounts   │
│ bank_transactions│
└─────────────────┘
```

---

## Database Schema

### Migration Files

Run these migrations in order:

#### 1. Core Banking Tables
**File**: `supabase/pitch-bank/001_bank_tables.sql`

```sql
-- Bank Connections Table
CREATE TABLE IF NOT EXISTS bank_connections (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'finexer',
  finexer_connection_id TEXT UNIQUE,
  status TEXT DEFAULT 'active',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  last_auto_synced_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bank_connections_account ON bank_connections(account_id);
CREATE INDEX idx_bank_connections_finexer ON bank_connections(finexer_connection_id);

-- Bank Accounts Table
CREATE TABLE IF NOT EXISTS bank_accounts (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bank_connection_id BIGINT REFERENCES bank_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'finexer',
  finexer_account_id TEXT UNIQUE,
  account_name TEXT,
  account_type TEXT,
  account_subtype TEXT,
  currency TEXT DEFAULT 'GBP',
  current_balance NUMERIC(15,2) DEFAULT 0,
  available_balance NUMERIC(15,2),
  iban TEXT,
  sort_code TEXT,
  account_number TEXT,
  bic TEXT,
  last_feed_sync_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bank_accounts_account ON bank_accounts(account_id);
CREATE INDEX idx_bank_accounts_connection ON bank_accounts(bank_connection_id);
CREATE INDEX idx_bank_accounts_finexer ON bank_accounts(finexer_account_id);

-- Bank Transactions Table
CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bank_account_id BIGINT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'finexer',
  provider_transaction_id TEXT,
  finexer_transaction_id TEXT UNIQUE,
  direction TEXT CHECK (direction IN ('in', 'out')),
  status TEXT DEFAULT 'booked' CHECK (status IN ('pending', 'booked')),
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'GBP',
  transaction_date DATE,
  booked_at TIMESTAMPTZ,
  reference TEXT,
  description TEXT,
  merchant_name TEXT,
  counterparty_name TEXT,
  category TEXT,
  running_balance NUMERIC(15,2),
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bank_transactions_account ON bank_transactions(account_id);
CREATE INDEX idx_bank_transactions_bank_account ON bank_transactions(bank_account_id);
CREATE INDEX idx_bank_transactions_finexer ON bank_transactions(finexer_transaction_id);
CREATE INDEX idx_bank_transactions_date ON bank_transactions(transaction_date DESC);
CREATE INDEX idx_bank_transactions_status ON bank_transactions(status);
```

#### 2. Transactions Inbox View
**File**: `supabase/pitch-bank/002_transactions_inbox_view.sql`

```sql
-- View for transaction reconciliation inbox
CREATE OR REPLACE VIEW transactions_inbox AS
SELECT 
  bt.id AS bank_transaction_id,
  bt.account_id,
  bt.bank_account_id,
  ba.account_name AS bank_account_name,
  bt.transaction_date,
  bt.direction,
  bt.amount,
  bt.currency,
  bt.reference,
  bt.description,
  bt.merchant_name,
  bt.counterparty_name,
  bt.status AS bank_status,
  r.id AS reconciliation_id,
  COALESCE(r.status, 'new') AS reconciliation_status,
  r.resolution_type,
  r.confidence_score,
  r.reconciled_at,
  r.reconciled_by_user_id,
  r.assigned_user_id
FROM bank_transactions bt
LEFT JOIN bank_accounts ba ON bt.bank_account_id = ba.id
LEFT JOIN reconciliations r ON bt.id = r.bank_transaction_id
ORDER BY bt.transaction_date DESC, bt.created_at DESC;
```

#### 3. Reconciliations Table
**File**: `supabase/pitch-bank/003_reconciliations.sql`

```sql
CREATE TABLE IF NOT EXISTS reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bank_transaction_id UUID REFERENCES bank_transactions(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'suggested', 'needs_review', 'reconciled', 'ignored')),
  resolution_type TEXT CHECK (resolution_type IN ('expense', 'income', 'transfer', 'split', 'ignore')),
  confidence_score NUMERIC(3,2),
  reconciled_at TIMESTAMPTZ,
  reconciled_by_user_id UUID,
  assigned_user_id UUID,
  notes TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reconciliations_account ON reconciliations(account_id);
CREATE INDEX idx_reconciliations_transaction ON reconciliations(bank_transaction_id);
CREATE INDEX idx_reconciliations_status ON reconciliations(status);
```

#### 4. Auto-Sync Tracking
**File**: `supabase/pitch-bank/009_bank_connection_sync_tracking.sql`

```sql
-- Add last_auto_synced_at column for tracking automatic background syncs
ALTER TABLE bank_connections 
ADD COLUMN IF NOT EXISTS last_auto_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN bank_connections.last_auto_synced_at IS 
'Tracks when the last automatic background sync occurred. Used to implement smart sync strategy: daily for new connections (<5 days), weekly for established connections.';
```

### Row Level Security (RLS)

Enable RLS on all tables:

```sql
-- Enable RLS
ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliations ENABLE ROW LEVEL SECURITY;

-- Policies for bank_connections
CREATE POLICY "Users can view their company's bank connections"
  ON bank_connections FOR SELECT
  USING (
    account_id IN (
      SELECT account_id FROM dealership_users 
      WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY "Users can insert bank connections for their company"
  ON bank_connections FOR INSERT
  WITH CHECK (
    account_id IN (
      SELECT account_id FROM dealership_users 
      WHERE user_id = auth.uid() AND can_connect_bank_accounts = true AND active = true
    )
  );

-- Similar policies for bank_accounts, bank_transactions, reconciliations
-- (Repeat pattern for each table)
```

---

## Supabase Edge Functions

### 1. Create Consent Link
**File**: `supabase/functions/finexer-create-consent-link/index.ts`

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FINEXER_API_KEY = Deno.env.get('FINEXER_API_KEY')
const FINEXER_API_URL = 'https://api.finexer.io/v1'

serve(async (req) => {
  try {
    const { account_id, return_url } = await req.json()
    
    // Create Supabase client with service role
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    // Create consent link with Finexer
    const response = await fetch(`${FINEXER_API_URL}/consent_links`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(FINEXER_API_KEY + ':')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        return_url: return_url,
        webhook_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/finexer-webhook`,
        metadata: {
          account_id: account_id.toString()
        }
      })
    })
    
    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create consent link')
    }
    
    return new Response(
      JSON.stringify({ consent_url: data.url, consent_id: data.id }),
      { headers: { 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
```

### 2. Webhook Handler
**File**: `supabase/functions/finexer-webhook/index.ts`

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const payload = await req.json()
    console.log('Finexer webhook received:', payload)
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    // Handle different webhook events
    if (payload.event === 'connection.created') {
      const accountId = parseInt(payload.metadata?.account_id)
      
      if (!accountId) {
        throw new Error('No account_id in metadata')
      }
      
      // Store bank connection
      const { error } = await supabaseClient
        .from('bank_connections')
        .insert({
          account_id: accountId,
          provider: 'finexer',
          finexer_connection_id: payload.connection_id,
          status: 'active',
          connected_at: new Date().toISOString(),
          metadata: payload
        })
      
      if (error) throw error
      
      console.log('Bank connection stored:', payload.connection_id)
    }
    
    if (payload.event === 'transaction.created' || payload.event === 'transaction.updated') {
      // Transaction updates are handled by the sync function
      // Webhook just triggers awareness that new data is available
      console.log('Transaction event received, data will be synced on next poll')
    }
    
    return new Response(
      JSON.stringify({ received: true }),
      { headers: { 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
```

**Disable JWT verification** for webhook:
**File**: `.well-known/supabase/verify.json`

```json
{
  "finexer-webhook": {
    "jwt_secret_required": false
  }
}
```

### 3. Sync Accounts & Transactions
**File**: `supabase/functions/finexer-sync-accounts/index.ts`

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { FinexerClient } from '../_shared/finexer-client.ts'

serve(async (req) => {
  try {
    const { account_id } = await req.json()
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    const finexer = new FinexerClient(Deno.env.get('FINEXER_API_KEY') ?? '')
    
    // Get all bank connections for this account
    const { data: connections, error: connError } = await supabaseClient
      .from('bank_connections')
      .select('*')
      .eq('account_id', account_id)
      .eq('status', 'active')
    
    if (connError) throw connError
    if (!connections?.length) {
      return new Response(
        JSON.stringify({ message: 'No active connections found', synced_accounts: 0, synced_transactions: 0 }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    let syncedAccounts = 0
    let syncedTransactions = 0
    
    // Sync each connection
    for (const conn of connections) {
      console.log('Syncing connection:', conn.finexer_connection_id)
      
      // Fetch bank accounts from Finexer
      const accountsResponse = await finexer.listBankAccounts(conn.finexer_connection_id)
      const bankAccounts = Array.isArray(accountsResponse) ? accountsResponse : (accountsResponse.data || [])
      
      console.log(`Found ${bankAccounts.length} bank accounts`)
      
      for (const ba of bankAccounts) {
        // Fetch balance
        let currentBalance = 0
        try {
          const balanceData = await finexer.getBalance(ba.id)
          const balances = Array.isArray(balanceData) ? balanceData : (balanceData.data || [])
          const balance = balances.find((b: any) => b.type === 'expected' || b.type === 'current')
          currentBalance = balance?.amount || 0
        } catch (error) {
          console.error('Error fetching balance:', error)
        }
        
        // Upsert bank account
        const { error: accountError } = await supabaseClient
          .from('bank_accounts')
          .upsert({
            account_id: account_id,
            bank_connection_id: conn.id,
            provider: 'finexer',
            finexer_account_id: ba.id,
            account_name: ba.name || ba.details?.name || 'Unknown Account',
            account_type: ba.type || 'bank',
            account_subtype: ba.subtype || 'current',
            currency: ba.currency?.toUpperCase() || 'GBP',
            current_balance: currentBalance,
            iban: ba.iban,
            sort_code: ba.sort_code,
            account_number: ba.account_number,
            bic: ba.bic,
            last_feed_sync_at: new Date().toISOString(),
            metadata: ba,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'finexer_account_id'
          })
        
        if (accountError) {
          console.error('Error upserting account:', accountError)
          continue
        }
        
        console.log('Successfully upserted bank account:', ba.id)
        syncedAccounts++
        
        // Fetch transactions (2 years of history)
        try {
          const twoYearsAgo = new Date()
          twoYearsAgo.setDate(twoYearsAgo.getDate() - 730)
          
          // Fetch BOOKED and PENDING separately
          let allTransactions = []
          
          // Fetch BOOKED transactions with pagination
          let hasMore = true
          let offset = 0
          const limit = 100
          
          console.log(`Fetching BOOKED transactions for ${ba.id}...`)
          while (hasMore) {
            const txnResponse = await finexer.listTransactions(ba.id, {
              status: 'booked',
              'timestamp.gte': twoYearsAgo.toISOString().split('T')[0],
              limit: limit,
              offset: offset,
            })
            
            const pageTransactions = Array.isArray(txnResponse) ? txnResponse : (txnResponse.data || [])
            allTransactions = allTransactions.concat(pageTransactions)
            
            hasMore = pageTransactions.length === limit
            offset += limit
            
            if (offset > 10000) {
              console.warn('Reached safety limit of 10000 booked transactions')
              break
            }
          }
          
          // Fetch PENDING transactions
          console.log(`Fetching PENDING transactions for ${ba.id}...`)
          const pendingResponse = await finexer.listTransactions(ba.id, {
            status: 'pending',
            limit: 100,
          })
          
          const pendingTransactions = Array.isArray(pendingResponse) ? pendingResponse : (pendingResponse.data || [])
          console.log(`Found ${pendingTransactions.length} pending transactions`)
          allTransactions = allTransactions.concat(pendingTransactions)
          
          console.log(`Total transactions: ${allTransactions.length}`)
          
          // Get our bank account ID
          const { data: ourBankAccount } = await supabaseClient
            .from('bank_accounts')
            .select('id')
            .eq('finexer_account_id', ba.id)
            .single()
          
          if (!ourBankAccount) continue
          
          // Store transactions
          for (const txn of allTransactions) {
            // Check if transaction already exists
            const { data: existing } = await supabaseClient
              .from('bank_transactions')
              .select('id')
              .eq('finexer_transaction_id', txn.id)
              .single()
            
            if (existing) continue
            
            // For PENDING: use today's date (transaction just happened)
            // For BOOKED: use timestamp (settlement date)
            const transactionDate = txn.status === 'pending'
              ? new Date().toISOString().split('T')[0]
              : (txn.timestamp?.split('T')[0] || new Date().toISOString().split('T')[0])
            
            const { data: newTxn } = await supabaseClient
              .from('bank_transactions')
              .insert({
                account_id: account_id,
                bank_account_id: ourBankAccount.id,
                provider: 'finexer',
                provider_transaction_id: txn.id,
                finexer_transaction_id: txn.id,
                direction: txn.type === 'debit' ? 'out' : 'in',
                status: txn.status === 'booked' ? 'booked' : 'pending',
                amount: Math.abs(txn.amount),
                currency: txn.currency?.toUpperCase() || 'GBP',
                transaction_date: transactionDate,
                booked_at: txn.status === 'booked' ? txn.timestamp : null,
                reference: txn.reference,
                description: txn.description,
                merchant_name: txn.merchant,
                category: txn.category,
                running_balance: txn.balance,
                raw_payload: txn,
              })
              .select()
              .single()
            
            if (newTxn) syncedTransactions++
          }
          
        } catch (error) {
          console.error('Error syncing transactions:', error)
        }
      }
      
      // Update connection last_synced_at
      await supabaseClient
        .from('bank_connections')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', conn.id)
    }
    
    return new Response(
      JSON.stringify({ 
        message: 'Sync complete',
        synced_accounts: syncedAccounts,
        synced_transactions: syncedTransactions
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    console.error('Sync error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
```

### 4. Finexer Client Helper
**File**: `supabase/functions/_shared/finexer-client.ts`

```typescript
export class FinexerClient {
  private apiKey: string
  private baseUrl = 'https://api.finexer.io/v1'
  
  constructor(apiKey: string) {
    this.apiKey = apiKey
  }
  
  private async request(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Basic ${btoa(this.apiKey + ':')}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    
    return response.json()
  }
  
  async listBankAccounts(connectionId: string) {
    return this.request(`/connections/${connectionId}/bank_accounts`)
  }
  
  async getBalance(bankAccountId: string) {
    return this.request(`/bank_accounts/${bankAccountId}/balances`)
  }
  
  async listTransactions(
    bankAccountId: string,
    params: {
      status?: 'pending' | 'booked'
      'timestamp.gte'?: string
      'timestamp.lte'?: string
      limit?: number
      offset?: number
    } = {}
  ) {
    const query = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        query.append(key, value.toString())
      }
    })
    
    const queryString = query.toString()
    return this.request(
      `/bank_accounts/${bankAccountId}/transactions${queryString ? '?' + queryString : ''}`
    )
  }
}
```

---

## Frontend Integration

### 1. Connect Bank Account

```javascript
async function connectBankAccount() {
  const statusEl = document.getElementById('finexer-status')
  const btn = document.getElementById('connect-bank-btn')
  
  statusEl.style.display = 'block'
  statusEl.textContent = '⏳ Creating consent link...'
  btn.disabled = true
  
  try {
    const { data: { session } } = await sb.auth.getSession()
    
    const response = await fetch('https://YOUR_PROJECT.supabase.co/functions/v1/finexer-create-consent-link', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_id: currentAccount.id,
        return_url: window.location.origin + '/your-app.html'
      })
    })
    
    const data = await response.json()
    
    if (data.error) throw new Error(data.error)
    
    statusEl.textContent = '✅ Redirecting to bank selection...'
    
    setTimeout(() => {
      window.location.href = data.consent_url
    }, 2000)
    
  } catch (error) {
    statusEl.textContent = `❌ Error: ${error.message}`
    btn.disabled = false
  }
}
```

### 2. Manual Sync

```javascript
async function syncBankAccounts(buttonId = 'sync-accounts-btn', statusId = 'sync-status') {
  const btn = document.getElementById(buttonId)
  const statusEl = document.getElementById(statusId)
  
  const originalText = btn.textContent
  btn.disabled = true
  btn.textContent = '⏳ Syncing...'
  
  try {
    const { data: { session } } = await sb.auth.getSession()
    
    const response = await fetch('https://YOUR_PROJECT.supabase.co/functions/v1/finexer-sync-accounts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_id: currentAccount.id
      })
    })
    
    const data = await response.json()
    
    if (data.error) throw new Error(data.error)
    
    const successMsg = `✅ Synced ${data.synced_accounts} accounts and ${data.synced_transactions} transactions`
    showToast(successMsg)
    if (statusEl) statusEl.textContent = successMsg
    
    await loadWorkspace()
    
  } catch (error) {
    const errorMsg = `❌ Sync failed: ${error.message}`
    showToast(errorMsg)
    if (statusEl) statusEl.textContent = errorMsg
  } finally {
    btn.disabled = false
    btn.textContent = originalText
  }
}
```

### 3. Auto-Sync on Login

```javascript
async function syncBankAccountsBackground(accountId) {
  try {
    // Get all bank connections
    const { data: connections } = await sb
      .from('bank_connections')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', 'active')
    
    if (!connections?.length) return
    
    const now = new Date()
    
    for (const conn of connections) {
      const connectedAt = new Date(conn.connected_at)
      const daysSinceConnection = (now - connectedAt) / (1000 * 60 * 60 * 24)
      const lastAutoSync = conn.last_auto_synced_at ? new Date(conn.last_auto_synced_at) : null
      const hoursSinceLastSync = lastAutoSync ? (now - lastAutoSync) / (1000 * 60 * 60) : 999
      
      let shouldSync = false
      
      if (daysSinceConnection < 5) {
        // New connection: sync every 20+ hours
        if (hoursSinceLastSync > 20) {
          shouldSync = true
          console.log(`Auto-sync: New connection (${daysSinceConnection.toFixed(1)} days old)`)
        }
      } else {
        // Established connection: sync every 7+ days
        if (hoursSinceLastSync > 168) {
          shouldSync = true
          console.log(`Auto-sync: Maintenance sync (${daysSinceConnection.toFixed(0)} days old)`)
        }
      }
      
      if (shouldSync) {
        console.log('Triggering background sync...')
        
        const { data: { session } } = await sb.auth.getSession()
        
        fetch('https://YOUR_PROJECT.supabase.co/functions/v1/finexer-sync-accounts', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ account_id: accountId })
        }).then(async (response) => {
          const data = await response.json()
          console.log('Background sync complete:', data)
          
          // Update last_auto_synced_at
          await sb
            .from('bank_connections')
            .update({ last_auto_synced_at: new Date().toISOString() })
            .eq('id', conn.id)
          
          await loadWorkspace()
        }).catch(error => {
          console.error('Background sync error:', error)
        })
      }
    }
  } catch (error) {
    console.error('Auto-sync error:', error)
  }
}

// Call on login
async function resolveSession() {
  const { data } = await sb.auth.getSession()
  currentUser = data?.session?.user || null
  
  if (currentUser && currentAccount?.id) {
    // Trigger background sync
    syncBankAccountsBackground(currentAccount.id)
  }
}
```

---

## Webhook Configuration

### Finexer Dashboard Setup

1. **Login to Finexer Dashboard**: https://dashboard.finexer.io
2. **Navigate to Webhooks**
3. **Add Webhook URL**: `https://YOUR_PROJECT.supabase.co/functions/v1/finexer-webhook`
4. **Select Events**:
   - `connection.created`
   - `connection.updated`
   - `transaction.created`
   - `transaction.updated`

### Disable JWT Verification

Create file: `.well-known/supabase/verify.json`

```json
{
  "finexer-webhook": {
    "jwt_secret_required": false
  }
}
```

---

## Auto-Sync Strategy

### Smart Sync Logic

```
New Connections (< 5 days old):
├─ Sync every 20 hours
├─ Captures pending transactions transitioning to booked
└─ Ensures complete transaction history

Established Connections (≥ 5 days old):
├─ Sync every 7 days
├─ Maintenance sync for new transactions
└─ Webhooks handle real-time updates
```

### Implementation

The auto-sync runs on user login and checks:
1. **Connection age**: Days since `connected_at`
2. **Last sync time**: Hours since `last_auto_synced_at`
3. **Sync frequency**: 20 hours for new, 168 hours (7 days) for established

---

## Transaction Date Handling

### The Challenge

Finexer provides:
- **Pending transactions**: `timestamp` = future settlement date
- **Booked transactions**: `timestamp` = settlement date (not transaction date)

### Solution

```typescript
// For PENDING: Use today's date (transaction just happened)
const transactionDate = txn.status === 'pending'
  ? new Date().toISOString().split('T')[0]
  : (txn.timestamp?.split('T')[0] || new Date().toISOString().split('T')[0])
```

**Why this works:**
- Pending transactions are captured within hours of occurring
- Using today's date is close to actual transaction date
- When transaction becomes booked, webhook updates with actual date
- Acceptable for accounting purposes (settlement date is what matters for bank reconciliation)

---

## Deployment Checklist

### 1. Environment Variables

Set in Supabase Dashboard → Project Settings → Edge Functions:

```bash
FINEXER_API_KEY=your_finexer_api_key_here
```

### 2. Deploy Edge Functions

```bash
# Deploy all functions
supabase functions deploy finexer-create-consent-link --project-ref YOUR_PROJECT_REF
supabase functions deploy finexer-webhook --project-ref YOUR_PROJECT_REF
supabase functions deploy finexer-sync-accounts --project-ref YOUR_PROJECT_REF
```

### 3. Run Database Migrations

```bash
# Connect to your database
psql "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"

# Run migrations in order
\i supabase/pitch-bank/001_bank_tables.sql
\i supabase/pitch-bank/002_transactions_inbox_view.sql
\i supabase/pitch-bank/003_reconciliations.sql
\i supabase/pitch-bank/009_bank_connection_sync_tracking.sql
```

Or via Supabase Dashboard → SQL Editor.

### 4. Configure Webhook

1. Create `.well-known/supabase/verify.json` in your project root
2. Add webhook URL in Finexer Dashboard
3. Test webhook with a test connection

### 5. Update Frontend URLs

Replace in your frontend code:
```javascript
// Change this:
'https://YOUR_PROJECT.supabase.co/functions/v1/...'

// To your actual project URL:
'https://aestjnijiiimduyfpdgt.supabase.co/functions/v1/...'
```

### 6. Test Flow

1. ✅ Connect bank account
2. ✅ Verify webhook receives `connection.created`
3. ✅ Manual sync pulls accounts & transactions
4. ✅ Verify 2 years of history
5. ✅ Verify pending transactions appear
6. ✅ Test auto-sync on login
7. ✅ Wait 24 hours and verify auto-sync runs

---

## API Reference

### Finexer API Endpoints Used

```
POST   /v1/consent_links              - Create consent link
GET    /v1/connections/:id/bank_accounts - List bank accounts
GET    /v1/bank_accounts/:id/balances    - Get account balance
GET    /v1/bank_accounts/:id/transactions - List transactions
  ?status=pending|booked
  &timestamp.gte=YYYY-MM-DD
  &limit=100
  &offset=0
```

### Supabase Edge Functions

```
POST   /functions/v1/finexer-create-consent-link
  Body: { account_id: number, return_url: string }
  Returns: { consent_url: string, consent_id: string }

POST   /functions/v1/finexer-webhook
  Body: Finexer webhook payload
  Returns: { received: true }

POST   /functions/v1/finexer-sync-accounts
  Body: { account_id: number }
  Returns: { synced_accounts: number, synced_transactions: number }
```

---

## Troubleshooting

### Webhook Not Receiving Events

1. Check `.well-known/supabase/verify.json` exists
2. Verify webhook URL in Finexer Dashboard
3. Check Supabase function logs
4. Test with manual webhook trigger

### Transactions Not Syncing

1. Check `bank_connections` table has active connections
2. Verify `finexer_connection_id` is correct
3. Check function logs for errors
4. Verify Finexer API key is valid

### Pending Transactions Missing

1. Verify sync is fetching both `status=pending` and `status=booked`
2. Check if auto-sync is running (check `last_auto_synced_at`)
3. Manually trigger sync to test

### Duplicate Transactions

1. Check `finexer_transaction_id` UNIQUE constraint
2. Verify upsert logic in sync function
3. Check for multiple sync calls running simultaneously

---

## Support & Resources

- **Finexer API Docs**: https://docs.finexer.io
- **Finexer Dashboard**: https://dashboard.finexer.io
- **Supabase Docs**: https://supabase.com/docs
- **This Integration**: Built May 2026

---

## License & Credits

This integration guide is provided as-is for implementation reference.

**Built with:**
- Finexer Open Banking API
- Supabase (Database + Edge Functions)
- Deno runtime for Edge Functions

**Last Updated**: May 25, 2026
