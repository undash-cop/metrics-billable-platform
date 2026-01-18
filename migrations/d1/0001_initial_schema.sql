-- Cloudflare D1 Schema (Hot Event Storage)
-- This database stores usage events for high-throughput ingestion
-- Events are eventually aggregated and moved to RDS

-- Usage events table (hot storage)
CREATE TABLE usage_events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    organisation_id TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    metric_value REAL NOT NULL CHECK (metric_value >= 0),
    unit TEXT NOT NULL,
    timestamp INTEGER NOT NULL, -- Unix timestamp in seconds
    metadata TEXT, -- JSON string
    idempotency_key TEXT NOT NULL,
    ingested_at INTEGER NOT NULL -- Unix timestamp in seconds
);

-- Indexes for efficient querying
CREATE INDEX idx_usage_events_project_id ON usage_events(project_id);
CREATE INDEX idx_usage_events_organisation_id ON usage_events(organisation_id);
CREATE INDEX idx_usage_events_timestamp ON usage_events(timestamp);
CREATE INDEX idx_usage_events_idempotency_key ON usage_events(idempotency_key);
CREATE INDEX idx_usage_events_metric_name ON usage_events(metric_name);
CREATE INDEX idx_usage_events_org_project_metric ON usage_events(organisation_id, project_id, metric_name);

-- Unique constraint for idempotency
CREATE UNIQUE INDEX idx_usage_events_idempotency_unique ON usage_events(idempotency_key);
