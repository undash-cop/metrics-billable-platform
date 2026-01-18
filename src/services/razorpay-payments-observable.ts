import pg from 'pg';
import {
  createRazorpayOrderForInvoice,
  processRazorpayWebhook,
} from './razorpay-payments.js';
import { Env } from '../types/env.js';
import { Invoice, Payment } from '../types/domain.js';
import { RazorpayPaymentWebhook } from './razorpay-payments.js';
import { createObservabilityContext, trackOperation } from '../middleware/observability.js';

/**
 * Observable Razorpay Payment Service
 * 
 * Wraps payment operations with observability (logging, metrics, alerts).
 */

export async function createRazorpayOrderForInvoiceObservable(
  pool: pg.Pool,
  env: Env,
  invoiceId: string,
  customerId?: string
): Promise<{ order: unknown; payment: Payment }> {
  const obs = createObservabilityContext(env);

  return await trackOperation(
    obs,
    'razorpay_order_creation',
    {
      invoiceId,
      customerId,
    },
    async () => {
      const startTime = Date.now();

      try {
        const result = await createRazorpayOrderForInvoice(
          pool,
          env,
          invoiceId,
          customerId
        );

        const duration = Date.now() - startTime;

        // Track metrics
        obs.metrics.trackPaymentOperation('order_created', duration, {
          organisationId: result.payment.organisationId,
          invoiceId: result.payment.invoiceId,
          paymentId: result.payment.id,
          razorpayOrderId: result.order.id,
        });

        obs.logger.info('Razorpay order created', {
          organisationId: result.payment.organisationId,
          invoiceId: result.payment.invoiceId,
          paymentId: result.payment.id,
          razorpayOrderId: result.order.id,
          amount: result.payment.amount,
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        obs.metrics.trackPaymentOperation('payment_failed', duration, {
          invoiceId,
          errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN',
        });

        obs.metrics.increment('payments.failures', {
          invoiceId,
        });

        // Check alert threshold
        const alert = obs.alerts.checkThreshold('payments.failures', 1);
        if (alert) {
          obs.logger.error('Payment failure alert triggered', {
            alertId: alert.id,
            severity: alert.severity,
            invoiceId,
          });
        }

        throw error;
      }
    }
  );
}

export async function processRazorpayWebhookObservable(
  pool: pg.Pool,
  env: Env,
  webhook: RazorpayPaymentWebhook
): Promise<Payment> {
  const obs = createObservabilityContext(env);

  return await trackOperation(
    obs,
    'razorpay_webhook_processing',
    {
      razorpayPaymentId: webhook.payload.payment.entity.id,
      razorpayOrderId: webhook.payload.payment.entity.order_id,
      event: webhook.event,
    },
    async () => {
      const startTime = Date.now();

      try {
        const payment = await processRazorpayWebhook(pool, env, webhook);

        const duration = Date.now() - startTime;

        // Track metrics
        const operation =
          payment.status === 'captured'
            ? 'payment_captured'
            : payment.status === 'failed'
            ? 'payment_failed'
            : 'webhook_processed';

        obs.metrics.trackPaymentOperation(operation, duration, {
          organisationId: payment.organisationId,
          invoiceId: payment.invoiceId,
          paymentId: payment.id,
          razorpayPaymentId: payment.razorpayPaymentId,
          razorpayOrderId: payment.razorpayOrderId,
          status: payment.status,
        });

        if (payment.status === 'captured') {
          obs.logger.info('Payment captured successfully', {
            organisationId: payment.organisationId,
            invoiceId: payment.invoiceId,
            paymentId: payment.id,
            razorpayPaymentId: payment.razorpayPaymentId,
            amount: payment.amount,
          });
        } else if (payment.status === 'failed') {
          obs.metrics.increment('payments.failures', {
            organisationId: payment.organisationId,
            invoiceId: payment.invoiceId,
          });

          // Check alert threshold
          const alert = obs.alerts.checkThreshold('payments.failures', 1);
          if (alert) {
            obs.logger.error('Payment failure alert triggered', {
              alertId: alert.id,
              severity: alert.severity,
              paymentId: payment.id,
            });
          }
        }

        return payment;
      } catch (error) {
        const duration = Date.now() - startTime;

        obs.metrics.trackPaymentOperation('payment_failed', duration, {
          razorpayPaymentId: webhook.payload.payment.entity.id,
          errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN',
        });

        obs.metrics.increment('payments.failures');

        // Check alert threshold
        const alert = obs.alerts.checkThreshold('payments.failures', 1);
        if (alert) {
          obs.logger.error('Payment failure alert triggered', {
            alertId: alert.id,
            severity: alert.severity,
          });
        }

        throw error;
      }
    }
  );
}
