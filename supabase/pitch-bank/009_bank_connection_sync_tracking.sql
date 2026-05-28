-- ═══════════════════════════════════════════════════════════
-- MIGRATION: Add sync tracking to bank_connections
-- Tracks when connections were created and last synced
-- For new connections (< 5 days), we sync more frequently
-- ═══════════════════════════════════════════════════════════

-- Add last_auto_synced_at to track automatic background syncs
ALTER TABLE bank_connections 
ADD COLUMN IF NOT EXISTS last_auto_synced_at TIMESTAMPTZ;

-- Add comment
COMMENT ON COLUMN bank_connections.last_auto_synced_at IS 'Last time automatic background sync ran (used to trigger daily syncs for new connections)';

-- Verification query
SELECT 
    id,
    provider,
    status,
    created_at,
    last_synced_at,
    last_auto_synced_at,
    EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 as days_since_created
FROM bank_connections
WHERE account_id = 4;
