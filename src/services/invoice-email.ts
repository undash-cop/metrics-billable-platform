import { Env } from '../types/env.js';
import { Invoice } from '../types/domain.js';
import { sendEmail, trackEmail, generateInvoiceEmailHtml } from './email-service.js';
import { createRdsPool } from '../db/rds.js';
import { createLogger } from '../utils/logger.js';
import { queryRds } from '../db/rds.js';
import pg from 'pg';

/**
 * Invoice Email Service
 * 
 * Handles sending invoice emails after invoice generation.
 */

/**
 * Get organisation billing email
 */
async function getOrganisationBillingEmail(
  pool: pg.Pool,
  organisationId: string
): Promise<string | null> {
  const result = await queryRds<{ billing_email: string | null; email_notifications_enabled: boolean | null }>(
    pool,
    `SELECT billing_email, email_notifications_enabled 
     FROM organisations 
     WHERE id = $1`,
    [organisationId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const org = result.rows[0];
  
  // Check if email notifications are enabled (defaults to true if null)
  if (org.email_notifications_enabled === false) {
    return null;
  }

  return org.billing_email;
}

/**
 * Get invoice line items for email
 */
async function getInvoiceLineItems(
  pool: pg.Pool,
  invoiceId: string
): Promise<Array<{
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
}>> {
  const result = await queryRds<{
    line_number: number;
    description: string;
    quantity: string;
    unit_price: string;
    total: string;
  }>(
    pool,
    `SELECT line_number, description, quantity, unit_price, total
     FROM invoice_line_items
     WHERE invoice_id = $1
     ORDER BY line_number ASC`,
    [invoiceId]
  );

  return result.rows.map((row) => ({
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    total: row.total,
  }));
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
 * Send invoice email
 */
export async function sendInvoiceEmail(
  env: Env,
  pool: pg.Pool,
  invoice: Invoice
): Promise<void> {
  const logger = createLogger(env.ENVIRONMENT);

  try {
    // Get billing email
    const billingEmail = await getOrganisationBillingEmail(pool, invoice.organisationId);
    
    if (!billingEmail) {
      logger.info('No billing email configured or notifications disabled', {
        organisationId: invoice.organisationId,
        invoiceId: invoice.id,
      });
      return;
    }

    // Get organisation name
    const organisationName = await getOrganisationName(pool, invoice.organisationId);

    // Get line items
    const lineItems = await getInvoiceLineItems(pool, invoice.id);

    // Get PDF URL if available
    const pdfResult = await pool.query<{ pdf_url: string | null }>(
      `SELECT pdf_url FROM invoices WHERE id = $1`,
      [invoice.id]
    );
    const pdfUrl = pdfResult.rows[0]?.pdf_url;

    // Format due date
    const dueDate = invoice.dueDate
      ? new Date(invoice.dueDate).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : 'N/A';

    // Build PDF download URL
    const baseUrl = env.BASE_URL || 'https://your-worker.workers.dev';
    const downloadUrl = pdfUrl
      ? `${baseUrl}/api/v1/admin/invoices/${invoice.id}/pdf`
      : undefined;

    // Generate email HTML
    const html = generateInvoiceEmailHtml({
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      currency: invoice.currency,
      dueDate,
      organisationName,
      lineItems,
      downloadUrl,
    });

    // Send email
    const emailResult = await sendEmail(env, {
      to: billingEmail,
      subject: `Invoice ${invoice.invoiceNumber} - ${invoice.total} ${invoice.currency}`,
      html,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        organisationId: invoice.organisationId,
      },
    });

    // Track email
    await trackEmail(pool, {
      organisationId: invoice.organisationId,
      invoiceId: invoice.id,
      to: billingEmail,
      subject: `Invoice ${invoice.invoiceNumber} - ${invoice.total} ${invoice.currency}`,
      messageId: emailResult.messageId,
      status: emailResult.success ? 'sent' : 'failed',
      error: emailResult.error,
    });

    if (emailResult.success) {
      logger.info('Invoice email sent successfully', {
        organisationId: invoice.organisationId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        recipient: billingEmail,
        messageId: emailResult.messageId,
      });
    } else {
      logger.error('Failed to send invoice email', {
        organisationId: invoice.organisationId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        recipient: billingEmail,
        error: emailResult.error,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error sending invoice email', {
      organisationId: invoice.organisationId,
      invoiceId: invoice.id,
      error: errorMessage,
    });

    // Track failed email
    try {
      await trackEmail(pool, {
        organisationId: invoice.organisationId,
        invoiceId: invoice.id,
        to: 'unknown',
        subject: `Invoice ${invoice.invoiceNumber}`,
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
