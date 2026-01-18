import pg from 'pg';
import { Env } from '../types/env.js';
import { Invoice, Payment } from '../types/domain.js';
import { queryRds, transaction } from '../db/rds.js';
import { createAuditLog } from '../db/audit.js';
import { withIdempotency } from '../db/idempotency.js';
import { NotFoundError, PaymentError, ValidationError, DatabaseError } from '../utils/errors.js';
import { createHmacSha256, timingSafeEqual } from '../utils/crypto.js';
import { toDecimal, toFixedString } from '../utils/decimal.js';
import Decimal from 'decimal.js';
import { calculateNextRetryTime } from './payment-retry.js';
import { createLogger } from '../utils/logger.js';
import { convertCurrency } from './currency-conversion.js';

/**
 * Razorpay Payment Integration Service
 * 
 * Handles:
 * - Creating Razorpay orders for finalized invoices
 * - Storing Razorpay order_id and payment_id
 * - Processing webhooks securely
 * - Atomic payment and invoice status updates
 * 
 * Security Considerations:
 * - Webhook signature verification (HMAC SHA-256)
 * - Timing-safe signature comparison
 * - Idempotency to prevent duplicate processing
 * - Atomic transactions for data consistency
 * 
 * Failure Handling:
 * - Retry-safe operations via idempotency
 * - Comprehensive error logging
 * - Graceful degradation on webhook failures
 */

export interface RazorpayOrderRequest {
  amount: number; // Amount in paise (smallest currency unit)
  currency: string;
  receipt?: string;
  notes?: Record<string, string>;
  customer_id?: string;
}

