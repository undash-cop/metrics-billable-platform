-- SQL for D1 to RDS Event Migration
-- This file contains the SQL statements used by the cron job

-- ============================================================================
-- BATCH INSERT WITH IDEMPOTENCY PROTECTION
-- ============================================================================

-- Single event insert (used for individual retries)
INSERT INTO usage_events (
    id, 
    organisation_id, 
    project_id, 
    idempotency_key,
    metric_name, 
    metric_value, 
    unit, 
    timestamp, 
    metadata, 
    ingested_at
) VALUES (
    $1,  -- id (UUID)
    $2,  -- organisation_id (UUID)
    $3,  -- project_id (UUID)
    $4,  -- idempotency_key (VARCHAR)
    $5,  -- metric_name (VARCHAR)
    $6,  -- metric_value (NUMERIC)
    $7,  -- unit (VARCHAR)
    $8,  -- timestamp (TIMESTAMP WITH TIME ZONE)
    $9,  -- metadata (JSONB)
    $10  -- ingested_at (TIMESTAMP WITH TIME ZONE)
)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;

-- ============================================================================
-- BATCH INSERT EXAMPLE (100 events)
-- ============================================================================

-- Example batch insert for 100 events
-- Note: In production, this is generated dynamically based on batch size
INSERT INTO usage_events (
    id, organisation_id, project_id, idempotency_key,
    metric_name, metric_value, unit, timestamp, metadata, ingested_at
)
VALUES 
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10),   -- Event 1
    ($11, $12, $13, $14, $15, $16, $17, $18, $19, $20), -- Event 2
    -- ... (up to 100 events)
    ($991, $992, $993, $994, $995, $996, $997, $998, $999, $1000) -- Event 100
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;

-- ============================================================================
-- IDEMPOTENCY EXPLANATION
-- ============================================================================

-- The idempotency_key has a UNIQUE constraint in RDS:
-- CREATE UNIQUE INDEX idx_usage_events_idempotency_key ON usage_events(idempotency_key);

-- When ON CONFLICT (idempotency_key) DO NOTHING is used:
-- 1. If idempotency_key doesn't exist → Event is inserted
-- 2. If idempotency_key already exists → Event is skipped (no error)
-- 3. RETURNING id only returns IDs of newly inserted events
-- 4. This allows safe retries without double-inserting

-- ============================================================================
-- QUERY TO CHECK MIGRATION STATUS
-- ============================================================================

-- Count unprocessed events in D1 (should be checked before migration)
-- SELECT COUNT(*) FROM usage_events WHERE processed_at IS NULL;

-- Count events migrated to RDS
-- SELECT COUNT(*) FROM usage_events WHERE processed_at IS NOT NULL;

-- Find duplicate idempotency_keys (should be empty if migration is correct)
-- SELECT idempotency_key, COUNT(*) 
-- FROM usage_events 
-- GROUP BY idempotency_key 
-- HAVING COUNT(*) > 1;

-- ============================================================================
-- CLEANUP QUERIES (Optional)
-- ============================================================================

-- Delete processed events from D1 after successful migration
-- (Run after verifying events are in RDS)
-- DELETE FROM usage_events WHERE processed_at IS NOT NULL;

-- Archive old processed events (keep last 30 days)
-- DELETE FROM usage_events 
-- WHERE processed_at IS NOT NULL 
--   AND processed_at < (strftime('%s', 'now') - 2592000);
