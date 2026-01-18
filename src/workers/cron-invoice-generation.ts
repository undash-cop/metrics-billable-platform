import { Env } from '../types/env.js';
import { createRdsPool } from '../db/rds.js';
import { generateInvoice } from '../services/invoice-generator.js';
import { createLogger } from '../utils/logger.js';
import { createMetricsCollector } from '../utils/metrics.js';
import { DatabaseError, NotFoundError, ConflictError } from '../utils/errors.js';
import pg from 'pg';

/**
 * Cloudflare Worker Cron Job: Scheduled Invoice Generation
 * 
 * Purpose: Automatically generate monthly invoices for all active organisations
 * 
 * Schedule: Runs on the 1st of each month at 2 AM UTC
 * 
 * Design Decisions:
 * 1. Idempotent: Skips if invoice already exists (handled by generateInvoice)
 * 2. Error Handling: Continues processing other orgs if one fails
 * 3. Logging: Comprehensive logging for auditability
 * 4. Metrics: Track success/failure rates
 * 
 * Process:
 * 1. Get all active organisations
 * 2. Calculate previous month (current month - 1)
 * 3. Generate invoice for each organisation
 * 4. Skip if invoice already exists
 * 5. Log results and metrics
 */

interface InvoiceGenerationResult {
  organisationId: string;
  organisationName: string;
  success: boolean;
  invoiceId?: string;
  error?: string;
}

interface GenerationStats {
  totalOrganisations: number;
  successful: number;
  skipped: number;
  failed: number;
  results: InvoiceGenerationResult[];
}

/**
 * Get all active organisations
 */
async function getActiveOrganisations(pool: pg.Pool): Promise<Array<{ id: string; name: string }>> {
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT id, name 
     FROM organisations 
     WHERE is_active = true
     ORDER BY created_at ASC`
  );

  return result.rows;
}

/**
 * Calculate previous month
 */
function getPreviousMonth(): { month: number; year: number } {
  const now = new Date();
  let month = now.getMonth(); // 0-indexed (0 = January, 11 = December)
  let year = now.getFullYear();

  // If current month is January (0), previous month is December (11) of previous year
  if (month === 0) {
    month = 12;
    year -= 1;
  } else {
    month -= 1;
  }

  // Convert to 1-indexed (1 = January, 12 = December)
  return { month: month + 1, year };
}

/**
 * Generate invoices for all active organisations
 */
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const logger = createLogger(env.ENVIRONMENT);
    const metrics = createMetricsCollector();
    const pool = createRdsPool(env);

    const startTime = Date.now();
    const stats: GenerationStats = {
      totalOrganisations: 0,
      successful: 0,
      skipped: 0,
      failed: 0,
      results: [],
    };

    try {
      logger.info('Starting scheduled invoice generation', {
        cron: event.cron,
        scheduledTime: new Date(event.scheduledTime).toISOString(),
      });

      // Get previous month
      const { month, year } = getPreviousMonth();
      logger.info('Generating invoices for period', { month, year });

      // Get all active organisations
      const organisations = await getActiveOrganisations(pool);
      stats.totalOrganisations = organisations.length;

      logger.info('Found active organisations', { count: organisations.length });

      if (organisations.length === 0) {
        logger.info('No active organisations found, skipping invoice generation');
        return;
      }

      // Generate invoice for each organisation
      for (const org of organisations) {
        try {
          logger.info('Generating invoice for organisation', {
            organisationId: org.id,
            organisationName: org.name,
            month,
            year,
          });

          const invoice = await generateInvoice(pool, {
            organisationId: org.id,
            month,
            year,
          }, env);

          stats.successful++;
          stats.results.push({
            organisationId: org.id,
            organisationName: org.name,
            success: true,
            invoiceId: invoice.id,
          });

          logger.info('Invoice generated successfully', {
            organisationId: org.id,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            total: invoice.total,
          });

          metrics.increment('invoice.generation.success', {
            organisation_id: org.id,
          });

          // Send invoice email (non-blocking)
          try {
            await sendInvoiceEmail(env, pool, invoice);
            metrics.increment('invoice.email.sent', {
              organisation_id: org.id,
            });
          } catch (emailError) {
            // Log but don't fail invoice generation if email fails
            logger.error('Failed to send invoice email', {
              organisationId: org.id,
              invoiceId: invoice.id,
              error: emailError instanceof Error ? emailError.message : String(emailError),
            });
            metrics.increment('invoice.email.failed', {
              organisation_id: org.id,
            });
          }
        } catch (error) {
          // Check if it's a "already exists" error (should be skipped, not failed)
          if (
            error instanceof ConflictError ||
            (error instanceof DatabaseError && error.message.includes('already exists'))
          ) {
            stats.skipped++;
            stats.results.push({
              organisationId: org.id,
              organisationName: org.name,
              success: true, // Skipped is considered success
              error: 'Invoice already exists',
            });

            logger.info('Invoice already exists, skipping', {
              organisationId: org.id,
              month,
              year,
            });

            metrics.increment('invoice.generation.skipped', {
              organisation_id: org.id,
            });
          } else if (error instanceof NotFoundError && error.message.includes('No usage aggregates')) {
            // No usage data for this period - skip
            stats.skipped++;
            stats.results.push({
              organisationId: org.id,
              organisationName: org.name,
              success: true,
              error: 'No usage aggregates found',
            });

            logger.info('No usage aggregates found, skipping', {
              organisationId: org.id,
              month,
              year,
            });

            metrics.increment('invoice.generation.skipped', {
              organisation_id: org.id,
              reason: 'no_usage',
            });
          } else {
            // Actual error - log but continue
            stats.failed++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            stats.results.push({
              organisationId: org.id,
              organisationName: org.name,
              success: false,
              error: errorMessage,
            });

            logger.error('Failed to generate invoice', {
              organisationId: org.id,
              month,
              year,
              error: errorMessage,
              stack: error instanceof Error ? error.stack : undefined,
            });

            metrics.increment('invoice.generation.failed', {
              organisation_id: org.id,
            });
          }
        }
      }

      const duration = Date.now() - startTime;

      // Log summary
      logger.info('Invoice generation completed', {
        month,
        year,
        totalOrganisations: stats.totalOrganisations,
        successful: stats.successful,
        skipped: stats.skipped,
        failed: stats.failed,
        durationMs: duration,
      });

      // Emit metrics
      metrics.gauge('invoice.generation.total', stats.totalOrganisations);
      metrics.gauge('invoice.generation.successful', stats.successful);
      metrics.gauge('invoice.generation.skipped', stats.skipped);
      metrics.gauge('invoice.generation.failed', stats.failed);
      metrics.gauge('invoice.generation.duration_ms', duration);

      // Alert if failure rate is high
      if (stats.failed > 0 && stats.failed / stats.totalOrganisations > 0.1) {
        logger.error('High invoice generation failure rate', {
          failureRate: stats.failed / stats.totalOrganisations,
          failed: stats.failed,
          total: stats.totalOrganisations,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.fatal('Fatal error in invoice generation cron', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      metrics.increment('invoice.generation.cron.fatal_error');
    } finally {
      await pool.end();
    }
  },
};
