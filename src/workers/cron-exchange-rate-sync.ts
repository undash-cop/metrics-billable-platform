import { Env } from '../types/env.js';
import { createRdsPool } from '../db/rds.js';
import { createLogger } from '../utils/logger.js';
import { createMetricsCollector } from '../utils/metrics.js';
import { syncExchangeRates } from '../services/currency-conversion.js';

/**
 * Cloudflare Worker Cron Job: Exchange Rate Sync
 *
 * Purpose: Periodically sync exchange rates from external API to keep rates up-to-date.
 *
 * Schedule: Runs daily at 1 AM UTC (`0 1 * * *`)
 *
 * Design Decisions:
 * 1. Idempotent: Uses update_exchange_rate function which sets old rates effective_to.
 * 2. Error Handling: Logs errors for individual currency pairs but continues processing others.
 * 3. Metrics: Tracks successful syncs, failures, and duration.
 * 4. Configurable: Base currency can be configured via env var (default: INR).
 *
 * Process:
 * 1. Fetch exchange rates from external API for common currency pairs.
 * 2. Update rates in database using update_exchange_rate function.
 * 3. Log results and emit metrics.
 */

export async function handleExchangeRateSyncCron(
  event: ScheduledEvent,
  env: Env
): Promise<void> {
  const logger = createLogger(env);
  const metrics = createMetricsCollector();
  const pool = createRdsPool(env);

  const startTime = Date.now();
  const baseCurrency = env.DEFAULT_CURRENCY || 'INR';

  try {
    logger.info('Starting scheduled exchange rate sync cron job', {
      cron: event.cron,
      scheduledTime: new Date(event.scheduledTime).toISOString(),
      baseCurrency,
    });

    const result = await syncExchangeRates(pool, env, baseCurrency);

    const duration = Date.now() - startTime;
    logger.info('Exchange rate sync cron job completed', {
      baseCurrency,
      updated: result.updated,
      failed: result.failed,
      durationMs: duration,
    });

    // Emit metrics
    metrics.gauge('exchange_rates.sync.updated', result.updated);
    metrics.gauge('exchange_rates.sync.failed', result.failed);
    metrics.gauge('exchange_rates.sync.duration_ms', duration);

    if (result.failed > 0) {
      logger.warn('Some exchange rate syncs failed', {
        failed: result.failed,
        baseCurrency,
      });
      metrics.increment('exchange_rates.sync.partial_failure');
    }

    if (result.updated === 0 && result.failed > 0) {
      logger.error('All exchange rate syncs failed', {
        failed: result.failed,
        baseCurrency,
      });
      metrics.increment('exchange_rates.sync.total_failure');
    }
  } catch (error) {
    logger.fatal('Fatal error in exchange rate sync cron job', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      cron: event.cron,
      baseCurrency,
    });
    metrics.increment('exchange_rates.sync.cron.fatal_error');
    throw error;
  } finally {
    await pool.end(); // Close the RDS pool connection
  }
}

export default {
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await handleExchangeRateSyncCron(event, env);
  },
};
