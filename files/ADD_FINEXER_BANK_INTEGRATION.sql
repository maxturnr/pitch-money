-- ═══════════════════════════════════════════════════════════
-- ADD FINEXER BANK INTEGRATION TABLES & COLUMNS
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- 1. CREATE BANK CONNECTIONS TABLE
CREATE TABLE IF NOT EXISTS bank_connections (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'finexer',
  provider_customer_id TEXT,
  provider_connection_id TEXT,
  consent_link_id TEXT,
  consent_link_url TEXT,
  consent_link_expires_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'pending',
  last_synced_at TIMESTAMP WITH TIME ZONE,
  last_auto_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(account_id, provider)
);

-- 2. ADD FINEXER COLUMNS TO ACCOUNTS TABLE
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS finexer_customer_id TEXT;

-- 3. ADD FINEXER COLUMNS TO BANK_ACCOUNTS TABLE
ALTER TABLE bank_accounts
ADD COLUMN IF NOT EXISTS bank_connection_id BIGINT REFERENCES bank_connections(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS provider TEXT,
ADD COLUMN IF NOT EXISTS provider_account_id TEXT,
ADD COLUMN IF NOT EXISTS finexer_account_id TEXT,
ADD COLUMN IF NOT EXISTS display_name TEXT,
ADD COLUMN IF NOT EXISTS account_subtype TEXT,
ADD COLUMN IF NOT EXISTS account_class TEXT,
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'GBP',
ADD COLUMN IF NOT EXISTS masked_account_number TEXT,
ADD COLUMN IF NOT EXISTS holder_name TEXT,
ADD COLUMN IF NOT EXISTS nickname TEXT,
ADD COLUMN IF NOT EXISTS fingerprint TEXT,
ADD COLUMN IF NOT EXISTS balance_as_of TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_feed_sync_at TIMESTAMP WITH TIME ZONE;

-- 4. ADD UNIQUE CONSTRAINT FOR FINEXER ACCOUNTS
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'bank_accounts_provider_account_unique'
  ) THEN
    ALTER TABLE bank_accounts 
    ADD CONSTRAINT bank_accounts_provider_account_unique 
    UNIQUE(provider, provider_account_id);
  END IF;
END $$;

-- 5. CREATE BANK TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS bank_transactions (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bank_account_id BIGINT REFERENCES bank_accounts(id) ON DELETE CASCADE,
  provider TEXT DEFAULT 'finexer',
  provider_transaction_id TEXT,
  finexer_transaction_id TEXT,
  direction TEXT CHECK (direction IN ('in', 'out')),
  status TEXT DEFAULT 'booked',
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'GBP',
  transaction_date DATE NOT NULL,
  booked_at TIMESTAMP WITH TIME ZONE,
  reference TEXT,
  description TEXT,
  merchant_name TEXT,
  category TEXT,
  running_balance DECIMAL(10,2),
  raw_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(provider, provider_transaction_id)
);

-- 6. CREATE RECONCILIATIONS TABLE
CREATE TABLE IF NOT EXISTS reconciliations (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bank_transaction_id BIGINT REFERENCES bank_transactions(id) ON DELETE CASCADE,
  expense_id BIGINT REFERENCES expenses(id) ON DELETE SET NULL,
  income_id BIGINT REFERENCES income(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'matched', 'ignored')),
  matched_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. CREATE INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_bank_connections_account_id ON bank_connections(account_id);
CREATE INDEX IF NOT EXISTS idx_bank_connections_provider ON bank_connections(provider);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_connection_id ON bank_accounts(bank_connection_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_provider_account ON bank_accounts(provider, provider_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_id ON bank_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_bank_account_id ON bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_reconciliations_account_id ON reconciliations(account_id);
CREATE INDEX IF NOT EXISTS idx_reconciliations_bank_transaction_id ON reconciliations(bank_transaction_id);

-- 8. DISABLE RLS ON NEW TABLES (for now - enable later with proper policies)
ALTER TABLE bank_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliations DISABLE ROW LEVEL SECURITY;

-- 9. VERIFY SETUP
SELECT 
  'Finexer integration tables ready!' as status,
  (SELECT COUNT(*) FROM bank_connections) as bank_connections_count,
  (SELECT COUNT(*) FROM bank_accounts) as bank_accounts_count,
  (SELECT COUNT(*) FROM bank_transactions) as bank_transactions_count;

-- ═══════════════════════════════════════════════════════════
-- NOTES:
-- ═══════════════════════════════════════════════════════════
-- • bank_connections: Stores Finexer consent links and connection status
-- • bank_accounts: Extended with Finexer-specific fields
-- • bank_transactions: Stores transactions from Finexer feed
-- • reconciliations: Links bank transactions to expenses/income
-- 
-- USAGE:
-- 1. User creates consent link via finexer-create-consent-link function
-- 2. User completes consent on Finexer website
-- 3. App calls finexer-sync-accounts to fetch accounts and transactions
-- 4. Accounts appear in bank_accounts table with balances
-- 5. Transactions appear in bank_transactions table
-- 6. User can reconcile bank transactions with expenses/income
-- ═══════════════════════════════════════════════════════════
