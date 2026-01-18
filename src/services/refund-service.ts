import pg from 'pg';
import { Env } from '../types/env.js';
import { Payment, Invoice } from '../types/domain.js';
import { queryRds, transaction } from '../db/rds.js';
import { createAuditLog } from '../db/audit.js';
import { withIdempotency } from '../db/idempotency.js';
import {
  NotFoundError,
  ValidationError,
  PaymentError,
  DatabaseError,
} from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { toDecimal, toFixedString } from '../utils/decimal.js';
import Decimal from 'decimal.js';

/**
 * Refund Service
 * 
 * Handles refund processing via Razorpay:
 * - Full refunds
 * - Partial refunds
 * - Refund status tracking
 * - Invoice and payment status updates
 * 
 * Security:
 * - Validates payment exists and is eligible for refund
 * - Ensures refund amount doesn't exceed payment amount
 * - Idempotent operations
 * - Full audit logging
 */

export interface RefundRequest {
  paymentId: string;
  amount?: string; // Optional: for partial refunds. If not provided, refunds full amount
  reason?: string;
  userId?: string;
}

export interface Refund {
  id: string;
  organisationId: string;
  invoiceId: string;
  paymentId: string;
  refundNumber: string;
  razorpayRefundId?: string;
  razorpayPaymentId: string;
  amount: string;
  currency: string;
  status: 'pending' | 'processed' | 'failed' | 'cancelled';
  refundType: 'full' | 'partial';
  reason?: string;
  processedAt?: Date;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RazorpayRefundResponse {
  id: string; // refund_id
  entity: string;
  amount: number; // in paise
  currency: string;
  payment_id: string;
  notes: Record<string, string>;
  receipt: string | null;
  status: string; // 'processed', 'pending', 'failed'
  speed_processed: string;
  speed_requested: string;
  created_at: number;
}

/**
 * Create refund via Razorpay API
 */
async function createRazorpayRefund(
  env: Env,
  paymentId: string,
  amount?: number, // in paise, if not provided refunds full amount
  notes?: Record<string, string>
): Promise<RazorpayRefundResponse> {
  const logger = createLogger(env);
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

  const url = `https://api.razorpay.com/v1/payments/${paymentId}/refund`;
  const body: Record<string, unknown> = {};
  
  if (amount) {
    body.amount = amount;
  }
  if (notes) {
    body.notes = notes;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error('Razorpay refund API error', {
      paymentId,
      statusCode: response.status,
      error: errorBody,
    });
    throw new PaymentError(`Razorpay refund failed: ${errorBody}`);
  }

  const refundData = await response.json();
  return refundData;
}

/**
 * Process refund for a payment
 */
export async function processRefund(
  pool: pg.Pool,
  env: Env,
  request: RefundRequest
): Promise<Refund> {
  const logger = createLogger(env);

  return await transaction(pool, async (client) => {
    // Fetch payment
    const paymentResult = await client.query<Payment & { invoice_id: string; organisation_id: string; refund_amount: string | null }>(
      `SELECT 
        p.*,
        p.invoice_id,
        p.organisation_id,
        COALESCE(p.refund_amount, 0) as refund_amount
      FROM payments p
      WHERE p.id = $1`,
      [request.paymentId]
    );

    if (paymentResult.rows.length === 0) {
      throw new NotFoundError(`Payment not found: ${request.paymentId}`);
    }

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
      createdAt: paymentRow.created_at,
      updatedAt: paymentRow.updated_at,
    };

    // Validate payment is eligible for refund
    if (payment.status !== 'captured') {
      throw new ValidationError(
        `Payment must be captured to refund. Current status: ${payment.status}`
      );
    }

    // Calculate refund amount
    const paymentAmount = toDecimal(payment.amount);
    const existingRefundAmount = toDecimal(paymentRow.refund_amount?.toString() || '0');
    const availableForRefund = paymentAmount.minus(existingRefundAmount);

    if (availableForRefund.isLessThanOrEqualTo(0)) {
      throw new ValidationError('Payment is already fully refunded');
    }

    let refundAmount: Decimal;
    if (request.amount) {
      refundAmount = toDecimal(request.amount);
      if (refundAmount.isGreaterThan(availableForRefund)) {
        throw new ValidationError(
          `Refund amount (${request.amount}) exceeds available amount (${toFixedString(availableForRefund, 2)})`
        );
      }
      if (refundAmount.isLessThanOrEqualTo(0)) {
        throw new ValidationError('Refund amount must be greater than 0');
      }
    } else {
      // Full refund
      refundAmount = availableForRefund;
    }

    // Determine refund type
    const refundType = refundAmount.equals(paymentAmount) ? 'full' : 'partial';

    // Generate refund number
    const invoiceResult = await client.query<{ invoice_number: string }>(
      `SELECT invoice_number FROM invoices WHERE id = $1`,
      [payment.invoiceId]
    );
    const invoiceNumber = invoiceResult.rows[0]?.invoice_number || 'UNKNOWN';
    const refundNumber = `REF-${invoiceNumber}-${Date.now()}`;

    // Create refund record (pending status)
    const refundIdempotencyKey = `refund_${payment.id}_${refundAmount.toString()}_${Date.now()}`;
    
    return await withIdempotency(
      pool,
      refundIdempotencyKey,
      'refund',
      async () => {
        // Create refund record
        const refundInsertResult = await client.query<Refund>(
          `INSERT INTO refunds (
            organisation_id, invoice_id, payment_id, refund_number,
            razorpay_payment_id, amount, currency, status, refund_type,
            reason, created_by, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id, organisation_id, invoice_id, payment_id, refund_number,
                    razorpay_refund_id, razorpay_payment_id, amount, currency,
                    status, refund_type, reason, processed_at, failure_reason,
                    created_at, updated_at`,
          [
            payment.organisationId,
            payment.invoiceId,
            payment.id,
            refundNumber,
            payment.razorpayPaymentId,
            toFixedString(refundAmount, 2),
            payment.currency,
            'pending',
            refundType,
            request.reason || null,
            request.userId || null,
            JSON.stringify({
              requested_amount: toFixedString(refundAmount, 2),
              payment_amount: payment.amount,
              existing_refund_amount: toFixedString(existingRefundAmount, 2),
            }),
          ]
        );

        const refundRow = refundInsertResult.rows[0];
        const refund: Refund = {
          id: refundRow.id,
          organisationId: refundRow.organisation_id,
          invoiceId: refundRow.invoice_id,
          paymentId: refundRow.payment_id,
          refundNumber: refundRow.refund_number,
          razorpayRefundId: refundRow.razorpay_refund_id || undefined,
          razorpayPaymentId: refundRow.razorpay_payment_id,
          amount: refundRow.amount.toString(),
          currency: refundRow.currency,
          status: refundRow.status as Refund['status'],
          refundType: refundRow.refund_type as Refund['refundType'],
          reason: refundRow.reason || undefined,
          processedAt: refundRow.processed_at || undefined,
          failureReason: refundRow.failure_reason || undefined,
          createdAt: refundRow.created_at,
          updatedAt: refundRow.updated_at,
        };

        try {
          // Call Razorpay API to process refund
          const refundAmountInPaise = Math.round(refundAmount.mul(100).toNumber());
          const razorpayRefund = await createRazorpayRefund(
            env,
            payment.razorpayPaymentId,
            refundAmountInPaise,
            {
              reason: request.reason || 'Customer request',
              refund_number: refundNumber,
            }
          );

          // Update refund record with Razorpay response
          const updateResult = await client.query<Refund>(
            `UPDATE refunds
             SET razorpay_refund_id = $1,
                 status = CASE WHEN $2 = 'processed' THEN 'processed' ELSE 'pending' END,
                 processed_at = CASE WHEN $2 = 'processed' THEN NOW() ELSE NULL END,
                 metadata = jsonb_build_object(
                   'razorpay_refund', $3,
                   'razorpay_status', $2,
                   'requested_at', NOW()
                 ),
                 updated_at = NOW()
             WHERE id = $4
             RETURNING id, organisation_id, invoice_id, payment_id, refund_number,
                       razorpay_refund_id, razorpay_payment_id, amount, currency,
                       status, refund_type, reason, processed_at, failure_reason,
                       created_at, updated_at`,
            [
              razorpayRefund.id,
              razorpayRefund.status,
              razorpayRefund,
              refund.id,
            ]
          );

          const updatedRefundRow = updateResult.rows[0];
          const updatedRefund: Refund = {
            id: updatedRefundRow.id,
            organisationId: updatedRefundRow.organisation_id,
            invoiceId: updatedRefundRow.invoice_id,
            paymentId: updatedRefundRow.payment_id,
            refundNumber: updatedRefundRow.refund_number,
            razorpayRefundId: updatedRefundRow.razorpay_refund_id || undefined,
            razorpayPaymentId: updatedRefundRow.razorpay_payment_id,
            amount: updatedRefundRow.amount.toString(),
            currency: updatedRefundRow.currency,
            status: updatedRefundRow.status as Refund['status'],
            refundType: updatedRefundRow.refund_type as Refund['refundType'],
            reason: updatedRefundRow.reason || undefined,
            processedAt: updatedRefundRow.processed_at || undefined,
            failureReason: updatedRefundRow.failure_reason || undefined,
            createdAt: updatedRefundRow.created_at,
            updatedAt: updatedRefundRow.updated_at,
          };

          // Create audit log
          await createAuditLog(pool, {
            organisationId: payment.organisationId,
            entityType: 'refund',
            entityId: updatedRefund.id,
            action: 'created',
            userId: request.userId,
            changes: {
              paymentId: payment.id,
              amount: updatedRefund.amount,
              refundType: updatedRefund.refundType,
              razorpayRefundId: updatedRefund.razorpayRefundId,
            },
          });

          logger.info('Refund processed successfully', {
            refundId: updatedRefund.id,
            refundNumber: updatedRefund.refundNumber,
            paymentId: payment.id,
            amount: updatedRefund.amount,
            razorpayRefundId: updatedRefund.razorpayRefundId,
          });

          return updatedRefund;
        } catch (error) {
          // Update refund record with failure
          const errorMessage = error instanceof Error ? error.message : String(error);
          await client.query(
            `UPDATE refunds
             SET status = 'failed',
                 failure_reason = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [errorMessage, refund.id]
          );

          logger.error('Refund processing failed', {
            refundId: refund.id,
            paymentId: payment.id,
            error: errorMessage,
          });

          throw new PaymentError(`Failed to process refund: ${errorMessage}`);
        }
      }
    );
  });
}

/**
 * Get refund by ID
 */
export async function getRefundById(
  pool: pg.Pool,
  refundId: string
): Promise<Refund | null> {
  const result = await queryRds<Refund>(
    pool,
    `SELECT 
      id, organisation_id, invoice_id, payment_id, refund_number,
      razorpay_refund_id, razorpay_payment_id, amount, currency,
      status, refund_type, reason, processed_at, failure_reason,
      created_at, updated_at
    FROM refunds
    WHERE id = $1`,
    [refundId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    organisationId: row.organisation_id,
    invoiceId: row.invoice_id,
    paymentId: row.payment_id,
    refundNumber: row.refund_number,
    razorpayRefundId: row.razorpay_refund_id || undefined,
    razorpayPaymentId: row.razorpay_payment_id,
    amount: row.amount.toString(),
    currency: row.currency,
    status: row.status as Refund['status'],
    refundType: row.refund_type as Refund['refundType'],
    reason: row.reason || undefined,
    processedAt: row.processed_at || undefined,
    failureReason: row.failure_reason || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get refunds for a payment
 */
export async function getRefundsByPaymentId(
  pool: pg.Pool,
  paymentId: string
): Promise<Refund[]> {
  const result = await queryRds<Refund>(
    pool,
    `SELECT 
      id, organisation_id, invoice_id, payment_id, refund_number,
      razorpay_refund_id, razorpay_payment_id, amount, currency,
      status, refund_type, reason, processed_at, failure_reason,
      created_at, updated_at
    FROM refunds
    WHERE payment_id = $1
    ORDER BY created_at DESC`,
    [paymentId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    organisationId: row.organisation_id,
    invoiceId: row.invoice_id,
    paymentId: row.payment_id,
    refundNumber: row.refund_number,
    razorpayRefundId: row.razorpay_refund_id || undefined,
    razorpayPaymentId: row.razorpay_payment_id,
    amount: row.amount.toString(),
    currency: row.currency,
    status: row.status as Refund['status'],
    refundType: row.refund_type as Refund['refundType'],
    reason: row.reason || undefined,
    processedAt: row.processed_at || undefined,
    failureReason: row.failure_reason || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Process Razorpay refund webhook
 */
export async function processRazorpayRefundWebhook(
  pool: pg.Pool,
  env: Env,
  webhook: {
    event: string;
    payload: {
      refund: {
        entity: {
          id: string; // refund_id
          payment_id: string;
          amount: number; // in paise
          status: string;
          created_at: number;
        };
      };
    };
  }
): Promise<Refund> {
  const logger = createLogger(env);

  // Only process refund.* events
  if (!webhook.event.startsWith('refund.')) {
    throw new ValidationError(`Unhandled event type: ${webhook.event}`);
  }

  const refundEntity = webhook.payload.refund.entity;
  const razorpayRefundId = refundEntity.id;
  const razorpayPaymentId = refundEntity.payment_id;

  // Find refund by Razorpay refund ID
  const refundResult = await queryRds<Refund>(
    pool,
    `SELECT 
      id, organisation_id, invoice_id, payment_id, refund_number,
      razorpay_refund_id, razorpay_payment_id, amount, currency,
      status, refund_type, reason, processed_at, failure_reason,
      created_at, updated_at
    FROM refunds
    WHERE razorpay_refund_id = $1 OR razorpay_payment_id = $2`,
    [razorpayRefundId, razorpayPaymentId]
  );

  if (refundResult.rows.length === 0) {
    logger.warn('Refund webhook received for unknown refund', {
      razorpayRefundId,
      razorpayPaymentId,
      event: webhook.event,
    });
    throw new NotFoundError(`Refund not found for Razorpay refund ID: ${razorpayRefundId}`);
  }

  const refundRow = refundResult.rows[0];
  
  // Update refund status based on webhook
  const status = refundEntity.status === 'processed' ? 'processed' : 
                 refundEntity.status === 'failed' ? 'failed' : 'pending';

  const updateResult = await queryRds<Refund>(
    pool,
    `UPDATE refunds
     SET status = $1,
         razorpay_refund_id = COALESCE(razorpay_refund_id, $2),
         processed_at = CASE WHEN $1 = 'processed' THEN NOW() ELSE processed_at END,
         failure_reason = CASE WHEN $1 = 'failed' THEN 'Razorpay refund failed' ELSE failure_reason END,
         metadata = jsonb_build_object(
           'razorpay_refund', $3,
           'webhook_event', $4,
           'webhook_received_at', NOW()
         ),
         updated_at = NOW()
     WHERE id = $5
     RETURNING id, organisation_id, invoice_id, payment_id, refund_number,
               razorpay_refund_id, razorpay_payment_id, amount, currency,
               status, refund_type, reason, processed_at, failure_reason,
               created_at, updated_at`,
    [
      status,
      razorpayRefundId,
      refundEntity,
      webhook.event,
      refundRow.id,
    ]
  );

  const updatedRefundRow = updateResult.rows[0];
  const updatedRefund: Refund = {
    id: updatedRefundRow.id,
    organisationId: updatedRefundRow.organisation_id,
    invoiceId: updatedRefundRow.invoice_id,
    paymentId: updatedRefundRow.payment_id,
    refundNumber: updatedRefundRow.refund_number,
    razorpayRefundId: updatedRefundRow.razorpay_refund_id || undefined,
    razorpayPaymentId: updatedRefundRow.razorpay_payment_id,
    amount: updatedRefundRow.amount.toString(),
    currency: updatedRefundRow.currency,
    status: updatedRefundRow.status as Refund['status'],
    refundType: updatedRefundRow.refund_type as Refund['refundType'],
    reason: updatedRefundRow.reason || undefined,
    processedAt: updatedRefundRow.processed_at || undefined,
    failureReason: updatedRefundRow.failure_reason || undefined,
    createdAt: updatedRefundRow.created_at,
    updatedAt: updatedRefundRow.updated_at,
  };

  logger.info('Refund webhook processed', {
    refundId: updatedRefund.id,
    razorpayRefundId,
    status: updatedRefund.status,
    event: webhook.event,
  });

  return updatedRefund;
}
