import { Env } from '../types/env.js';
import { createRdsPool } from '../db/rds.js';
import { createLogger } from '../utils/logger.js';
import { createMetricsCollector } from '../utils/metrics.js';
import { sendPaymentReminderEmail } from '../services/payment-reminder-email.js';
import { Invoice } from '../types/domain.js';

/**
 * Cloudflare Worker Cron Job: Payment Reminders
 *
 * Purpose: Send payment reminder emails for overdue invoices.
 *
 * Schedule: Runs daily at 9 AM UTC (`0 9 * * *`)
 *
 * Design Decisions:
 * 1. Idempotent: Uses email_notifications table to prevent duplicate reminders
 * 2. Configurable: Only sends reminders for invoices past due date
 * 3. Smart Scheduling: Sends reminders at 7, 14, 21, and 30 days overdue
 * 4. Error Handling: Logs errors for individual invoices but continues processing others.
 * 5. Metrics: Tracks reminders sent, skipped, and failed.
 *
 * Process:
 * 1. Find all unpaid invoices past due date
 * 2. Check if reminder already sent today (prevent spam)
 * 3. Calculate days overdue
 * 4. Send reminder if appropriate (based on days overdue)
 * 5. Track email in database
 */

interface ReminderStats {
  totalOverdue: number;
  remindersSent: number;
  skipped: number;
  failed: number;
}

/**
 * Get overdue invoices that need reminders
 */
async function getOverdueInvoices(pool: any): Promise<Array<Invoice & { dueDate: Date; daysOverdue: number }>> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await pool.query<Invoice & { due_date: Date }>(
    `SELECT 
      i.id, i.organisation_id, i.invoice_number, i.status,
      i.subtotal, i.tax_amount as tax, i.total, i.currency,
      i.month, i.year, i.due_date, i.issued_at, i.paid_at,
      i.created_at, i.updated_at
    FROM invoices i
    WHERE i.status IN ('pending', 'overdue')
      AND i.due_date < $1
      AND i.paid_at IS NULL
    ORDER BY i.due_date ASC`,
    [today]
  );

  return result.rows.map((row) => {
    const dueDate = new Date(row.due_date);
    const daysOverdue = Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

    return {
      id: row.id,
      organisationId: row.organisation_id,
      invoiceNumber: row.invoice_number,
      status: row.status as Invoice['status'],
      subtotal: row.subtotal.toString(),
      tax: row.tax.toString(),
      total: row.total.toString(),
      currency: row.currency,
      month: row.month,
      year: row.year,
      dueDate,
      issuedAt: row.issued_at || undefined,
      paidAt: row.paid_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      daysOverdue,
    };
  });
}

/**
 * Check if reminder was already sent today for this invoice
 */
async function wasReminderSentToday(
  pool: any,
  invoiceId: string
): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM email_notifications
     WHERE invoice_id = $1
       AND subject LIKE '%Payment Reminder%'
       AND created_at >= $2`,
    [invoiceId, today]
  );

  return parseInt(result.rows[0]?.count || '0', 10) > 0;
}

/**
 * Determine if reminder should be sent based on days overdue
 * Sends reminders at: 1, 7, 14, 21, 30 days overdue, then weekly
 */
function shouldSendReminder(daysOverdue: number, lastReminderDays?: number): boolean {
  // Always send on day 1
  if (daysOverdue === 1) return true;

  // Send at specific milestones
  const milestones = [7, 14, 21, 30];
  if (milestones.includes(daysOverdue)) return true;

  // After 30 days, send weekly (every 7 days)
  if (daysOverdue > 30 && daysOverdue % 7 === 0) return true;

  // If we have last reminder info, send if 7+ days have passed
  if (lastReminderDays !== undefined && daysOverdue - lastReminderDays >= 7) {
    return true;
  }

  return false;
}

export async function handlePaymentRemindersCron(
  event: ScheduledEvent,
  env: Env
): Promise<void> {
  const logger = createLogger(env);
  const metrics = createMetricsCollector();
  const pool = createRdsPool(env);

  const startTime = Date.now();
  const stats: ReminderStats = {
    totalOverdue: 0,
    remindersSent: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    logger.info('Starting payment reminder cron job', {
      cron: event.cron,
      scheduledTime: new Date(event.scheduledTime).toISOString(),
    });

    // Get overdue invoices
    const overdueInvoices = await getOverdueInvoices(pool);
    stats.totalOverdue = overdueInvoices.length;

    logger.info(`Found ${overdueInvoices.length} overdue invoices`);

    for (const invoice of overdueInvoices) {
      try {
        // Check if reminder already sent today
        const alreadySent = await wasReminderSentToday(pool, invoice.id);
        if (alreadySent) {
          stats.skipped++;
          logger.debug('Reminder already sent today, skipping', {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
          });
          continue;
        }

        // Check if we should send reminder based on days overdue
        if (!shouldSendReminder(invoice.daysOverdue)) {
          stats.skipped++;
          logger.debug('Not time to send reminder yet', {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            daysOverdue: invoice.daysOverdue,
          });
          continue;
        }

        // Send reminder email
        await sendPaymentReminderEmail(env, pool, invoice);
        stats.remindersSent++;

        logger.info('Payment reminder sent', {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          daysOverdue: invoice.daysOverdue,
          organisationId: invoice.organisationId,
        });

        metrics.increment('payment_reminders.sent', {
          organisation_id: invoice.organisationId,
          days_overdue: invoice.daysOverdue.toString(),
        });
      } catch (error) {
        stats.failed++;
        logger.error('Failed to send payment reminder', {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });

        metrics.increment('payment_reminders.failed', {
          organisation_id: invoice.organisationId,
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.info('Payment reminder cron job completed', {
      totalOverdue: stats.totalOverdue,
      remindersSent: stats.remindersSent,
      skipped: stats.skipped,
      failed: stats.failed,
      durationMs: duration,
    });

    // Emit metrics
    metrics.gauge('payment_reminders.total_overdue', stats.totalOverdue);
    metrics.gauge('payment_reminders.sent', stats.remindersSent);
    metrics.gauge('payment_reminders.skipped', stats.skipped);
    metrics.gauge('payment_reminders.failed', stats.failed);
    metrics.gauge('payment_reminders.duration_ms', duration);

    if (stats.failed > 0) {
      logger.warn('Some payment reminders failed', {
        failed: stats.failed,
        total: stats.totalOverdue,
      });
      metrics.increment('payment_reminders.partial_failure');
    }
  } catch (error) {
    logger.fatal('Fatal error in payment reminder cron job', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      cron: event.cron,
    });
    metrics.increment('payment_reminders.cron.fatal_error');
    throw error;
  } finally {
    await pool.end(); // Close the RDS pool connection
  }
}

export default {
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await handlePaymentRemindersCron(event, env);
  },
};
