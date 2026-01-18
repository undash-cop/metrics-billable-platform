import pg from 'pg';
import { Env } from '../types/env.js';
import { Payment } from '../types/domain.js';
import { queryRds, transaction } from '../db/rds.js';
import { createLogger } from '../utils/logger.js';
import { NotFoundError, PaymentError, ValidationError } from '../utils/errors.js';
import { createRazorpayOrderForInvoice } from './razorpay-payments.js';
import { Invoice } from '../types/domain.js';

/**
 * Payment Retry Service
 * 
 * Handles automatic retry of failed payments with:
 * - Configurable retry schedule
 * - Exponential backoff
 * - Max retry attempts
 * - Retry history tracking
 * - Notification on final failure
 */

export interface RetryConfig {
  maxRetries?: number; // Default: 3
  baseIntervalHours?: number; // Default: 24 (for exponential backoff)
  enabled?: boolean; // Default: true
}

export interface RetryAttempt {
  attemptNumber: number;
  attemptedAt: Date;
  success: boolean;
  error?: string;
  razorpayOrderId?: string;
}

export interface PaymentWithRetry extends Payment {
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: Date;
  lastRetryAt?: Date;
  retryHistory: RetryAttempt[];
}

/**
 * Calculate next retry time using exponential backoff
 * Formula: base_interval * 2^(retry_count)
 * Examples: 24h, 48h, 96h for retry_count 0, 1, 2
 */
export function calculateNextRetryTime(
  retryCount: number,
  baseIntervalHours: number = 24
): Date {
  const hours = baseIntervalHours * Math.pow(2, retryCount);
  const nextRetry = new Date();
  nextRetry.setHours(nextRetry.getHours() + hours);
  return nextRetry;
}

/**
 * Check if payment is eligible for retry
 */
export function isPaymentRetryEligible(
  payment: PaymentWithRetry,
  currentTime: Date = new Date()
): boolean {
  if (payment.status !== 'failed') {
    return false;
  }

  if (payment.retryCount >= payment.maxRetries) {
    return false;
  }

  if (payment.nextRetryAt && payment.nextRetryAt > currentTime) {
    return false;
  }

  return true;
}

/**
 * Get payments eligible for retry
 */
