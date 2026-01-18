import { Env } from './types/env.js';
import { handleIngestion } from './workers/ingestion.js';
import { handleEvents } from './workers/events.js';
import { handleRazorpayWebhook } from './workers/webhook.js';
import { handleCreatePaymentOrder } from './workers/payments.js';
import { handleAdminApi } from './workers/admin/index.js';
import { handleQueueBatch, QueueMessage } from './workers/queue-consumer.js';
import { handleD1ToRdsMigration } from './workers/cron-d1-to-rds.js';
import { handleReconciliation } from './workers/cron-reconciliation.js';
import { handleD1Cleanup } from './workers/cron-d1-cleanup.js';
import invoiceGenerationCron from './workers/cron-invoice-generation.js';
import paymentRetryCron from './workers/cron-payment-retry.js';
import alertEvaluationCron from './workers/cron-alert-evaluation.js';
import exchangeRateSyncCron from './workers/cron-exchange-rate-sync.js';
import paymentRemindersCron from './workers/cron-payment-reminders.js';

/**
 * Main Cloudflare Worker entry point
 */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route to events endpoint (new implementation)
    if (url.pathname === '/events' || url.pathname === '/api/v1/events') {
      return handleEvents(request, env);
    }

    // Route to ingestion endpoint (legacy)
    if (url.pathname === '/ingest' || url.pathname === '/api/v1/ingest') {
      return handleIngestion(request, env);
    }

    // Razorpay webhook endpoint
    if (url.pathname === '/webhooks/razorpay' || url.pathname === '/api/v1/webhooks/razorpay') {
      return handleRazorpayWebhook(request, env);
    }

    // Payment order creation endpoint
    if (url.pathname === '/api/v1/payments/orders') {
      return handleCreatePaymentOrder(request, env);
    }

    // Admin API endpoints
    if (url.pathname.startsWith('/api/v1/admin')) {
      return handleAdminApi(request, env);
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    return handleQueueBatch(batch, env);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Handle cron triggers
    if (event.cron === '*/5 * * * *') {
      // D1 to RDS migration - runs every 5 minutes
      await handleD1ToRdsMigration(event, env);
    } else if (event.cron === '0 2 * * *') {
      // Reconciliation - runs daily at 2 AM UTC
      await handleReconciliation(event, env);
    } else if (event.cron === '0 3 * * *') {
      // D1 cleanup - runs daily at 3 AM UTC
      await handleD1Cleanup(event, env);
    } else if (event.cron === '0 2 1 * *') {
      // Invoice generation - runs on 1st of each month at 2 AM UTC
      await invoiceGenerationCron.scheduled(event, env, ctx);
    } else if (event.cron === '0 */6 * * *') {
      // Payment retry - runs every 6 hours
      await paymentRetryCron.scheduled(event, env, ctx);
    } else if (event.cron === '0 * * * *') {
      // Alert evaluation - runs every hour
      await alertEvaluationCron.scheduled(event, env, ctx);
    } else if (event.cron === '0 1 * * *') {
      // Exchange rate sync - runs daily at 1 AM UTC
      await exchangeRateSyncCron.scheduled(event, env);
    } else if (event.cron === '0 9 * * *') {
      // Payment reminders - runs daily at 9 AM UTC
      await paymentRemindersCron.scheduled(event, env);
    }
  },
};
