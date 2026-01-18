import { Env } from '../types/env.js';
import { createLogger } from '../utils/logger.js';
import { DatabaseError } from '../utils/errors.js';
import pg from 'pg';
import { queryRds } from '../db/rds.js';

/**
 * Email Service
 * 
 * Handles sending emails for invoices, payments, and notifications.
 * Supports multiple email providers (SendGrid, AWS SES, Resend, etc.)
 * 
 * Design Decisions:
 * 1. Provider-agnostic: Can switch email providers easily
 * 2. Async: Email sending is non-blocking
 * 3. Retry: Failed emails are retried
 * 4. Tracking: Email delivery status is tracked
 */

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Get email provider configuration from environment
 */
function getEmailProvider(env: Env): 'sendgrid' | 'ses' | 'resend' | 'none' {
  if (env.SENDGRID_API_KEY) return 'sendgrid';
  if (env.AWS_SES_REGION) return 'ses';
  if (env.RESEND_API_KEY) return 'resend';
  return 'none';
}

/**
 * Send email via SendGrid
 */
async function sendViaSendGrid(
  env: Env,
  options: EmailOptions
): Promise<EmailResult> {
  const apiKey = env.SENDGRID_API_KEY;
  if (!apiKey) {
    throw new Error('SENDGRID_API_KEY not configured');
  }

  const fromEmail = options.from || env.EMAIL_FROM || 'noreply@example.com';
  const fromName = env.EMAIL_FROM_NAME || 'Metrics Billing Platform';

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: options.to }],
          subject: options.subject,
        },
      ],
      from: {
        email: fromEmail,
        name: fromName,
      },
      content: [
        {
          type: 'text/html',
          value: options.html,
        },
        ...(options.text
          ? [
              {
                type: 'text/plain',
                value: options.text,
              },
            ]
          : []),
      ],
      reply_to: options.replyTo
        ? { email: options.replyTo }
        : undefined,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SendGrid API error: ${error}`);
  }

  const messageId = response.headers.get('x-message-id') || undefined;

  return {
    success: true,
    messageId,
  };
}

/**
 * Send email via AWS SES
 */
async function sendViaSES(
  env: Env,
  options: EmailOptions
): Promise<EmailResult> {
  // AWS SES implementation would go here
  // For now, return error as SES requires AWS SDK
  throw new Error('AWS SES not yet implemented. Use SendGrid or Resend.');
}

/**
 * Send email via Resend
 */
async function sendViaResend(
  env: Env,
  options: EmailOptions
): Promise<EmailResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const fromEmail = options.from || env.EMAIL_FROM || 'noreply@example.com';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
      reply_to: options.replyTo,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Resend API error: ${error.message || JSON.stringify(error)}`);
  }

  const data = await response.json();

  return {
    success: true,
    messageId: data.id,
  };
}

/**
 * Send email (provider-agnostic)
 */
export async function sendEmail(
  env: Env,
  options: EmailOptions
): Promise<EmailResult> {
  const logger = createLogger(env.ENVIRONMENT);
  const provider = getEmailProvider(env);

  if (provider === 'none') {
    logger.warn('Email provider not configured, skipping email send', {
      to: options.to,
      subject: options.subject,
    });
    return {
      success: false,
      error: 'Email provider not configured',
    };
  }

  try {
    let result: EmailResult;

    switch (provider) {
      case 'sendgrid':
        result = await sendViaSendGrid(env, options);
        break;
      case 'ses':
        result = await sendViaSES(env, options);
        break;
      case 'resend':
        result = await sendViaResend(env, options);
        break;
      default:
        throw new Error(`Unknown email provider: ${provider}`);
    }

    logger.info('Email sent successfully', {
      to: options.to,
      subject: options.subject,
      messageId: result.messageId,
      provider,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to send email', {
      to: options.to,
      subject: options.subject,
      error: errorMessage,
      provider,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Track email in database
 */
export async function trackEmail(
  pool: pg.Pool,
  options: {
    organisationId?: string;
    invoiceId?: string;
    paymentId?: string;
    to: string;
    subject: string;
    messageId?: string;
    status: 'sent' | 'failed';
    error?: string;
  }
): Promise<void> {
  try {
    await queryRds(
      pool,
      `INSERT INTO email_notifications (
        organisation_id, invoice_id, payment_id,
        recipient_email, subject, message_id,
        status, error_message, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        options.organisationId || null,
        options.invoiceId || null,
        options.paymentId || null,
        options.to,
        options.subject,
        options.messageId || null,
        options.status,
        options.error || null,
      ]
    );
  } catch (error) {
    // Don't fail email sending if tracking fails
    const logger = createLogger('production');
    logger.error('Failed to track email', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Generate invoice email HTML
 */
export function generateInvoiceEmailHtml(invoice: {
  invoiceNumber: string;
  total: string;
  currency: string;
  dueDate: string;
  organisationName: string;
  lineItems: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    total: string;
  }>;
  downloadUrl?: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #646cff; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .invoice-details { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; }
    .line-items { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .line-items th, .line-items td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    .line-items th { background: #f5f5f5; }
    .total { font-size: 1.2em; font-weight: bold; text-align: right; margin-top: 20px; }
    .button { display: inline-block; padding: 12px 24px; background: #646cff; color: white; text-decoration: none; border-radius: 4px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Invoice ${invoice.invoiceNumber}</h1>
    </div>
    <div class="content">
      <p>Dear ${invoice.organisationName},</p>
      <p>Your invoice for the billing period has been generated.</p>
      
      <div class="invoice-details">
        <h2>Invoice Details</h2>
        <table class="line-items">
          <thead>
            <tr>
              <th>Description</th>
              <th>Quantity</th>
              <th>Unit Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${invoice.lineItems
              .map(
                (item) => `
            <tr>
              <td>${item.description}</td>
              <td>${item.quantity}</td>
              <td>${item.unitPrice} ${invoice.currency}</td>
              <td>${item.total} ${invoice.currency}</td>
            </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
        <div class="total">
          Total: ${invoice.total} ${invoice.currency}
        </div>
        <p><strong>Due Date:</strong> ${invoice.dueDate}</p>
      </div>
      
      ${invoice.downloadUrl ? `<a href="${invoice.downloadUrl}" class="button">Download Invoice PDF</a>` : ''}
      
      <p>Thank you for your business!</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate payment confirmation email HTML
 */
export function generatePaymentConfirmationEmailHtml(payment: {
  paymentNumber: string;
  amount: string;
  currency: string;
  invoiceNumber: string;
  organisationName: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10b981; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .payment-details { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Payment Confirmed</h1>
    </div>
    <div class="content">
      <p>Dear ${payment.organisationName},</p>
      <p>Your payment has been successfully processed.</p>
      
      <div class="payment-details">
        <h2>Payment Details</h2>
        <p><strong>Payment Number:</strong> ${payment.paymentNumber}</p>
        <p><strong>Amount:</strong> ${payment.amount} ${payment.currency}</p>
        <p><strong>Invoice:</strong> ${payment.invoiceNumber}</p>
      </div>
      
      <p>Thank you for your payment!</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
