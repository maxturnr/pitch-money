-- ═══════════════════════════════════════════════════════════
-- UPGRADE FINEXER INTEGRATION
-- Run AFTER ADD_FINEXER_BANK_INTEGRATION.sql
-- Adds columns and tables needed by the fixed edge functions
-- Safe to run multiple times (uses IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════

-- 1. Add missing columns to bank_accounts
ALTER TABLE bank_accounts
ADD COLUMN IF NOT EXISTS available_balance DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS sort_code TEXT;

-- 2. Add missing columns to bank_connections
ALTER TABLE bank_connections
ADD COLUMN IF NOT EXISTS last_error TEXT,
ADD COLUMN IF NOT EXISTS last_auto_synced_at TIMESTAMPTZ;

-- 3. Create bank_consents table (tracks individual consent records)
CREATE TABLE IF NOT EXISTS bank_consents (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bank_connection_id BIGINT REFERENCES bank_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'finexer',
  provider_consent_id TEXT,
  finexer_consent_id TEXT,
  status TEXT DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, provider_consent_id)
);

-- 4. Create finexer_webhook_events table (logs incoming webhooks)
CREATE TABLE IF NOT EXISTS finexer_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT,
  payload JSONB,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create bank_webhook_events table (generic webhook log)
CREATE TABLE IF NOT EXISTS bank_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT,
  event_received_at TIMESTAMPTZ,
  payload JSONB,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, provider_event_id)
);

-- 6. Disable RLS on new tables
ALTER TABLE bank_consents DISABLE ROW LEVEL SECURITY;
ALTER TABLE finexer_webhook_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE bank_webhook_events DISABLE ROW LEVEL SECURITY;

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_bank_consents_account ON bank_consents(account_id);
CREATE INDEX IF NOT EXISTS idx_bank_consents_connection ON bank_consents(bank_connection_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON finexer_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_bank_webhook_provider ON bank_webhook_events(provider, event_type);

-- 8. Verify
SELECT
  'Finexer upgrade complete!' as status,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'bank_consents') as bank_consents_exists,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'finexer_webhook_events') as webhook_events_exists;
