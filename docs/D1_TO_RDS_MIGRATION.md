# D1 to RDS Migration Cron Job

## Overview

The D1 to RDS migration cron job (`src/workers/cron-d1-to-rds.ts`) moves usage events from Cloudflare D1 (hot storage) to PostgreSQL RDS (financial source of truth). It's designed for batch processing with safe retries and comprehensive error handling.

## Architecture

### Flow

```
1. Cron trigger (every 5 minutes)
2. Fetch unprocessed events from D1 (batch of 1000)
3. Insert events into RDS with idempotency protection
4. Mark successfully inserted events as processed in D1
5. Repeat until no more events or max batches reached
6. Log statistics and errors
```

### Key Components

1. **Batch Processing**: Processes events in configurable batches (default 1000)
2. **Idempotency**: Uses RDS UNIQUE constraint on `idempotency_key`
3. **Atomic Operations**: Events marked as processed only after successful RDS insert
4. **Fail Fast**: Stops processing on first error to prevent partial state
5. **Comprehensive Logging**: Logs all operations and failures

## Idempotency Strategy

### Problem

When migrating events from D1 to RDS, we need to ensure:
- No duplicate events in RDS (even if cron runs multiple times)
- Safe retries if migration fails partway through
- No data loss if migration is interrupted

### Solution

**RDS UNIQUE Constraint + ON CONFLICT DO NOTHING**

1. **RDS Schema**: `idempotency_key` has UNIQUE constraint
   ```sql
   CREATE UNIQUE INDEX idx_usage_events_idempotency_key 
   ON usage_events(idempotency_key);
   ```

2. **Insert Strategy**: Use PostgreSQL's `ON CONFLICT DO NOTHING`
   ```sql
   INSERT INTO usage_events (...)
   VALUES (...)
   ON CONFLICT (idempotency_key) DO NOTHING
   RETURNING id;
   ```

3. **Behavior**:
   - **New Event**: Inserted into RDS, ID returned
   - **Duplicate Event**: Skipped silently, no ID returned
   - **Result**: Only newly inserted IDs are returned

4. **D1 Marking**: Only mark events as processed if they were successfully inserted
   - If event already exists in RDS (duplicate), it's skipped
   - If event is new, it's inserted and marked as processed in D1

### Why This Works

1. **First Migration**: All events are new → All inserted → All marked as processed
2. **Retry After Failure**: 
   - Already inserted events → Skipped (ON CONFLICT)
   - Unprocessed events → Inserted → Marked as processed
3. **Concurrent Runs**: 
   - Both runs try to insert same event
   - One succeeds, one skips (UNIQUE constraint)
   - Both mark as processed (idempotent)

### Example Scenario

**Initial State:**
- D1: 1000 unprocessed events
- RDS: 0 events

**Migration Run 1 (fails after 500 events):**
- Inserts 500 events into RDS
- Marks 500 events as processed in D1
- Fails on event 501

**Migration Run 2 (retry):**
- Fetches 500 unprocessed events from D1
- Tries to insert all 500
- First 500 already exist → Skipped (ON CONFLICT)
- Last 500 are new → Inserted
- Marks 500 new events as processed

**Result:**
- All 1000 events in RDS
- All 1000 events marked as processed in D1
- No duplicates, no data loss

## SQL Implementation

### Batch Insert (100 events)

```sql
INSERT INTO usage_events (
    id, organisation_id, project_id, idempotency_key,
    metric_name, metric_value, unit, timestamp, metadata, ingested_at
)
VALUES 
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10),   -- Event 1
    ($11, $12, $13, $14, $15, $16, $17, $18, $19, $20), -- Event 2
    -- ... (up to 100 events)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;
```

### Individual Insert (fallback)

```sql
INSERT INTO usage_events (
    id, organisation_id, project_id, idempotency_key,
    metric_name, metric_value, unit, timestamp, metadata, ingested_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;
```

### Mark as Processed in D1

