import { Env } from '../types/env.js';
import { createRdsPool, transaction } from '../db/rds.js';
import { DatabaseError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { createMetricsCollector } from '../utils/metrics.js';
import { createAlertManager } from '../utils/alerts.js';
import pg from 'pg';

/**
 * Cloudflare Worker Cron Job: D1 to RDS Event Migration
 * 
 * Purpose: Move usage events from D1 (hot storage) to RDS (financial source of truth)
 * 
 * Design Decisions:
 * 1. Batch Processing: Process events in configurable batches to avoid timeouts
 * 2. Idempotency: Use idempotency_key UNIQUE constraint in RDS to prevent duplicates
 * 3. Atomic Operations: Mark events as processed only after successful RDS insert
 * 4. Fail Fast: Stop processing on first error to prevent partial state
 * 5. Comprehensive Logging: Log all operations and failures for auditability
 * 
 * Idempotency Strategy:
 * - RDS has UNIQUE constraint on idempotency_key
 * - On duplicate key error, we skip the event (already processed)
 * - This allows safe retries without double-inserting
 * - Events are marked as processed in D1 only after successful RDS insert
 */

interface D1UsageEvent {
  id: string;
  project_id: string;
  organisation_id: string;
  metric_name: string;
  metric_value: number;
  unit: string;
  timestamp: number; // Unix timestamp
  metadata: string | null;
  idempotency_key: string;
  ingested_at: number; // Unix timestamp
}

interface MigrationStats {
  totalFetched: number;
  successfullyInserted: number;
  skippedDuplicates: number;
  failed: number;
  errors: Array<{ eventId: string; error: string }>;
}

/**
 * Fetch unprocessed events from D1
 * 
 * Returns events that haven't been migrated to RDS yet.
 * Uses processed_at field to track migration status.
 */
async function fetchUnprocessedEvents(
  db: D1Database,
  batchSize: number = 1000
): Promise<D1UsageEvent[]> {
  const result = await db
    .prepare(
      `SELECT 
        id, project_id, organisation_id, metric_name, metric_value,
        unit, timestamp, metadata, idempotency_key, ingested_at
      FROM usage_events
      WHERE processed_at IS NULL
      ORDER BY ingested_at ASC
      LIMIT ?`
    )
    .bind(batchSize)
    .all<D1UsageEvent>();

  return result.results || [];
}

/**
 * Insert events into RDS using batch insert with conflict handling
 * 
 * Uses PostgreSQL's ON CONFLICT DO NOTHING to handle duplicates idempotently.
 * Returns array of successfully inserted event IDs.
 * 
 * SQL Strategy:
 * - Uses INSERT ... ON CONFLICT (idempotency_key) DO NOTHING
 * - RDS has UNIQUE constraint on idempotency_key
 * - Duplicate events are silently skipped (idempotent)
 * - Returns only successfully inserted IDs
 */
async function insertEventsIntoRds(
  pool: pg.Pool,
  events: D1UsageEvent[]
): Promise<{ inserted: string[]; skipped: string[] }> {
  if (events.length === 0) {
    return { inserted: [], skipped: [] };
  }

  return await transaction(pool, async (client) => {
    const inserted: string[] = [];
    const skipped: string[] = [];

    // Process events in smaller batches to avoid query size limits
    const insertBatchSize = 100;
    
    for (let i = 0; i < events.length; i += insertBatchSize) {
      const batch = events.slice(i, i + insertBatchSize);
      
      // Build VALUES clause for batch insert
      const values: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      for (const event of batch) {
        values.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
        );
        
        params.push(
          event.id,
          event.organisation_id,
          event.project_id,
          event.idempotency_key,
          event.metric_name,
          event.metric_value,
          event.unit,
          new Date(event.timestamp * 1000), // Convert Unix timestamp to Date
          event.metadata ? JSON.parse(event.metadata) : null,
          new Date(event.ingested_at * 1000)
        );
      }

      // Insert with ON CONFLICT DO NOTHING for idempotency
      // This handles duplicate idempotency_key gracefully
      const query = `
        INSERT INTO usage_events (
          id, organisation_id, project_id, idempotency_key,
          metric_name, metric_value, unit, timestamp, metadata, ingested_at
        )
        VALUES ${values.join(', ')}
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `;

      try {
        const result = await client.query<{ id: string }>(query, params);
        
        // Track which events were inserted vs skipped
        const insertedIds = new Set(result.rows.map((row) => row.id));
        
        for (const event of batch) {
          if (insertedIds.has(event.id)) {
            inserted.push(event.id);
          } else {
            // Event was skipped due to duplicate idempotency_key
            skipped.push(event.id);
          }
        }
      } catch (error) {
        // If batch insert fails, try individual inserts to identify problematic events
        console.error(`Batch insert failed, trying individual inserts:`, error);
        
        for (const event of batch) {
          try {
            const individualResult = await client.query<{ id: string }>(
              `INSERT INTO usage_events (
                id, organisation_id, project_id, idempotency_key,
                metric_name, metric_value, unit, timestamp, metadata, ingested_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              ON CONFLICT (idempotency_key) DO NOTHING
              RETURNING id`,
              [
                event.id,
                event.organisation_id,
                event.project_id,
                event.idempotency_key,
                event.metric_name,
                event.metric_value,
                event.unit,
                new Date(event.timestamp * 1000),
                event.metadata ? JSON.parse(event.metadata) : null,
                new Date(event.ingested_at * 1000),
              ]
            );
            
            if (individualResult.rows.length > 0) {
              inserted.push(event.id);
            } else {
              skipped.push(event.id);
            }
          } catch (individualError) {
            // Individual insert failed - this is a real error
            throw new DatabaseError(
              `Failed to insert event ${event.id}: ${individualError instanceof Error ? individualError.message : 'Unknown error'}`,
              { eventId: event.id, idempotencyKey: event.idempotency_key }
            );
          }
        }
      }
    }

    return { inserted, skipped };
  });
}

