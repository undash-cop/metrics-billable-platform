/**
 * D1 Cleanup Cron Job
 * 
 * Removes old processed events from D1 to control storage costs.
 * 
 * Retention Policy:
 * - Keep events for 7 days after processed_at timestamp
 * - Only delete events that have been successfully migrated to RDS
 * 
 * Schedule: Daily at 3 AM UTC
 */

import { Env } from '../types/env.js';
import { createLogger } from '../utils/logger.js';
import { createMetricsCollector } from '../utils/metrics.js';

export async function handleD1Cleanup(
  event: ScheduledEvent,
  env: Env
): Promise<void> {
  const logger = createLogger(env);
  const metrics = createMetricsCollector(env);

  const startTime = Date.now();
  logger.info('Starting D1 cleanup job', {
    cronTime: event.scheduledTime,
  });

  try {
    // Calculate cutoff date: 7 days ago
    const cutoffTimestamp = Math.floor(
      (Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000
    );

    // Delete old processed events
    // Only delete events that have been processed (processed_at is not null)
    const deleteResult = await env.EVENTS_DB
      .prepare(
        `DELETE FROM usage_events
         WHERE processed_at IS NOT NULL
           AND processed_at < ?`
      )
      .bind(cutoffTimestamp)
      .run();

    const deletedCount = deleteResult.meta.changes || 0;

    logger.info('D1 cleanup complete', {
      deletedCount,
      cutoffTimestamp,
    });

    const duration = Date.now() - startTime;
    metrics.trackOperation('d1_cleanup', duration, {
      deletedCount,
    });

    // Alert if too many events deleted (might indicate a problem)
    if (deletedCount > 100000) {
      logger.warn('Large number of events deleted in cleanup', {
        deletedCount,
      });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logError(error as Error, {
      operation: 'd1_cleanup',
      duration,
    });

    metrics.trackOperation('d1_cleanup', duration, {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}
