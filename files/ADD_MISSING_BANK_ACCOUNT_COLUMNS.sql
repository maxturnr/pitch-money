-- Add missing columns that the frontend expects
ALTER TABLE bank_accounts
ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS qb_account_id TEXT;

-- Update existing accounts to be active
UPDATE bank_accounts SET active = true WHERE active IS NULL;
UPDATE bank_accounts SET is_default = false WHERE is_default IS NULL;

-- Verify columns exist
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'bank_accounts' 
AND column_name IN ('is_default', 'active', 'qb_account_id')
ORDER BY column_name;
