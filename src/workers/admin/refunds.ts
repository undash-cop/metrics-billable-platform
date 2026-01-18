import { Env } from '../../types/env.js';
import { createRdsPool } from '../../db/rds.js';
import {
  processRefund,
  getRefundById,
  getRefundsByPaymentId,
  RefundRequest,
} from '../../services/refund-service.js';
import { formatError, ValidationError, NotFoundError } from '../../utils/errors.js';
import { AdminAuthContext } from '../../services/admin-auth.js';
import { checkPermission, checkOrganisationAccess } from '../../services/admin-auth.js';
import { z } from 'zod';
import { queryRds } from '../../db/rds.js';

/**
 * Admin API: Refunds
 * 
 * POST /api/v1/admin/payments/:paymentId/refunds - Create refund
 * GET /api/v1/admin/refunds/:refundId - Get refund details
 * GET /api/v1/admin/payments/:paymentId/refunds - List refunds for payment
 */

const RefundRequestSchema = z.object({
  amount: z.string().optional(), // Decimal as string, optional for full refund
  reason: z.string().optional(),
});

/**
 * POST /api/v1/admin/payments/:paymentId/refunds
 * Create a refund for a payment
 */
export async function handleCreateRefund(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Check permission (write required for refunds)
    checkPermission(authContext, 'write');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/payments\/([^/]+)\/refunds/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: paymentId required in path');
    }

    const paymentId = pathMatch[1];

    // Verify payment exists and get organisation ID
    const rdsPool = createRdsPool(env);
    const paymentResult = await queryRds<{ organisation_id: string }>(
      rdsPool,
      `SELECT organisation_id FROM payments WHERE id = $1`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      throw new NotFoundError(`Payment not found: ${paymentId}`);
    }

    const organisationId = paymentResult.rows[0].organisation_id;
    checkOrganisationAccess(authContext, organisationId);

    // Parse request body
    const body = await request.json();
    const parsedBody = RefundRequestSchema.parse(body);

    // Process refund
    const refundRequest: RefundRequest = {
      paymentId,
      amount: parsedBody.amount,
      reason: parsedBody.reason,
      userId: authContext.userId,
    };

    const refund = await processRefund(rdsPool, env, refundRequest);

    await rdsPool.end();

    return new Response(
      JSON.stringify({
        id: refund.id,
        refundNumber: refund.refundNumber,
        paymentId: refund.paymentId,
        invoiceId: refund.invoiceId,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        refundType: refund.refundType,
        reason: refund.reason,
        razorpayRefundId: refund.razorpayRefundId,
        processedAt: refund.processedAt?.toISOString() || null,
        createdAt: refund.createdAt.toISOString(),
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * GET /api/v1/admin/refunds/:refundId
 * Get refund details
 */
export async function handleGetRefund(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'read');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/refunds\/([^/]+)/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: refundId required in path');
    }

    const refundId = pathMatch[1];

    const rdsPool = createRdsPool(env);
    const refund = await getRefundById(rdsPool, refundId);

    if (!refund) {
      throw new NotFoundError(`Refund not found: ${refundId}`);
    }

    checkOrganisationAccess(authContext, refund.organisationId);

    await rdsPool.end();

    return new Response(
      JSON.stringify({
        id: refund.id,
        refundNumber: refund.refundNumber,
        paymentId: refund.paymentId,
        invoiceId: refund.invoiceId,
        organisationId: refund.organisationId,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        refundType: refund.refundType,
        reason: refund.reason,
        razorpayRefundId: refund.razorpayRefundId,
        razorpayPaymentId: refund.razorpayPaymentId,
        processedAt: refund.processedAt?.toISOString() || null,
        failureReason: refund.failureReason || null,
        createdAt: refund.createdAt.toISOString(),
        updatedAt: refund.updatedAt.toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * GET /api/v1/admin/payments/:paymentId/refunds
 * List refunds for a payment
 */
export async function handleListRefunds(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'read');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/payments\/([^/]+)\/refunds/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: paymentId required in path');
    }

    const paymentId = pathMatch[1];

    // Verify payment exists and get organisation ID
    const rdsPool = createRdsPool(env);
    const paymentResult = await queryRds<{ organisation_id: string }>(
      rdsPool,
      `SELECT organisation_id FROM payments WHERE id = $1`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      throw new NotFoundError(`Payment not found: ${paymentId}`);
    }

    const organisationId = paymentResult.rows[0].organisation_id;
    checkOrganisationAccess(authContext, organisationId);

    const refunds = await getRefundsByPaymentId(rdsPool, paymentId);

    await rdsPool.end();

    return new Response(
      JSON.stringify({
        refunds: refunds.map((refund) => ({
          id: refund.id,
          refundNumber: refund.refundNumber,
          paymentId: refund.paymentId,
          invoiceId: refund.invoiceId,
          amount: refund.amount,
          currency: refund.currency,
          status: refund.status,
          refundType: refund.refundType,
          reason: refund.reason,
          razorpayRefundId: refund.razorpayRefundId,
          processedAt: refund.processedAt?.toISOString() || null,
          createdAt: refund.createdAt.toISOString(),
        })),
        total: refunds.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
