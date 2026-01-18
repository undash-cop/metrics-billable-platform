-- Add processed_at field to track migration status
-- NULL means unprocessed, non-NULL means migrated to RDS

ALTER TABLE usage_events ADD COLUMN processed_at INTEGER;

CREATE INDEX idx_usage_events_processed_at ON usage_events(processed_at) WHERE processed_at IS NULL;

COMMENT ON COLUMN usage_events.processed_at IS 'Unix timestamp when event was migrated to RDS. NULL means unprocessed.';