/**
 * Mark events as processed in D1
 * 
 * Only marks events that were successfully inserted into RDS.
 * Uses processed_at timestamp to track when migration occurred.
 */
async function markEventsAsProcessed(
  db: D1Database,
  eventIds: string[]
): Promise<void> {
  if (eventIds.length === 0) {
    return;
  }

  // D1 has limits on IN clause size, so batch updates
  const batchSize = 100;
  const processedAt = Math.floor(Date.now() / 1000); // Unix timestamp

  for (let i = 0; i < eventIds.length; i += batchSize) {
    const batch = eventIds.slice(i, i + batchSize);
    const placeholders = batch.map(() => '?').join(',');

    await db
      .prepare(
        `UPDATE usage_events 
         SET processed_at = ? 
         WHERE id IN (${placeholders})`
      )
      .bind(processedAt, ...batch)
      .run();
  }
}

/**
 * Main cron handler
 * 
 * Processes events in batches:
 * 1. Fetch unprocessed events from D1
 * 2. Insert into RDS (with idempotency protection)
 * 3. Mark successfully inserted events as processed in D1
 * 4. Log statistics and errors
 */
export async function handleD1ToRdsMigration(
  event: ScheduledEvent,
  env: Env
): Promise<void> {
  const logger = createLogger(env);
  const metrics = createMetricsCollector(env);
  const alerts = createAlertManager(logger, metrics);

  const startTime = Date.now();
  const stats: MigrationStats = {
    totalFetched: 0,
    successfullyInserted: 0,
    skippedDuplicates: 0,
    failed: 0,
    errors: [],
  };

  // Configuration
  const BATCH_SIZE = parseInt(env.MIGRATION_BATCH_SIZE || '1000', 10);
  const MAX_BATCHES = parseInt(env.MIGRATION_MAX_BATCHES || '10', 10);

  logger.info('Starting D1 to RDS migration', {
    batchSize: BATCH_SIZE,
    maxBatches: MAX_BATCHES,
    cronTime: event.scheduledTime,
  });

  try {
    // Create RDS connection pool
    const rdsPool = createRdsPool(env);

    // Process events in batches
    let batchNumber = 0;
    let hasMoreEvents = true;

    while (hasMoreEvents && batchNumber < MAX_BATCHES) {
      batchNumber++;

        logger.info(`Processing batch ${batchNumber}`, {
        batchNumber,
        maxBatches: MAX_BATCHES,
      });

      // Fetch unprocessed events from D1
      const events = await fetchUnprocessedEvents(env.EVENTS_DB, BATCH_SIZE);
      
      if (events.length === 0) {
        hasMoreEvents = false;
        logger.info('No more unprocessed events found');
        break;
      }

      stats.totalFetched += events.length;
      logger.info(`Fetched ${events.length} events from D1`);

      try {
        // Insert into RDS with idempotency protection
        const { inserted, skipped } = await insertEventsIntoRds(rdsPool, events);

        stats.successfullyInserted += inserted.length;
        stats.skippedDuplicates += skipped.length;

        console.log(`Batch ${batchNumber} results:`, {
          inserted: inserted.length,
          skipped: skipped.length,
          total: events.length,
        });

        // Mark successfully inserted events as processed in D1
        // Only mark events that were actually inserted (not skipped duplicates)
        if (inserted.length > 0) {
          await markEventsAsProcessed(env.EVENTS_DB, inserted);
          console.log(`Marked ${inserted.length} events as processed in D1`);
        }

        // If we got fewer events than batch size, we've processed all available events
        if (events.length < BATCH_SIZE) {
          hasMoreEvents = false;
        }

      } catch (error) {
        // Fail fast on errors
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorDetails = error instanceof DatabaseError ? error.details : {};

        stats.failed += events.length;
        stats.errors.push({
          eventId: errorDetails.eventId as string || 'batch',
          error: errorMessage,
        });

        logger.error(`Batch ${batchNumber} failed:`, {
          error: errorMessage,
          details: errorDetails,
          eventCount: events.length,
        });

        // Alert on migration failures
        const alert = alerts.checkThreshold('migration.failures', stats.failed);
        if (alert) {
          logger.error('Migration failure threshold exceeded', {
            failed: stats.failed,
            threshold: 10,
          });
        }

        // Fail fast - stop processing on error
        throw new Error(
          `Migration failed at batch ${batchNumber}: ${errorMessage}. ` +
          `Processed ${stats.successfullyInserted} events before failure.`
        );
      }
    }

    // Log final statistics
    const duration = Date.now() - startTime;
    logger.info('Migration completed', {
      duration: `${duration}ms`,
      stats: {
        totalFetched: stats.totalFetched,
        successfullyInserted: stats.successfullyInserted,
        skippedDuplicates: stats.skippedDuplicates,
        failed: stats.failed,
        batchesProcessed: batchNumber,
      },
    });

    // Track metrics
    metrics.trackOperation('migration', duration, {
      totalFetched: stats.totalFetched,
      successfullyInserted: stats.successfullyInserted,
      skippedDuplicates: stats.skippedDuplicates,
      failed: stats.failed,
    });

    // If there are errors, log them and alert
    if (stats.errors.length > 0) {
      logger.error('Migration completed with errors:', {
        errorCount: stats.errors.length,
        errors: stats.errors,
      });

      // Alert on migration errors
      const alert = alerts.checkThreshold('migration.errors', stats.errors.length);
      if (alert) {
        logger.error('Migration error threshold exceeded', {
          errorCount: stats.errors.length,
          threshold: 5,
        });
      }
    }

  } catch (error) {
    // Log final error and rethrow to mark cron as failed
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const duration = Date.now() - startTime;
    
    logger.logError(error as Error, {
      operation: 'migration',
      stats,
      duration,
    });

    // Alert on migration failures
    const alert = alerts.checkThreshold('migration.failures', 1);
    if (alert) {
      logger.error('Migration job failed', {
        error: errorMessage,
        stats,
      });
    }

    metrics.trackOperation('migration', duration, {
      success: false,
      error: errorMessage,
    });

    throw error; // Rethrow to mark cron job as failed
  }
}
