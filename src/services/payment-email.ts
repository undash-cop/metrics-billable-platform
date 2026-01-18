import { Env } from '../types/env.js';
import { Payment } from '../types/domain.js';
import { sendEmail, trackEmail, generatePaymentConfirmationEmailHtml } from './email-service.js';
import { createRdsPool } from '../db/rds.js';
import { createLogger } from '../utils/logger.js';
import { queryRds } from '../db/rds.js';
import pg from 'pg';

/**
 * Payment Email Service
 * 
 * Handles sending payment confirmation emails.
 */

/**
 * Get organisation billing email
 */
async function getOrganisationBillingEmail(
  pool: pg.Pool,
  organisationId: string
): Promise<string | null> {
  const result = await queryRds<{ billing_email: string | null; payment_email_enabled: boolean | null }>(
    pool,
    `SELECT billing_email, payment_email_enabled 
     FROM organisations 
     WHERE id = $1`,
    [organisationId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const org = result.rows[0];
  
  // Check if payment email notifications are enabled (defaults to true if null)
  if (org.payment_email_enabled === false) {
    return null;
  }

  return org.billing_email;
}

/**
 * Get invoice number for payment
 */
async function getInvoiceNumber(
  pool: pg.Pool,
  invoiceId: string
): Promise<string | null> {
  const result = await queryRds<{ invoice_number: string }>(
    pool,
    `SELECT invoice_number FROM invoices WHERE id = $1`,
    [invoiceId]
  );

  return result.rows[0]?.invoice_number || null;
}

/**
 * Get organisation name
 */
async function getOrganisationName(
  pool: pg.Pool,
  organisationId: string
): Promise<string> {
  const result = await queryRds<{ name: string }>(
    pool,
    `SELECT name FROM organisations WHERE id = $1`,
    [organisationId]
  );

  return result.rows[0]?.name || 'Customer';
}

/**
 * Send payment confirmation email
 */
export async function sendPaymentConfirmationEmail(
  env: Env,
  pool: pg.Pool,
  payment: Payment
): Promise<void> {
  const logger = createLogger(env.ENVIRONMENT);

  // Only send email for successful payments
  if (payment.status !== 'captured' && payment.status !== 'paid') {
    logger.info('Skipping payment email for non-successful payment', {
      paymentId: payment.id,
      status: payment.status,
    });
    return;
  }

  try {
    // Get billing email
    const billingEmail = await getOrganisationBillingEmail(pool, payment.organisationId);
    
    if (!billingEmail) {
      logger.info('No billing email configured or notifications disabled', {
        organisationId: payment.organisationId,
        paymentId: payment.id,
      });
      return;
    }

    // Get organisation name
    const organisationName = await getOrganisationName(pool, payment.organisationId);

    // Get invoice number
    const invoiceNumber = payment.invoiceId
      ? await getInvoiceNumber(pool, payment.invoiceId)
      : null;

    // Generate email HTML
    const html = generatePaymentConfirmationEmailHtml({
      paymentNumber: payment.id.substring(0, 8).toUpperCase(), // Use first 8 chars as payment number
      amount: payment.amount,
      currency: payment.currency,
      invoiceNumber: invoiceNumber || 'N/A',
      organisationName,
    });

    // Send email
    const emailResult = await sendEmail(env, {
      to: billingEmail,
      subject: `Payment Confirmed - ${payment.amount} ${payment.currency}`,
      html,
      metadata: {
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        organisationId: payment.organisationId,
      },
    });

    // Track email
    await trackEmail(pool, {
      organisationId: payment.organisationId,
      paymentId: payment.id,
      invoiceId: payment.invoiceId || undefined,
      to: billingEmail,
      subject: `Payment Confirmed - ${payment.amount} ${payment.currency}`,
      messageId: emailResult.messageId,
      status: emailResult.success ? 'sent' : 'failed',
      error: emailResult.error,
    });

    if (emailResult.success) {
      logger.info('Payment confirmation email sent successfully', {
        organisationId: payment.organisationId,
        paymentId: payment.id,
        recipient: billingEmail,
        messageId: emailResult.messageId,
      });
    } else {
      logger.error('Failed to send payment confirmation email', {
        organisationId: payment.organisationId,
        paymentId: payment.id,
        recipient: billingEmail,
        error: emailResult.error,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error sending payment confirmation email', {
      organisationId: payment.organisationId,
      paymentId: payment.id,
      error: errorMessage,
    });

    // Track failed email
    try {
      await trackEmail(pool, {
        organisationId: payment.organisationId,
        paymentId: payment.id,
        to: 'unknown',
        subject: `Payment Confirmed - ${payment.amount} ${payment.currency}`,
        status: 'failed',
        error: errorMessage,
      });
    } catch (trackError) {
      // Don't fail if tracking fails
      logger.error('Failed to track email error', {
        error: trackError instanceof Error ? trackError.message : String(trackError),
      });
    }
  }
}
