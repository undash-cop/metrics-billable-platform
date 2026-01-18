import { Env } from '../types/env.js';
import { Invoice, Payment } from '../types/domain.js';
import { queryRds, transaction } from '../db/rds.js';
import { createAuditLog } from '../db/audit.js';
import { withIdempotency } from '../db/idempotency.js';
import { NotFoundError, PaymentError } from '../utils/errors.js';
import { createHmacSha256, timingSafeEqual } from '../utils/crypto.js';

/**
 * Razorpay integration service
 * Handles payment creation and webhook reconciliation
 */

export interface RazorpayOrderRequest {
  amount: number; // Amount in paise (smallest currency unit)
  currency: string;
  receipt?: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResponse {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  created_at: number;
}

export interface RazorpayPaymentWebhook {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    payment: {
      entity: {
        id: string;
        entity: string;
        amount: number;
        currency: string;
        status: string;
        order_id: string;
        invoice_id: string | null;
        international: boolean;
        method: string;
        amount_refunded: number;
        refund_status: string | null;
        captured: boolean;
        description: string | null;
        card_id: string | null;
        bank: string | null;
        wallet: string | null;
        vpa: string | null;
        email: string;
        contact: string;
        notes: Record<string, string>;
        fee: number;
        tax: number;
        error_code: string | null;
        error_description: string | null;
        created_at: number;
      };
    };
  };
}

/**
 * Create a Razorpay order for an invoice
 */
export async function createRazorpayOrder(
  env: Env,
  invoice: Invoice,
  customerId?: string
): Promise<RazorpayOrderResponse> {
  // Convert amount from rupees to paise
  const amountInPaise = Math.round(parseFloat(invoice.total) * 100);

  const orderRequest: RazorpayOrderRequest = {
    amount: amountInPaise,
    currency: invoice.currency,
    receipt: invoice.invoiceNumber,
    notes: {
      invoice_id: invoice.id,
      organisation_id: invoice.organisationId,
    },
  };

  const url = 'https://api.razorpay.com/v1/orders';
  // Base64 encode credentials for Basic Auth
  const credentials = `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`;
  const auth = btoa(credentials);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(orderRequest),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new PaymentError(`Failed to create Razorpay order: ${error}`);
  }

  return await response.json();
}

/**
 * Verify Razorpay webhook signature
 */
export async function verifyRazorpayWebhook(
  env: Env,
  payload: string,
  signature: string
): Promise<boolean> {
  const expectedSignature = await createHmacSha256(
    env.RAZORPAY_WEBHOOK_SECRET,
    payload
  );
  return timingSafeEqual(signature, expectedSignature);
}

/**
 * Process Razorpay payment webhook
 */
