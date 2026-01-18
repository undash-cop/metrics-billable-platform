-- Projects cache table for API key validation
-- This table caches API key -> project/organisation mappings for fast lookups
-- Reduces RDS round-trips for high-throughput event ingestion

CREATE TABLE IF NOT EXISTS projects_cache (
    api_key_hash TEXT PRIMARY KEY, -- Hashed API key (in production, use proper hashing)
    project_id TEXT NOT NULL,
    organisation_id TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    updated_at INTEGER NOT NULL -- Unix timestamp
);

CREATE INDEX idx_projects_cache_updated_at ON projects_cache(updated_at);

-- Optional: Add TTL cleanup (run periodically to remove stale entries)
-- DELETE FROM projects_cache WHERE updated_at < (strftime('%s', 'now') - 86400);

COMMENT ON TABLE projects_cache IS 'Cache for API key -> project mappings. Populated from RDS and used for fast validation.';