export async function getPaymentsEligibleForRetry(
  pool: pg.Pool,
  limit: number = 100
): Promise<PaymentWithRetry[]> {
  const result = await queryRds<PaymentWithRetry>(
    pool,
    `SELECT 
      p.id, p.organisation_id, p.invoice_id, p.payment_number,
      p.razorpay_payment_id, p.razorpay_order_id, p.amount, p.currency,
      p.status, p.payment_method, p.paid_at, p.reconciled_at,
      p.created_at, p.updated_at,
      p.retry_count, p.max_retries, p.next_retry_at, p.last_retry_at,
      COALESCE(p.retry_history, '[]'::jsonb) as retry_history
    FROM payments p
    WHERE p.status = 'failed'
      AND p.retry_count < p.max_retries
      AND (p.next_retry_at IS NULL OR p.next_retry_at <= NOW())
    ORDER BY p.next_retry_at ASC NULLS FIRST, p.created_at ASC
    LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => {
    // Parse retry history and convert dates
    const retryHistory: RetryAttempt[] = (row.retry_history as unknown as Array<{
      attemptNumber: number;
      attemptedAt: string | Date;
      success: boolean;
      error?: string;
      razorpayOrderId?: string;
    }>)?.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      attemptedAt: attempt.attemptedAt instanceof Date ? attempt.attemptedAt : new Date(attempt.attemptedAt),
      success: attempt.success,
      error: attempt.error,
      razorpayOrderId: attempt.razorpayOrderId,
    })) || [];

    return {
      id: row.id,
      organisationId: row.organisation_id,
      invoiceId: row.invoice_id,
      razorpayPaymentId: row.razorpay_payment_id,
      razorpayOrderId: row.razorpay_order_id || undefined,
      amount: row.amount.toString(),
      currency: row.currency,
      status: row.status as Payment['status'],
      paymentMethod: row.payment_method || undefined,
      paidAt: row.paid_at || undefined,
      reconciledAt: row.reconciled_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      nextRetryAt: row.next_retry_at || undefined,
      lastRetryAt: row.last_retry_at || undefined,
      retryHistory,
    };
  });
}

/**
 * Retry a failed payment by creating a new Razorpay order
 */
export async function retryPayment(
  pool: pg.Pool,
  env: Env,
  paymentId: string,
  config?: RetryConfig
): Promise<{ success: boolean; newOrderId?: string; error?: string }> {
  const logger = createLogger(env);
  const baseIntervalHours = config?.baseIntervalHours || 24;

  return await transaction(pool, async (client) => {
    // Fetch payment with retry info
    const paymentResult = await client.query<PaymentWithRetry>(
      `SELECT 
        p.id, p.organisation_id, p.invoice_id, p.payment_number,
        p.razorpay_payment_id, p.razorpay_order_id, p.amount, p.currency,
        p.status, p.payment_method, p.paid_at, p.reconciled_at,
        p.created_at, p.updated_at,
        p.retry_count, p.max_retries, p.next_retry_at, p.last_retry_at,
        COALESCE(p.retry_history, '[]'::jsonb) as retry_history
      FROM payments p
      WHERE p.id = $1`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      throw new NotFoundError(`Payment not found: ${paymentId}`);
    }

    const paymentRow = paymentResult.rows[0];
    
    // Parse retry history and convert dates
    const retryHistory: RetryAttempt[] = (paymentRow.retry_history as unknown as Array<{
      attemptNumber: number;
      attemptedAt: string | Date;
      success: boolean;
      error?: string;
      razorpayOrderId?: string;
    }>)?.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      attemptedAt: attempt.attemptedAt instanceof Date ? attempt.attemptedAt : new Date(attempt.attemptedAt),
      success: attempt.success,
      error: attempt.error,
      razorpayOrderId: attempt.razorpayOrderId,
    })) || [];

    const payment: PaymentWithRetry = {
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
      retryCount: paymentRow.retry_count,
      maxRetries: paymentRow.max_retries,
      nextRetryAt: paymentRow.next_retry_at || undefined,
      lastRetryAt: paymentRow.last_retry_at || undefined,
      retryHistory,
    };

    // Check if eligible for retry
    if (!isPaymentRetryEligible(payment)) {
      throw new ValidationError(
        `Payment ${paymentId} is not eligible for retry. Status: ${payment.status}, Retry count: ${payment.retryCount}/${payment.maxRetries}`
      );
    }

    // Fetch invoice to get customer ID if available
    const invoiceResult = await client.query<Invoice & { razorpay_customer_id: string | null }>(
      `SELECT 
        i.id, i.organisation_id, i.invoice_number, i.status, i.subtotal, i.tax, i.total,
        i.currency, i.month, i.year, i.due_date, i.issued_at, i.paid_at,
        i.created_at, i.updated_at,
        o.razorpay_customer_id
      FROM invoices i
      JOIN organisations o ON o.id = i.organisation_id
      WHERE i.id = $1`,
      [payment.invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      throw new NotFoundError(`Invoice not found: ${payment.invoiceId}`);
    }

    const invoice = invoiceResult.rows[0];
    const customerId = invoice.razorpay_customer_id || undefined;

    // Attempt retry by creating new Razorpay order
    const attemptNumber = payment.retryCount + 1;
    const attemptedAt = new Date();

    try {
      // Create new Razorpay order for the invoice
      const { order } = await createRazorpayOrderForInvoice(
        pool,
        env,
        payment.invoiceId,
        customerId
      );

      // Update payment with new order ID and retry info
      const nextRetryAt = attemptNumber < payment.maxRetries
        ? calculateNextRetryTime(attemptNumber, baseIntervalHours)
        : null;

      const retryHistory = [...payment.retryHistory, {
        attemptNumber,
        attemptedAt,
        success: true,
        razorpayOrderId: order.id,
      }];

      await client.query(
        `UPDATE payments
         SET razorpay_order_id = $1,
             retry_count = $2,
             next_retry_at = $3,
             last_retry_at = $4,
             retry_history = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [
          order.id,
          attemptNumber,
          nextRetryAt,
          attemptedAt,
          JSON.stringify(retryHistory),
          paymentId,
        ]
      );

      logger.info('Payment retry successful', {
        paymentId,
        invoiceId: payment.invoiceId,
        attemptNumber,
        newOrderId: order.id,
      });

      return {
        success: true,
        newOrderId: order.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Update payment with retry failure info
      const nextRetryAt = attemptNumber < payment.maxRetries
        ? calculateNextRetryTime(attemptNumber, baseIntervalHours)
        : null;

      const retryHistory = [...payment.retryHistory, {
        attemptNumber,
        attemptedAt,
        success: false,
        error: errorMessage,
      }];

      await client.query(
        `UPDATE payments
         SET retry_count = $1,
             next_retry_at = $2,
             last_retry_at = $3,
             retry_history = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [
          attemptNumber,
          nextRetryAt,
          attemptedAt,
          JSON.stringify(retryHistory),
          paymentId,
        ]
      );

      logger.error('Payment retry failed', {
        paymentId,
        invoiceId: payment.invoiceId,
        attemptNumber,
        error: errorMessage,
      });

      // If max retries reached, mark as final failure
      if (attemptNumber >= payment.maxRetries) {
        await notifyFinalFailure(pool, env, payment, errorMessage);
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  });
}

/**
 * Notify on final failure (after max retries)
 */
async function notifyFinalFailure(
  pool: pg.Pool,
  env: Env,
  payment: PaymentWithRetry,
  error: string
): Promise<void> {
  const logger = createLogger(env);

  // Update payment metadata with final failure info
  await queryRds(
    pool,
    `UPDATE payments
     SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
       'final_failure', true,
       'final_failure_at', NOW(),
       'final_failure_reason', $1,
       'total_retry_attempts', $2
     ),
     next_retry_at = NULL,
     updated_at = NOW()
     WHERE id = $3`,
    [error, payment.retryCount + 1, payment.id]
  );

  logger.warn('Payment retry exhausted - final failure', {
    paymentId: payment.id,
    invoiceId: payment.invoiceId,
    organisationId: payment.organisationId,
    totalAttempts: payment.retryCount + 1,
    error,
  });

  // TODO: Send notification email to organisation billing email
  // This can be integrated with the email service
}

/**
 * Get payment retry status
 */
export async function getPaymentRetryStatus(
  pool: pg.Pool,
  paymentId: string
): Promise<{
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: Date;
  lastRetryAt?: Date;
  retryHistory: RetryAttempt[];
  eligible: boolean;
}> {
  const result = await queryRds<PaymentWithRetry>(
    pool,
    `SELECT 
      p.id, p.organisation_id, p.invoice_id, p.payment_number,
      p.razorpay_payment_id, p.razorpay_order_id, p.amount, p.currency,
      p.status, p.payment_method, p.paid_at, p.reconciled_at,
      p.created_at, p.updated_at,
      p.retry_count, p.max_retries, p.next_retry_at, p.last_retry_at,
      COALESCE(p.retry_history, '[]'::jsonb) as retry_history
    FROM payments p
    WHERE p.id = $1`,
    [paymentId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError(`Payment not found: ${paymentId}`);
  }

  const row = result.rows[0];
  
  // Parse retry history and convert dates
  const retryHistory: RetryAttempt[] = (row.retry_history as unknown as Array<{
    attemptNumber: number;
    attemptedAt: string | Date;
    success: boolean;
    error?: string;
    razorpayOrderId?: string;
  }>)?.map((attempt) => ({
    attemptNumber: attempt.attemptNumber,
    attemptedAt: attempt.attemptedAt instanceof Date ? attempt.attemptedAt : new Date(attempt.attemptedAt),
    success: attempt.success,
    error: attempt.error,
    razorpayOrderId: attempt.razorpayOrderId,
  })) || [];

  const payment: PaymentWithRetry = {
    id: row.id,
    organisationId: row.organisation_id,
    invoiceId: row.invoice_id,
    razorpayPaymentId: row.razorpay_payment_id,
    razorpayOrderId: row.razorpay_order_id || undefined,
    amount: row.amount.toString(),
    currency: row.currency,
    status: row.status as Payment['status'],
    paymentMethod: row.payment_method || undefined,
    paidAt: row.paid_at || undefined,
    reconciledAt: row.reconciled_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    nextRetryAt: row.next_retry_at || undefined,
    lastRetryAt: row.last_retry_at || undefined,
    retryHistory,
  };

  return {
    retryCount: payment.retryCount,
    maxRetries: payment.maxRetries,
    nextRetryAt: payment.nextRetryAt,
    lastRetryAt: payment.lastRetryAt,
    retryHistory: payment.retryHistory,
    eligible: isPaymentRetryEligible(payment),
  };
}

/**
 * Update payment retry configuration
 */
export async function updatePaymentRetryConfig(
  pool: pg.Pool,
  paymentId: string,
  config: {
    maxRetries?: number;
    nextRetryAt?: Date;
  }
): Promise<void> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (config.maxRetries !== undefined) {
    updates.push(`max_retries = $${paramIndex}`);
    values.push(config.maxRetries);
    paramIndex++;
  }

  if (config.nextRetryAt !== undefined) {
    updates.push(`next_retry_at = $${paramIndex}`);
    values.push(config.nextRetryAt);
    paramIndex++;
  }

  if (updates.length === 0) {
    return;
  }

  updates.push(`updated_at = NOW()`);
  values.push(paymentId);

  await queryRds(
    pool,
    `UPDATE payments SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    values
  );
}