export async function processRazorpayWebhook(
  pool: pg.Pool,
  env: Env,
  webhook: RazorpayPaymentWebhook
): Promise<Payment> {
  const paymentEntity = webhook.payload.payment.entity;
  const razorpayPaymentId = paymentEntity.id;

  // Use idempotency key from Razorpay payment ID
  const idempotencyKey = `razorpay_${razorpayPaymentId}`;

  return await withIdempotency(
    pool,
    idempotencyKey,
    'payment',
    async () => {
      // Find invoice from order ID or notes
      let invoice: Invoice | null = null;

      if (paymentEntity.invoice_id) {
        // Try to find by invoice ID in notes or order
        const invoiceResult = await queryRds<Invoice>(
          pool,
          `SELECT id, organisation_id, invoice_number, status, subtotal, tax, total,
                  currency, month, year, due_date, issued_at, paid_at,
                  created_at, updated_at
           FROM invoices
           WHERE id = $1`,
          [paymentEntity.invoice_id]
        );

        if (invoiceResult.rows.length > 0) {
          const row = invoiceResult.rows[0];
          invoice = {
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
            dueDate: row.due_date,
            issuedAt: row.issued_at || undefined,
            paidAt: row.paid_at || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        }
      }

      // If not found, try to find by order ID (which contains invoice number)
      if (!invoice && paymentEntity.order_id) {
        // Extract invoice number from order receipt
        // This is a fallback - ideally invoice_id should be in notes
        // For now, we'll need to query by organisation and amount match
        // This is a simplified approach - in production, you'd want better matching
      }

      if (!invoice) {
        throw new NotFoundError(
          `Invoice not found for Razorpay payment ${razorpayPaymentId}`
        );
      }

      // Determine payment status
      let status: Payment['status'] = 'pending';
      if (paymentEntity.status === 'authorized') {
        status = 'authorized';
      } else if (paymentEntity.status === 'captured') {
        status = 'captured';
      } else if (paymentEntity.status === 'failed') {
        status = 'failed';
      } else if (paymentEntity.status === 'refunded') {
        status = 'refunded';
      }

      // Convert amount from paise to rupees
      const amount = (paymentEntity.amount / 100).toFixed(2);

      // Create payment record
      const paymentResult = await queryRds<Payment>(
        pool,
        `INSERT INTO payments (
          organisation_id, invoice_id, razorpay_payment_id, razorpay_order_id,
          amount, currency, status, payment_method, paid_at, reconciled_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, organisation_id, invoice_id, razorpay_payment_id, razorpay_order_id,
                  amount, currency, status, payment_method, paid_at, reconciled_at,
                  metadata, created_at, updated_at`,
        [
          invoice.organisationId,
          invoice.id,
          razorpayPaymentId,
          paymentEntity.order_id || null,
          amount,
          paymentEntity.currency,
          status,
          paymentEntity.method || null,
          paymentEntity.status === 'captured' ? new Date(paymentEntity.created_at * 1000) : null,
          new Date(), // Mark as reconciled immediately
          JSON.stringify({
            razorpay_status: paymentEntity.status,
            email: paymentEntity.email,
            contact: paymentEntity.contact,
            notes: paymentEntity.notes,
          }),
        ]
      );

      const paymentRow = paymentResult.rows[0];
      const payment: Payment = {
        id: paymentRow.id,
        organisationId: paymentRow.organisation_id,
        invoiceId: paymentRow.invoice_id,
        razorpayPaymentId: paymentRow.razorpay_payment_id,
        razorpayOrderId: paymentRow.razorpay_order_id || undefined,
        amount: paymentRow.amount.toString(),
        currency: paymentRow.currency,
        status: paymentRow.status as Payment['status'],
        paymentMethod: paymentRow.payment_method || undefined,
        paidAt: paymentRow.paid_at || undefined,
        reconciledAt: paymentRow.reconciled_at || undefined,
        metadata: paymentRow.metadata ? (typeof paymentRow.metadata === 'string' ? JSON.parse(paymentRow.metadata) : paymentRow.metadata) : undefined,
        createdAt: paymentRow.created_at,
        updatedAt: paymentRow.updated_at,
      };

      // Update invoice status if payment is captured
      if (status === 'captured') {
        await queryRds(
          pool,
          `UPDATE invoices
           SET status = 'paid', paid_at = NOW()
           WHERE id = $1`,
          [invoice.id]
        );

        // Create audit log for invoice payment
        await createAuditLog(pool, {
          organisationId: invoice.organisationId,
          entityType: 'invoice',
          entityId: invoice.id,
          action: 'paid',
          changes: {
            paymentId: payment.id,
            razorpayPaymentId: payment.razorpayPaymentId,
          },
        });
      }

      // Create audit log for payment
      await createAuditLog(pool, {
        organisationId: payment.organisationId,
        entityType: 'payment',
        entityId: payment.id,
        action: 'created',
        changes: {
          razorpayPaymentId: payment.razorpayPaymentId,
          status: payment.status,
          amount: payment.amount,
        },
      });

      return { id: payment.id, result: payment };
    }
  );
}
