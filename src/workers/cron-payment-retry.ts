import { Env } from '../types/env.js';
import { createRdsPool } from '../db/rds.js';
import {
  getPaymentsEligibleForRetry,
  retryPayment,
  RetryConfig,
} from '../services/payment-retry.js';
import { createLogger } from '../utils/logger.js';
import { createMetricsCollector } from '../utils/metrics.js';

/**
 * Cloudflare Worker Cron Job: Payment Retry
 * 
 * Purpose: Automatically retry failed payments with exponential backoff
 * 
 * Schedule: Runs every 6 hours (configurable)
 * 
 * Design Decisions:
 * 1. Exponential backoff: 24h, 48h, 96h between retries
 * 2. Max retries: Default 3 attempts
 * 3. Error Handling: Continues processing other payments if one fails
 * 4. Logging: Comprehensive logging for auditability
 * 5. Metrics: Track retry success/failure rates
 * 
 * Process:
 * 1. Get payments eligible for retry (failed status, retry_count < max_retries, next_retry_at <= now)
 * 2. Retry each payment by creating new Razorpay order
 * 3. Update retry count and next retry time
 * 4. Log results and metrics
 * 5. Notify on final failure (after max retries)
 */

interface RetryResult {
  paymentId: string;
  invoiceId: string;
  organisationId: string;
  success: boolean;
  attemptNumber: number;
  newOrderId?: string;
  error?: string;
}

interface RetryStats {
  totalEligible: number;
  successful: number;
  failed: number;
  finalFailures: number;
  results: RetryResult[];
}

/**
 * Get retry configuration from environment
 */
function getRetryConfig(env: Env): RetryConfig {
  return {
    maxRetries: env.PAYMENT_RETRY_MAX_RETRIES
      ? parseInt(env.PAYMENT_RETRY_MAX_RETRIES, 10)
      : 3,
    baseIntervalHours: env.PAYMENT_RETRY_BASE_INTERVAL_HOURS
      ? parseInt(env.PAYMENT_RETRY_BASE_INTERVAL_HOURS, 10)
      : 24,
    enabled: env.PAYMENT_RETRY_ENABLED !== 'false',
  };
}

/**
 * Payment retry cron job handler
 */
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const logger = createLogger(env);
    const metrics = createMetricsCollector();
    const pool = createRdsPool(env);

    const startTime = Date.now();
    const stats: RetryStats = {
      totalEligible: 0,
      successful: 0,
      failed: 0,
      finalFailures: 0,
      results: [],
    };

    try {
      // Check if retry is enabled
      const config = getRetryConfig(env);
      if (!config.enabled) {
        logger.info('Payment retry is disabled, skipping');
        return;
      }

      logger.info('Starting payment retry cron job', {
        cron: event.cron,
        scheduledTime: new Date(event.scheduledTime).toISOString(),
        config,
      });

      // Get payments eligible for retry
      const eligiblePayments = await getPaymentsEligibleForRetry(pool, 100);
      stats.totalEligible = eligiblePayments.length;

      logger.info('Found payments eligible for retry', {
        count: eligiblePayments.length,
      });

      if (eligiblePayments.length === 0) {
        logger.info('No payments eligible for retry');
        return;
      }

      // Retry each payment
      for (const payment of eligiblePayments) {
        try {
          const result = await retryPayment(pool, env, payment.id, config);

          const retryResult: RetryResult = {
            paymentId: payment.id,
            invoiceId: payment.invoiceId,
            organisationId: payment.organisationId,
            success: result.success,
            attemptNumber: payment.retryCount + 1,
            newOrderId: result.newOrderId,
            error: result.error,
          };

          stats.results.push(retryResult);

          if (result.success) {
            stats.successful++;
            metrics.increment('payment.retry.success', {
              organisationId: payment.organisationId,
              invoiceId: payment.invoiceId,
            });

            logger.info('Payment retry successful', {
              paymentId: payment.id,
              invoiceId: payment.invoiceId,
              attemptNumber: retryResult.attemptNumber,
              newOrderId: result.newOrderId,
            });
          } else {
            stats.failed++;

            // Check if this was the final attempt
            if (payment.retryCount + 1 >= payment.maxRetries) {
              stats.finalFailures++;
              metrics.increment('payment.retry.final_failure', {
                organisationId: payment.organisationId,
                invoiceId: payment.invoiceId,
              });

              logger.warn('Payment retry final failure', {
                paymentId: payment.id,
                invoiceId: payment.invoiceId,
                attemptNumber: retryResult.attemptNumber,
                error: result.error,
              });
            } else {
              metrics.increment('payment.retry.failed', {
                organisationId: payment.organisationId,
                invoiceId: payment.invoiceId,
              });

              logger.info('Payment retry failed, will retry again', {
                paymentId: payment.id,
                invoiceId: payment.invoiceId,
                attemptNumber: retryResult.attemptNumber,
                error: result.error,
              });
            }
          }
        } catch (error) {
          stats.failed++;
          const errorMessage = error instanceof Error ? error.message : String(error);

          logger.error('Error retrying payment', {
            paymentId: payment.id,
            invoiceId: payment.invoiceId,
            error: errorMessage,
          });

          metrics.increment('payment.retry.error', {
            organisationId: payment.organisationId,
            invoiceId: payment.invoiceId,
          });
        }
      }

      const duration = Date.now() - startTime;

      logger.info('Payment retry cron job completed', {
        totalEligible: stats.totalEligible,
        successful: stats.successful,
        failed: stats.failed,
        finalFailures: stats.finalFailures,
        duration,
      });

      // Track metrics
      metrics.gauge('payment.retry.total_eligible', stats.totalEligible);
      metrics.gauge('payment.retry.successful', stats.successful);
      metrics.gauge('payment.retry.failed', stats.failed);
      metrics.gauge('payment.retry.final_failures', stats.finalFailures);
      metrics.gauge('payment.retry.duration_ms', duration);

      // Alert if high failure rate
      if (stats.totalEligible > 0) {
        const failureRate = stats.failed / stats.totalEligible;
        if (failureRate > 0.5) {
          logger.error('High payment retry failure rate', {
            failureRate: (failureRate * 100).toFixed(2) + '%',
            totalEligible: stats.totalEligible,
            failed: stats.failed,
          });
        }
      }

      // Alert on final failures
      if (stats.finalFailures > 0) {
        logger.error('Payments reached max retries - manual intervention required', {
          finalFailures: stats.finalFailures,
          paymentIds: stats.results
            .filter((r) => !r.success && r.attemptNumber >= 3)
            .map((r) => r.paymentId),
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.fatal('Fatal error in payment retry cron', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      metrics.increment('payment.retry.cron.fatal_error');
    } finally {
      await pool.end();
    }
  },
};
