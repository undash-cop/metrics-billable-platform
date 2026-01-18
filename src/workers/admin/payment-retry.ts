import { Env } from '../../types/env.js';
import { createRdsPool } from '../../db/rds.js';
import {
  retryPayment,
  getPaymentRetryStatus,
  updatePaymentRetryConfig,
  RetryConfig,
} from '../../services/payment-retry.js';
import { formatError, ValidationError, NotFoundError } from '../../utils/errors.js';
import { AdminAuthContext } from '../../services/admin-auth.js';
import { checkPermission, checkOrganisationAccess } from '../../services/admin-auth.js';
import { z } from 'zod';
import { queryRds } from '../../db/rds.js';

/**
 * Admin API: Payment Retry
 * 
 * POST /api/v1/admin/payments/:paymentId/retry - Retry a failed payment
 * GET /api/v1/admin/payments/:paymentId/retry-status - Get retry status
 * PATCH /api/v1/admin/payments/:paymentId/retry-config - Update retry configuration
 */

const RetryConfigSchema = z.object({
  maxRetries: z.number().int().min(0).max(10).optional(),
  nextRetryAt: z.string().datetime().optional(),
});

/**
 * POST /api/v1/admin/payments/:paymentId/retry
 * Manually retry a failed payment
 */
export async function handleRetryPayment(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'write');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/payments\/([^/]+)\/retry/);
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

    // Parse optional retry config from body
    let retryConfig: RetryConfig | undefined;
    try {
      const body = await request.json();
      if (body.maxRetries !== undefined || body.baseIntervalHours !== undefined) {
        retryConfig = {
          maxRetries: body.maxRetries,
          baseIntervalHours: body.baseIntervalHours,
        };
      }
    } catch {
      // No body provided, use defaults
    }

    // Retry payment
    const result = await retryPayment(rdsPool, env, paymentId, retryConfig);

    await rdsPool.end();

    return new Response(
      JSON.stringify({
        success: result.success,
        newOrderId: result.newOrderId,
        error: result.error,
        message: result.success
          ? 'Payment retry initiated successfully'
          : `Payment retry failed: ${result.error}`,
      }),
      {
        status: result.success ? 200 : 400,
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
 * GET /api/v1/admin/payments/:paymentId/retry-status
 * Get payment retry status
 */
export async function handleGetRetryStatus(
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
    const pathMatch = url.pathname.match(/\/payments\/([^/]+)\/retry-status/);
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

    const retryStatus = await getPaymentRetryStatus(rdsPool, paymentId);

    await rdsPool.end();

    return new Response(
      JSON.stringify({
        retryCount: retryStatus.retryCount,
        maxRetries: retryStatus.maxRetries,
        nextRetryAt: retryStatus.nextRetryAt?.toISOString() || null,
        lastRetryAt: retryStatus.lastRetryAt?.toISOString() || null,
        eligible: retryStatus.eligible,
        retryHistory: retryStatus.retryHistory.map((attempt) => ({
          attemptNumber: attempt.attemptNumber,
          attemptedAt: attempt.attemptedAt.toISOString(),
          success: attempt.success,
          error: attempt.error || null,
          razorpayOrderId: attempt.razorpayOrderId || null,
        })),
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
 * PATCH /api/v1/admin/payments/:paymentId/retry-config
 * Update payment retry configuration
 */
export async function handleUpdateRetryConfig(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  if (request.method !== 'PATCH') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'write');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/payments\/([^/]+)\/retry-config/);
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
    const parsedBody = RetryConfigSchema.parse(body);

    // Update retry config
    await updatePaymentRetryConfig(rdsPool, paymentId, {
      maxRetries: parsedBody.maxRetries,
      nextRetryAt: parsedBody.nextRetryAt ? new Date(parsedBody.nextRetryAt) : undefined,
    });

    await rdsPool.end();

    return new Response(
      JSON.stringify({
        message: 'Retry configuration updated successfully',
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