```sql
UPDATE usage_events 
SET processed_at = ?
WHERE id IN (?, ?, ...)
```

## Error Handling

### Fail Fast Strategy

- **On Error**: Stop processing immediately
- **Reason**: Prevents partial state (some events migrated, some not)
- **Retry**: Next cron run will process remaining events
- **Idempotency**: Already migrated events are safely skipped

### Error Types

1. **Database Connection Error**: Fails immediately, no events processed
2. **Batch Insert Error**: Falls back to individual inserts to identify problematic events
3. **Individual Insert Error**: Logs error, fails fast
4. **D1 Update Error**: Logs error, but doesn't fail (events already in RDS)

### Logging

All operations are logged:
- Batch processing start/end
- Events fetched from D1
- Events inserted into RDS
- Events skipped (duplicates)
- Errors with event IDs
- Final statistics

## Configuration

### Environment Variables

- `MIGRATION_BATCH_SIZE`: Events per batch (default: 1000)
- `MIGRATION_MAX_BATCHES`: Max batches per run (default: 10)

### Cron Schedule

Configured in `wrangler.toml`:
```toml
[triggers]
crons = ["*/5 * * * *"]  # Every 5 minutes
```

## Monitoring

### Key Metrics

1. **Migration Rate**: Events migrated per minute
2. **Success Rate**: Percentage of successful migrations
3. **Duplicate Rate**: Percentage of skipped duplicates
4. **Error Rate**: Percentage of failed migrations
5. **Lag**: Time between event ingestion and migration

### Alerts

- Migration failures (errors in logs)
- High duplicate rate (possible data issues)
- Migration lag (events not migrating fast enough)
- D1 storage growth (events not being cleaned up)

## Performance Considerations

### Batch Size

- **Too Small**: More database round-trips, slower migration
- **Too Large**: Risk of timeout, memory issues
- **Recommended**: 100-1000 events per batch

### Batch Limits

- **Max Batches**: Prevents single run from taking too long
- **Default**: 10 batches = 10,000 events per run (if batch size is 1000)
- **Adjust**: Based on cron frequency and event volume

### Database Connections

- Uses connection pool (max 20 connections)
- Transactions ensure atomicity
- Connection timeout: 10 seconds

## Testing

### Unit Tests

- Batch insert logic
- Idempotency handling
- Error handling
- D1 marking logic

### Integration Tests

- End-to-end migration
- Retry after failure
- Concurrent migration runs
- Duplicate handling

### Load Tests

- High-volume event migration
- Large batch sizes
- Concurrent cron runs

## Troubleshooting

### Events Not Migrating

1. Check D1 for unprocessed events:
   ```sql
   SELECT COUNT(*) FROM usage_events WHERE processed_at IS NULL;
   ```

2. Check cron job logs for errors

3. Verify RDS connection and permissions

4. Check for duplicate idempotency_keys in D1:
   ```sql
   SELECT idempotency_key, COUNT(*) 
   FROM usage_events 
   GROUP BY idempotency_key 
   HAVING COUNT(*) > 1;
   ```

### Duplicate Events in RDS

1. Check for duplicate idempotency_keys:
   ```sql
   SELECT idempotency_key, COUNT(*) 
   FROM usage_events 
   GROUP BY idempotency_key 
   HAVING COUNT(*) > 1;
   ```

2. Verify UNIQUE constraint exists:
   ```sql
   SELECT indexname FROM pg_indexes 
   WHERE tablename = 'usage_events' 
   AND indexname LIKE '%idempotency%';
   ```

### Migration Lag

1. Increase batch size (if not hitting limits)
2. Increase max batches per run
3. Run cron more frequently
4. Optimize RDS queries and indexes

## Future Enhancements

1. **Parallel Processing**: Process multiple batches concurrently
2. **Incremental Batching**: Adjust batch size based on performance
3. **Dead Letter Queue**: Store failed events for manual review
4. **Metrics Export**: Export Prometheus metrics
5. **Auto-cleanup**: Automatically delete processed events from D1 after N days
