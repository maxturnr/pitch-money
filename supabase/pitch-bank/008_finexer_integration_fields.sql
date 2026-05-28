-- ═══════════════════════════════════════════════════════════
-- FINEXER INTEGRATION - ADD MISSING FIELDS
-- Adds Finexer-specific fields to existing bank-first schema
-- Safe to run multiple times (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════

-- Add Finexer customer ID to accounts table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'accounts' AND column_name = 'finexer_customer_id'
  ) THEN
    ALTER TABLE accounts ADD COLUMN finexer_customer_id text;
    CREATE INDEX IF NOT EXISTS idx_accounts_finexer_customer_id ON accounts(finexer_customer_id);
  END IF;
END $$;

-- Add consent link fields to bank_connections
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bank_connections' AND column_name = 'consent_link_id'
  ) THEN
    ALTER TABLE bank_connections ADD COLUMN consent_link_id text;
    ALTER TABLE bank_connections ADD COLUMN consent_link_url text;
    ALTER TABLE bank_connections ADD COLUMN consent_link_expires_at timestamptz;
    CREATE INDEX IF NOT EXISTS idx_bank_connections_consent_link_id ON bank_connections(consent_link_id);
  END IF;
END $$;

-- Add Finexer consent ID to bank_consents
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bank_consents' AND column_name = 'finexer_consent_id'
  ) THEN
    ALTER TABLE bank_consents ADD COLUMN finexer_consent_id text;
    CREATE INDEX IF NOT EXISTS idx_bank_consents_finexer_consent_id ON bank_consents(finexer_consent_id);
  END IF;
END $$;

-- Add Finexer fields to bank_accounts
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bank_accounts' AND column_name = 'finexer_account_id'
  ) THEN
    ALTER TABLE bank_accounts ADD COLUMN finexer_account_id text;
    ALTER TABLE bank_accounts ADD COLUMN holder_name text;
    ALTER TABLE bank_accounts ADD COLUMN nickname text;
    ALTER TABLE bank_accounts ADD COLUMN account_class text; -- current, savings, emoney
    ALTER TABLE bank_accounts ADD COLUMN fingerprint text; -- Finexer's unique account fingerprint
    CREATE INDEX IF NOT EXISTS idx_bank_accounts_finexer_account_id ON bank_accounts(finexer_account_id);
  END IF;
END $$;

-- Add Finexer transaction ID to bank_transactions
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bank_transactions' AND column_name = 'finexer_transaction_id'
  ) THEN
    ALTER TABLE bank_transactions ADD COLUMN finexer_transaction_id text;
    ALTER TABLE bank_transactions ADD COLUMN category text; -- Finexer's auto-categorization
    CREATE INDEX IF NOT EXISTS idx_bank_transactions_finexer_transaction_id ON bank_transactions(finexer_transaction_id);
  END IF;
END $$;

-- Create webhook events table if not exists
CREATE TABLE IF NOT EXISTS finexer_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  received_at timestamptz not null default now(),
  payload jsonb not null,
  processed boolean not null default false,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_finexer_webhook_events_event_type ON finexer_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_finexer_webhook_events_processed ON finexer_webhook_events(processed, received_at);

-- Add comment for documentation
COMMENT ON TABLE finexer_webhook_events IS 'Stores all webhook events received from Finexer for audit and processing';
COMMENT ON COLUMN accounts.finexer_customer_id IS 'Finexer customer ID (cus_xxx format)';
COMMENT ON COLUMN bank_connections.consent_link_id IS 'Finexer consent link ID (cl_xxx format)';
COMMENT ON COLUMN bank_consents.finexer_consent_id IS 'Finexer consent ID (bc_xxx format)';
COMMENT ON COLUMN bank_accounts.finexer_account_id IS 'Finexer bank account ID (ba_xxx format)';
COMMENT ON COLUMN bank_transactions.finexer_transaction_id IS 'Finexer transaction ID (trn_xxx format)';

-- ═══════════════════════════════════════════════════════════
-- VERIFICATION QUERY
-- Run this to check all fields exist
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  missing_fields text[] := ARRAY[]::text[];
BEGIN
  -- Check accounts.finexer_customer_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'finexer_customer_id') THEN
    missing_fields := array_append(missing_fields, 'accounts.finexer_customer_id');
  END IF;
  
  -- Check bank_connections fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_connections' AND column_name = 'consent_link_id') THEN
    missing_fields := array_append(missing_fields, 'bank_connections.consent_link_id');
  END IF;
  
  -- Check bank_consents.finexer_consent_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_consents' AND column_name = 'finexer_consent_id') THEN
    missing_fields := array_append(missing_fields, 'bank_consents.finexer_consent_id');
  END IF;
  
  -- Check bank_accounts.finexer_account_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_accounts' AND column_name = 'finexer_account_id') THEN
    missing_fields := array_append(missing_fields, 'bank_accounts.finexer_account_id');
  END IF;
  
  -- Check bank_transactions.finexer_transaction_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_transactions' AND column_name = 'finexer_transaction_id') THEN
    missing_fields := array_append(missing_fields, 'bank_transactions.finexer_transaction_id');
  END IF;
  
  -- Check finexer_webhook_events table
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'finexer_webhook_events') THEN
    missing_fields := array_append(missing_fields, 'table: finexer_webhook_events');
  END IF;
  
  -- Report results
  IF array_length(missing_fields, 1) > 0 THEN
    RAISE NOTICE 'MISSING FIELDS: %', array_to_string(missing_fields, ', ');
    RAISE EXCEPTION 'Migration incomplete - some fields are missing';
  ELSE
    RAISE NOTICE '✅ All Finexer integration fields exist!';
  END IF;
END $$;