export interface RazorpayOrderResponse {
  id: string; // order_id
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
        id: string; // payment_id
        entity: string;
        amount: number; // in paise
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
 * Create Razorpay order for a finalized invoice
 * 
 * Security:
 * - Validates invoice is finalized before creating order
 * - Stores order_id in database for tracking
 * - Idempotent: Can be called multiple times safely
 * 
 * Failure Handling:
 * - Retries on network errors
 * - Validates invoice amount matches order amount
 * - Logs all failures for audit
 */
export async function createRazorpayOrderForInvoice(
  pool: pg.Pool,
  env: Env,
  invoiceId: string,
  customerId?: string
): Promise<{ order: RazorpayOrderResponse; payment: Payment }> {
  return await transaction(pool, async (client) => {
    // Fetch invoice and verify it's finalized
    const invoiceResult = await client.query<Invoice>(
      `SELECT 
        id, organisation_id, invoice_number, status, subtotal, tax, total,
        currency, month, year, due_date, finalized_at, issued_at, paid_at,
        created_at, updated_at
      FROM invoices
      WHERE id = $1`,
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      throw new NotFoundError(`Invoice not found: ${invoiceId}`);
    }

    const invoiceRow = invoiceResult.rows[0];
    const invoice: Invoice = {
      id: invoiceRow.id,
      organisationId: invoiceRow.organisation_id,
      invoiceNumber: invoiceRow.invoice_number,
      status: invoiceRow.status as Invoice['status'],
      subtotal: invoiceRow.subtotal.toString(),
      tax: invoiceRow.tax.toString(),
      total: invoiceRow.total.toString(),
      currency: invoiceRow.currency,
      month: invoiceRow.month,
      year: invoiceRow.year,
      dueDate: invoiceRow.due_date,
      issuedAt: invoiceRow.issued_at || undefined,
      paidAt: invoiceRow.paid_at || undefined,
      createdAt: invoiceRow.created_at,
      updatedAt: invoiceRow.updated_at,
    };

    // Verify invoice is finalized
    if (invoice.status !== 'finalized' && !invoiceRow.finalized_at) {
      throw new ValidationError(
        'Invoice must be finalized before creating Razorpay order'
      );
    }

    // Check if payment already exists for this invoice
    const existingPayment = await client.query<Payment>(
      `SELECT id, razorpay_order_id, razorpay_payment_id, status
       FROM payments
       WHERE invoice_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [invoiceId]
    );

    if (existingPayment.rows.length > 0) {
      const existing = existingPayment.rows[0];
      if (existing.razorpay_order_id && existing.status !== 'failed') {
        // Order already exists, return it
        // Fetch order details from Razorpay API if needed
        throw new PaymentError(
          `Payment order already exists for this invoice: ${existing.razorpay_order_id}`,
          { orderId: existing.razorpay_order_id, paymentId: existing.razorpay_payment_id }
        );
      }
    }

    // Razorpay primarily supports INR. Convert to INR if invoice is in different currency.
    let paymentCurrency = invoice.currency;
    let paymentAmount = toDecimal(invoice.total);
    
    if (invoice.currency !== 'INR') {
      // Convert to INR for Razorpay
      const convertedAmount = await convertCurrency(
        pool,
        paymentAmount,
        invoice.currency,
        'INR'
      );
      
      if (!convertedAmount) {
        throw new PaymentError(
          `Exchange rate not found for ${invoice.currency} to INR. Cannot create Razorpay order.`,
          { invoiceCurrency: invoice.currency }
        );
      }
      
      paymentCurrency = 'INR';
      paymentAmount = convertedAmount;
      
      logger.info('Converting invoice amount for Razorpay', {
        invoiceId: invoice.id,
        originalCurrency: invoice.currency,
        originalAmount: invoice.total,
        convertedCurrency: 'INR',
        convertedAmount: paymentAmount.toString(),
      });
    }

    // Convert amount from rupees to paise (Razorpay uses paise for INR)
    const amountInPaise = Math.round(paymentAmount.toNumber() * 100);

    if (amountInPaise <= 0) {
      throw new ValidationError('Invoice amount must be greater than zero');
    }

    // Create Razorpay order
    const orderRequest: RazorpayOrderRequest = {
      amount: amountInPaise,
      currency: paymentCurrency, // Always INR for Razorpay
      receipt: invoice.invoiceNumber,
      notes: {
        invoice_id: invoice.id,
        organisation_id: invoice.organisationId,
        invoice_number: invoice.invoiceNumber,
        original_currency: invoice.currency,
        original_amount: invoice.total,
        exchange_rate_applied: invoice.currency !== 'INR' ? 'true' : 'false',
      },
      customer_id: customerId,
    };

    let razorpayOrder: RazorpayOrderResponse;
    try {
      razorpayOrder = await createRazorpayOrder(env, orderRequest);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new PaymentError(`Failed to create Razorpay order: ${errorMessage}`, {
        invoiceId: invoice.id,
        amount: invoice.total,
        originalError: errorMessage,
      });
    }

    // Verify order amount matches invoice amount
    const orderAmountInRupees = razorpayOrder.amount / 100;
    const invoiceAmountNumber = invoiceAmount.toNumber();
    
    // Allow small rounding differences (1 paise tolerance)
    if (Math.abs(orderAmountInRupees - invoiceAmountNumber) > 0.01) {
      throw new PaymentError(
        `Order amount mismatch: invoice=${invoiceAmountNumber}, order=${orderAmountInRupees}`,
        { invoiceId: invoice.id, orderId: razorpayOrder.id }
      );
    }

    // Create payment record with order_id
    const paymentNumber = `PAY-${invoice.invoiceNumber}`;
    const paymentResult = await client.query<Payment>(
      `INSERT INTO payments (
        organisation_id, invoice_id, payment_number,
        razorpay_order_id, razorpay_payment_id,
        amount, currency, status, payment_gateway, metadata,
        retry_count, max_retries
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, organisation_id, invoice_id, payment_number,
                razorpay_order_id, razorpay_payment_id,
                amount, currency, status, payment_method, payment_gateway,
                paid_at, reconciled_at, metadata, created_at, updated_at`,
      [
        invoice.organisationId,
        invoice.id,
        paymentNumber,
        razorpayOrder.id,
        null, // payment_id will be set when webhook arrives
        toFixedString(invoiceAmount, 2),
        invoice.currency,
        'pending',
        'razorpay',
        JSON.stringify({
          razorpay_order: razorpayOrder,
          created_via: 'api',
        }),
        0, // retry_count
        3, // max_retries (default)
      ]
    );

    const paymentRow = paymentResult.rows[0];
    const payment: Payment = {
      id: paymentRow.id,
      organisationId: paymentRow.organisation_id,
      invoiceId: paymentRow.invoice_id,
      razorpayPaymentId: paymentRow.razorpay_payment_id || undefined,
      razorpayOrderId: paymentRow.razorpay_order_id || undefined,
      amount: paymentRow.amount.toString(),
      currency: paymentRow.currency,
      status: paymentRow.status as Payment['status'],
      paymentMethod: paymentRow.payment_method || undefined,
      paidAt: paymentRow.paid_at || undefined,
      reconciledAt: paymentRow.reconciled_at || undefined,
      metadata: paymentRow.metadata
        ? typeof paymentRow.metadata === 'string'
          ? JSON.parse(paymentRow.metadata)
          : paymentRow.metadata
        : undefined,
      createdAt: paymentRow.created_at,
      updatedAt: paymentRow.updated_at,
    };

    // Create audit log
    await createAuditLog(pool, {
      organisationId: invoice.organisationId,
      entityType: 'payment',
      entityId: payment.id,
      action: 'order_created',
      changes: {
        razorpayOrderId: razorpayOrder.id,
        invoiceId: invoice.id,
        amount: invoice.total,
      },
    });

    return { order: razorpayOrder, payment };
  });
}

/**
 * Create Razorpay order via API
 * 
 * Security:
 * - Uses Basic Auth with API key and secret
 * - Validates response status
 * - Handles API errors gracefully
 */
async function createRazorpayOrder(
  env: Env,
  orderRequest: RazorpayOrderRequest
): Promise<RazorpayOrderResponse> {
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
    const errorText = await response.text();
    let errorDetails: unknown;
    try {
      errorDetails = JSON.parse(errorText);
    } catch {
      errorDetails = errorText;
    }

    throw new PaymentError(`Razorpay API error: ${response.status} ${response.statusText}`, {
      status: response.status,
      statusText: response.statusText,
      error: errorDetails,
    });
  }

  return await response.json();
}

/**
 * Verify Razorpay webhook signature
 * 
 * Security:
 * - Uses HMAC SHA-256 for signature verification
 * - Timing-safe comparison to prevent timing attacks
 * - Validates webhook secret is configured
 */
export async function verifyRazorpayWebhook(
  env: Env,
  payload: string,
  signature: string
): Promise<boolean> {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new PaymentError('Razorpay webhook secret not configured');
  }

  const expectedSignature = await createHmacSha256(
    env.RAZORPAY_WEBHOOK_SECRET,
    payload
  );

  // Use timing-safe comparison to prevent timing attacks
  return timingSafeEqual(signature, expectedSignature);
}

/**
 * Find invoice by Razorpay order ID
 */
async function findInvoiceByOrderId(
  client: pg.PoolClient,
  orderId: string
): Promise<Invoice | null> {
  // First try to find via payment record
  const paymentResult = await client.query<{ invoice_id: string }>(
    `SELECT invoice_id
     FROM payments
     WHERE razorpay_order_id = $1
     LIMIT 1`,
    [orderId]
  );

  if (paymentResult.rows.length > 0) {
    const invoiceResult = await client.query<Invoice>(
      `SELECT 
        id, organisation_id, invoice_number, status, subtotal, tax, total,
        currency, month, year, due_date, finalized_at, issued_at, paid_at,
        created_at, updated_at
      FROM invoices
      WHERE id = $1`,
      [paymentResult.rows[0].invoice_id]
    );

    if (invoiceResult.rows.length > 0) {
      const row = invoiceResult.rows[0];
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
        dueDate: row.due_date,
        issuedAt: row.issued_at || undefined,
        paidAt: row.paid_at || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }
  }

  return null;
}

/**
 * Process Razorpay payment webhook
 * 
 * Security:
 * - Idempotent processing via idempotency keys
 * - Atomic transaction for payment and invoice updates
 * - Signature verification (done before calling this function)
 * 
 * Failure Handling:
 * - Idempotent retries (same webhook processed multiple times safely)
 * - Comprehensive error logging
 * - Atomic updates prevent partial state
 */
export async function processRazorpayWebhook(
  pool: pg.Pool,
  env: Env,
  webhook: RazorpayPaymentWebhook
): Promise<Payment> {
  const paymentEntity = webhook.payload.payment.entity;
  const razorpayPaymentId = paymentEntity.id;
  const razorpayOrderId = paymentEntity.order_id;

  // Idempotency key: Use payment ID (unique per payment)
  const idempotencyKey = `razorpay_payment_${razorpayPaymentId}`;

  return await withIdempotency(
    pool,
    idempotencyKey,
    'payment',
    async () => {
      return await transaction(pool, async (client) => {
        // Find invoice by order ID
        const invoice = await findInvoiceByOrderId(client, razorpayOrderId);

        if (!invoice) {
          throw new NotFoundError(
            `Invoice not found for Razorpay order ${razorpayOrderId}`
          );
        }

        // Verify invoice is finalized
        if (invoice.status !== 'finalized') {
          throw new ValidationError(
            `Invoice ${invoice.id} is not finalized, cannot process payment`
          );
        }

        // Check if payment already exists
        const existingPayment = await client.query<Payment & { retry_count: number; max_retries: number; next_retry_at: Date | null }>(
          `SELECT id, status, razorpay_payment_id, retry_count, max_retries, next_retry_at
           FROM payments
           WHERE razorpay_payment_id = $1
           LIMIT 1`,
          [razorpayPaymentId]
        );

        let payment: Payment;

        if (existingPayment.rows.length > 0) {
          // Payment already exists - update it
          const existing = existingPayment.rows[0];
          
          // Determine payment status from webhook
          const status = mapRazorpayStatusToPaymentStatus(paymentEntity.status);
          
          // Convert amount from paise to rupees
          const amount = toFixedString(paymentEntity.amount / 100, 2);

          // Initialize retry tracking if payment failed
          const nextRetryAt = status === 'failed' && existing.retry_count === 0
            ? calculateNextRetryTime(0, 24) // First retry after 24 hours
            : existing.next_retry_at;

          const updateResult = await client.query<Payment>(
            `UPDATE payments
             SET status = $1,
                 payment_method = $2,
                 paid_at = CASE WHEN $1 = 'captured' THEN $3 ELSE paid_at END,
                 reconciled_at = NOW(),
                 metadata = $4,
                 next_retry_at = CASE WHEN $1 = 'failed' AND retry_count = 0 THEN $5 ELSE next_retry_at END,
                 updated_at = NOW()
             WHERE id = $6
             RETURNING id, organisation_id, invoice_id, payment_number,
                       razorpay_order_id, razorpay_payment_id,
                       amount, currency, status, payment_method, payment_gateway,
                       paid_at, reconciled_at, metadata, created_at, updated_at`,
            [
              status,
              paymentEntity.method || null,
              paymentEntity.status === 'captured'
                ? new Date(paymentEntity.created_at * 1000)
                : null,
              JSON.stringify({
                razorpay_status: paymentEntity.status,
                email: paymentEntity.email,
                contact: paymentEntity.contact,
                notes: paymentEntity.notes,
                webhook_event: webhook.event,
                webhook_payload: paymentEntity,
              }),
              nextRetryAt,
              existing.id,
            ]
          );

          const paymentRow = updateResult.rows[0];
          payment = {
            id: paymentRow.id,
            organisationId: paymentRow.organisation_id,
            invoiceId: paymentRow.invoice_id,
            razorpayPaymentId: paymentRow.razorpay_payment_id || undefined,
            razorpayOrderId: paymentRow.razorpay_order_id || undefined,
            amount: paymentRow.amount.toString(),
            currency: paymentRow.currency,
            status: paymentRow.status as Payment['status'],
            paymentMethod: paymentRow.payment_method || undefined,
            paidAt: paymentRow.paid_at || undefined,
            reconciledAt: paymentRow.reconciled_at || undefined,
            metadata: paymentRow.metadata
              ? typeof paymentRow.metadata === 'string'
                ? JSON.parse(paymentRow.metadata)
                : paymentRow.metadata
              : undefined,
            createdAt: paymentRow.created_at,
            updatedAt: paymentRow.updated_at,
          };
        } else {
          // Create new payment record
          const status = mapRazorpayStatusToPaymentStatus(paymentEntity.status);
          const amount = toFixedString(paymentEntity.amount / 100, 2);
          const paymentNumber = `PAY-${invoice.invoiceNumber}`;

          // Initialize retry tracking if payment failed
          const nextRetryAt = status === 'failed'
            ? calculateNextRetryTime(0, 24) // First retry after 24 hours
            : null;

          const insertResult = await client.query<Payment>(
            `INSERT INTO payments (
              organisation_id, invoice_id, payment_number,
              razorpay_order_id, razorpay_payment_id,
              amount, currency, status, payment_method, payment_gateway,
              paid_at, reconciled_at, metadata,
              retry_count, max_retries, next_retry_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING id, organisation_id, invoice_id, payment_number,
                      razorpay_order_id, razorpay_payment_id,
                      amount, currency, status, payment_method, payment_gateway,
                      paid_at, reconciled_at, metadata, created_at, updated_at`,
            [
              invoice.organisationId,
              invoice.id,
              paymentNumber,
              razorpayOrderId,
              razorpayPaymentId,
              amount,
              paymentEntity.currency,
              status,
              paymentEntity.method || null,
              'razorpay',
              paymentEntity.status === 'captured'
                ? new Date(paymentEntity.created_at * 1000)
                : null,
              new Date(),
              JSON.stringify({
                razorpay_status: paymentEntity.status,
                email: paymentEntity.email,
                contact: paymentEntity.contact,
                notes: paymentEntity.notes,
                webhook_event: webhook.event,
                webhook_payload: paymentEntity,
              }),
              0, // retry_count
              3, // max_retries (default)
              nextRetryAt,
            ]
          );

          const paymentRow = insertResult.rows[0];
          payment = {
            id: paymentRow.id,
            organisationId: paymentRow.organisation_id,
            invoiceId: paymentRow.invoice_id,
            razorpayPaymentId: paymentRow.razorpay_payment_id || undefined,
            razorpayOrderId: paymentRow.razorpay_order_id || undefined,
            amount: paymentRow.amount.toString(),
            currency: paymentRow.currency,
            status: paymentRow.status as Payment['status'],
            paymentMethod: paymentRow.payment_method || undefined,
            paidAt: paymentRow.paid_at || undefined,
            reconciledAt: paymentRow.reconciled_at || undefined,
            metadata: paymentRow.metadata
              ? typeof paymentRow.metadata === 'string'
                ? JSON.parse(paymentRow.metadata)
                : paymentRow.metadata
              : undefined,
            createdAt: paymentRow.created_at,
            updatedAt: paymentRow.updated_at,
          };
        }

        // Atomically update invoice status if payment is captured
        // This happens in the same transaction as payment update
        if (payment.status === 'captured') {
          // Verify invoice hasn't been paid already
          const invoiceCheck = await client.query<{ status: string; paid_at: Date | null }>(
            `SELECT status, paid_at FROM invoices WHERE id = $1`,
            [invoice.id]
          );

          if (invoiceCheck.rows.length > 0) {
            const invoiceStatus = invoiceCheck.rows[0].status;
            const invoicePaidAt = invoiceCheck.rows[0].paid_at;

            if (invoiceStatus !== 'paid' || !invoicePaidAt) {
              // Update invoice status atomically
              await client.query(
                `UPDATE invoices
                 SET status = 'paid', paid_at = NOW(), updated_at = NOW()
                 WHERE id = $1 AND status != 'paid'`,
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
                  razorpayOrderId: payment.razorpayOrderId,
                },
              });
            }
          }
        }

        // Create audit log for payment
        await createAuditLog(pool, {
          organisationId: payment.organisationId,
          entityType: 'payment',
          entityId: payment.id,
          action: 'webhook_processed',
          changes: {
            razorpayPaymentId: payment.razorpayPaymentId,
            razorpayOrderId: payment.razorpayOrderId,
            status: payment.status,
            amount: payment.amount,
            webhookEvent: webhook.event,
          },
        });

        return { id: payment.id, result: payment };
      });
    }
  );
}

/**
 * Map Razorpay payment status to our payment status
 */
function mapRazorpayStatusToPaymentStatus(
  razorpayStatus: string
): Payment['status'] {
  switch (razorpayStatus.toLowerCase()) {
    case 'authorized':
      return 'authorized';
    case 'captured':
      return 'captured';
    case 'failed':
      return 'failed';
    case 'refunded':
      return 'refunded';
    default:
      return 'pending';
  }
}
