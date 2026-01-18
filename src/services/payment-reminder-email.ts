import { Env } from '../types/env.js';
import { Invoice } from '../types/domain.js';
import { sendEmail, trackEmail } from './email-service.js';
import { createLogger } from '../utils/logger.js';
import { queryRds } from '../db/rds.js';
import pg from 'pg';
import { getOrganisationBillingEmail, getOrganisationName } from './invoice-email.js';

/**
 * Payment Reminder Email Service
 * 
 * Handles sending payment reminder emails for overdue invoices.
 */

/**
 * Generate payment reminder email HTML
 */
function generatePaymentReminderEmailHtml(data: {
  invoiceNumber: string;
  total: string;
  currency: string;
  dueDate: string;
  daysOverdue: number;
  organisationName: string;
  paymentUrl?: string;
}): string {
  const urgencyColor = data.daysOverdue > 30 ? '#dc2626' : data.daysOverdue > 14 ? '#f59e0b' : '#3b82f6';
  const urgencyText = data.daysOverdue > 30 ? 'Urgent' : data.daysOverdue > 14 ? 'Important' : 'Reminder';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Reminder</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: ${urgencyColor};
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .header .badge {
      display: inline-block;
      margin-top: 10px;
      padding: 4px 12px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .content {
      padding: 30px 20px;
    }
    .invoice-details {
      background: #f9fafb;
      border-left: 4px solid ${urgencyColor};
      padding: 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .invoice-details h2 {
      margin: 0 0 15px 0;
      color: #1f2937;
      font-size: 18px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: #6b7280;
      font-weight: 500;
    }
    .detail-value {
      color: #1f2937;
      font-weight: 600;
    }
    .total-row {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 2px solid ${urgencyColor};
    }
    .total-row .detail-value {
      font-size: 20px;
      color: ${urgencyColor};
    }
    .button {
      display: inline-block;
      padding: 14px 28px;
      background: ${urgencyColor};
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      margin: 20px 0;
      text-align: center;
    }
    .button:hover {
      opacity: 0.9;
    }
    .footer {
      padding: 20px;
      background: #f9fafb;
      text-align: center;
      color: #6b7280;
      font-size: 12px;
      border-top: 1px solid #e5e7eb;
    }
    .warning {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px;
      margin: 20px 0;
      border-radius: 4px;
      color: #92400e;
    }
    .warning strong {
      display: block;
      margin-bottom: 5px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Payment Reminder</h1>
      <span class="badge">${urgencyText}</span>
    </div>
    <div class="content">
      <p>Dear ${data.organisationName},</p>
      <p>This is a friendly reminder that your invoice payment is ${data.daysOverdue === 0 ? 'due today' : `${data.daysOverdue} day${data.daysOverdue === 1 ? '' : 's'} overdue`}.</p>
      
      ${data.daysOverdue > 14 ? `
      <div class="warning">
        <strong>⚠️ Important Notice</strong>
        Your invoice is significantly overdue. Please arrange payment as soon as possible to avoid any service interruptions.
      </div>
      ` : ''}
      
      <div class="invoice-details">
        <h2>Invoice Details</h2>
        <div class="detail-row">
          <span class="detail-label">Invoice Number:</span>
          <span class="detail-value">${data.invoiceNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Due Date:</span>
          <span class="detail-value">${data.dueDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Days Overdue:</span>
          <span class="detail-value">${data.daysOverdue}</span>
        </div>
        <div class="detail-row total-row">
          <span class="detail-label">Amount Due:</span>
          <span class="detail-value">${data.total} ${data.currency}</span>
        </div>
      </div>
      
      ${data.paymentUrl ? `
      <a href="${data.paymentUrl}" class="button">Pay Now</a>
      ` : `
      <p>Please make payment at your earliest convenience. If you have already made payment, please ignore this reminder.</p>
      `}
      
      <p>If you have any questions or concerns, please contact our billing team.</p>
      
      <p>Thank you for your attention to this matter.</p>
    </div>
    <div class="footer">
      <p>This is an automated reminder. Please do not reply to this email.</p>
      <p>If you have questions, please contact our support team.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Send payment reminder email for an overdue invoice
 */
export async function sendPaymentReminderEmail(
  env: Env,
  pool: pg.Pool,
  invoice: Invoice & { dueDate: Date }
): Promise<void> {
  const logger = createLogger(env);

  try {
    // Calculate days overdue
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(invoice.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    const daysOverdue = Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

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

    // Format due date
    const dueDateFormatted = new Date(invoice.dueDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Build payment URL (if available)
    const baseUrl = env.BASE_URL || 'https://your-worker.workers.dev';
    const paymentUrl = `${baseUrl}/api/v1/admin/invoices/${invoice.id}`;

    // Generate email HTML
    const html = generatePaymentReminderEmailHtml({
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      currency: invoice.currency,
      dueDate: dueDateFormatted,
      daysOverdue,
      organisationName,
      paymentUrl,
    });

    // Determine subject based on urgency
    let subject: string;
    if (daysOverdue > 30) {
      subject = `URGENT: Payment Overdue - Invoice ${invoice.invoiceNumber}`;
    } else if (daysOverdue > 14) {
      subject = `Payment Reminder - Invoice ${invoice.invoiceNumber} (${daysOverdue} days overdue)`;
    } else {
      subject = `Payment Reminder - Invoice ${invoice.invoiceNumber}`;
    }

    // Send email
    const emailResult = await sendEmail(env, {
      to: billingEmail,
      subject,
      html,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        organisationId: invoice.organisationId,
        daysOverdue,
        type: 'payment_reminder',
      },
    });

    // Track email
    await trackEmail(pool, {
      organisationId: invoice.organisationId,
      invoiceId: invoice.id,
      to: billingEmail,
      subject,
      messageId: emailResult.messageId,
      status: emailResult.success ? 'sent' : 'failed',
      error: emailResult.error,
    });

    if (emailResult.success) {
      logger.info('Payment reminder email sent successfully', {
        organisationId: invoice.organisationId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        daysOverdue,
        recipient: billingEmail,
        messageId: emailResult.messageId,
      });
    } else {
      logger.error('Failed to send payment reminder email', {
        organisationId: invoice.organisationId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        daysOverdue,
        recipient: billingEmail,
        error: emailResult.error,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error sending payment reminder email', {
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
        subject: `Payment Reminder - Invoice ${invoice.invoiceNumber}`,
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
