import pg from 'pg';
import { generateInvoice, finalizeInvoice } from './invoice-generator.js';
import { InvoiceGenerationRequest } from './invoice-generator.js';
import { Invoice } from '../types/domain.js';
import { createObservabilityContext, trackOperation } from '../middleware/observability.js';
import { Env } from '../types/env.js';

/**
 * Observable Invoice Generator
 * 
 * Wraps invoice generation with observability (logging, metrics, alerts).
 */

export async function generateInvoiceObservable(
  pool: pg.Pool,
  env: Env,
  request: InvoiceGenerationRequest,
  userId?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<Invoice> {
  const obs = createObservabilityContext(env);

  return await trackOperation(
    obs,
    'invoice_generation',
    {
      organisationId: request.organisationId,
      month: request.month,
      year: request.year,
      userId,
    },
    async () => {
      const startTime = Date.now();

      try {
        const invoice = await generateInvoice(
          pool,
          request,
          userId,
          ipAddress,
          userAgent
        );

        const duration = Date.now() - startTime;

        // Track metrics
        obs.metrics.trackBillingOperation('invoice_generated', duration, {
          organisationId: request.organisationId,
          invoiceId: invoice.id,
          month: String(request.month),
          year: String(request.year),
        });

        obs.logger.info('Invoice generated successfully', {
          organisationId: request.organisationId,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.total,
          month: request.month,
          year: request.year,
        });

        return invoice;
      } catch (error) {
        const duration = Date.now() - startTime;

        // Track failure metrics
        obs.metrics.trackBillingOperation('invoice_failed', duration, {
          organisationId: request.organisationId,
          month: String(request.month),
          year: String(request.year),
          errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN',
        });

        obs.metrics.increment('billing.failures', {
          organisationId: request.organisationId,
        });

        // Check alert threshold
        const alert = obs.alerts.checkThreshold('billing.failures', 1);
        if (alert) {
          obs.logger.error('Billing failure alert triggered', {
            alertId: alert.id,
            severity: alert.severity,
            organisationId: request.organisationId,
          });
        }

        throw error;
      }
    }
  );
}

export async function finalizeInvoiceObservable(
  pool: pg.Pool,
  env: Env,
  invoiceId: string,
  userId?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<Invoice> {
  const obs = createObservabilityContext(env);

  return await trackOperation(
    obs,
    'invoice_finalization',
    {
      invoiceId,
      userId,
    },
    async () => {
      const startTime = Date.now();

      try {
        const invoice = await finalizeInvoice(
          pool,
          invoiceId,
          env,
          userId,
          ipAddress,
          userAgent
        );

        const duration = Date.now() - startTime;

        // Track metrics
        obs.metrics.trackBillingOperation('invoice_finalized', duration, {
          organisationId: invoice.organisationId,
          invoiceId: invoice.id,
        });

        return invoice;
      } catch (error) {
        const duration = Date.now() - startTime;
        obs.metrics.trackBillingOperation('invoice_failed', duration, {
          invoiceId,
          errorCode: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN',
        });

        throw error;
      }
    }
  );
}
