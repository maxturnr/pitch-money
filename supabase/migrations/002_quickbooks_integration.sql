-- ═══════════════════════════════════════════════════════════
-- QUICKBOOKS INTEGRATION SCHEMA
-- Enhanced schema for QuickBooks OAuth, webhooks, and sync
-- ═══════════════════════════════════════════════════════════

-- 1. QUICKBOOKS CONNECTIONS TABLE
-- Stores OAuth tokens and connection metadata
CREATE TABLE IF NOT EXISTS quickbooks_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  refresh_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  company_name TEXT,
  environment TEXT DEFAULT 'sandbox',
  is_active BOOLEAN DEFAULT TRUE,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(account_id, realm_id)
);

-- 2. FINANCIAL TRANSACTIONS TABLE
-- Replaces/extends existing transactions table for QB integration
-- Note: We'll migrate existing data and add new fields
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS quickbooks_id TEXT UNIQUE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_type TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'GBP';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS vendor_name TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS memo TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_date DATE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS quickbooks_account_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS quickbooks_account_name TEXT;
-- Add column WITHOUT foreign key constraint first
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS assigned_vehicle_id BIGINT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS raw_payload JSONB;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update existing columns to match new naming
-- Only set assigned_vehicle_id if the stock_id exists in cars table
UPDATE transactions SET 
  vendor_name = supplier,
  memo = notes,
  transaction_date = date,
  assigned_vehicle_id = CASE 
    WHEN stock_id IS NOT NULL AND EXISTS (SELECT 1 FROM cars WHERE id = stock_id) 
    THEN stock_id 
    ELSE NULL 
  END
WHERE vendor_name IS NULL;

-- Now add the foreign key constraint after data is cleaned
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'transactions_assigned_vehicle_id_fkey'
  ) THEN
    ALTER TABLE transactions 
    ADD CONSTRAINT transactions_assigned_vehicle_id_fkey 
    FOREIGN KEY (assigned_vehicle_id) 
    REFERENCES cars(id) 
    ON DELETE SET NULL;
  END IF;
END $$;

-- Create index for QuickBooks ID lookups
CREATE INDEX IF NOT EXISTS idx_transactions_quickbooks_id ON transactions(quickbooks_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_assigned ON transactions(assigned);

-- 3. FINANCIAL ACCOUNTS TABLE
-- Stores bank/cash account balances from QuickBooks
CREATE TABLE IF NOT EXISTS financial_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  quickbooks_account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  account_subtype TEXT,
  current_balance NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'GBP',
  is_active BOOLEAN DEFAULT TRUE,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(account_id, quickbooks_account_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_accounts_account_id ON financial_accounts(account_id);
CREATE INDEX IF NOT EXISTS idx_financial_accounts_qb_id ON financial_accounts(quickbooks_account_id);

-- 4. WEBHOOK EVENTS TABLE
-- Stores raw webhook payloads for debugging and audit
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  realm_id TEXT NOT NULL,
  entity_name TEXT,
  entity_id TEXT,
  operation TEXT,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_realm_id ON webhook_events(realm_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at);

-- 5. NOTIFICATIONS TABLE
-- In-app notifications for unassigned transactions
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  link TEXT,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_notifications_account_id ON notifications(account_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

-- 6. SYNC JOBS TABLE
-- Track background sync operations
CREATE TABLE IF NOT EXISTS sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_account_id ON sync_jobs(account_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_created_at ON sync_jobs(created_at);

-- 7. TRANSACTION CATEGORIES TABLE
-- Predefined expense categories for assignment
CREATE TABLE IF NOT EXISTS transaction_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default categories
INSERT INTO transaction_categories (name, description, is_default) VALUES
  ('Fuel', 'Fuel and petrol costs', true),
  ('Parts', 'Vehicle parts and components', true),
  ('Mechanics', 'Mechanical repairs and labor', true),
  ('Tyres', 'Tyre purchases and fitting', true),
  ('MOT', 'MOT tests and certificates', true),
  ('Warranty', 'Warranty and insurance costs', true),
  ('Advertising', 'Marketing and advertising', true),
  ('Cleaning', 'Valeting and cleaning services', true),
  ('HPI', 'HPI checks and vehicle history', true),
  ('Travel', 'Travel and transport costs', true),
  ('Overhead', 'General business overhead', true),
  ('Vehicle Purchase', 'Vehicle acquisition costs', true),
  ('Auction Fee', 'Auction and admin fees', true)
ON CONFLICT DO NOTHING;

-- 8. RECEIPT STORAGE BUCKET
-- Note: This needs to be created in Supabase Storage UI or via API
-- Bucket name: 'receipts'
-- Public: false
-- Allowed MIME types: image/jpeg, image/png, application/pdf

-- 9. UPDATE EXISTING VEHICLES TABLE
-- Ensure vehicles table has all required fields
ALTER TABLE cars ADD COLUMN IF NOT EXISTS registration TEXT;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS stock_number_text TEXT;

-- Migrate data if needed
UPDATE cars SET registration = reg WHERE registration IS NULL;
UPDATE cars SET stock_number_text = stock_number WHERE stock_number_text IS NULL;

-- 10. FUNCTIONS FOR AUTOMATIC TIMESTAMPS
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_quickbooks_connections_updated_at ON quickbooks_connections;
CREATE TRIGGER update_quickbooks_connections_updated_at
  BEFORE UPDATE ON quickbooks_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_financial_accounts_updated_at ON financial_accounts;
CREATE TRIGGER update_financial_accounts_updated_at
  BEFORE UPDATE ON financial_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 11. RLS POLICIES (Optional - currently disabled)
-- Enable when ready for production multi-user support
ALTER TABLE quickbooks_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE financial_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_categories DISABLE ROW LEVEL SECURITY;

-- 12. VERIFICATION
SELECT 
  'QuickBooks Integration Schema Created!' as status,
  (SELECT COUNT(*) FROM quickbooks_connections) as qb_connections,
  (SELECT COUNT(*) FROM financial_accounts) as financial_accounts,
  (SELECT COUNT(*) FROM webhook_events) as webhook_events,
  (SELECT COUNT(*) FROM notifications) as notifications,
  (SELECT COUNT(*) FROM transaction_categories) as categories;

-- ═══════════════════════════════════════════════════════════
-- NEXT STEPS:
-- ═══════════════════════════════════════════════════════════
-- 1. Create 'receipts' bucket in Supabase Storage
-- 2. Configure QuickBooks OAuth credentials in environment
-- 3. Deploy API routes for OAuth and webhooks
-- 4. Test connection flow
-- ═══════════════════════════════════════════════════════════
