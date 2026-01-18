import { Env } from '../../types/env.js';
import { createRdsPool } from '../../db/rds.js';
import {
  PaymentListQuerySchema,
  PaymentListResponseSchema,
  type PaymentListResponse,
} from '../../types/api.js';
import { formatError, ValidationError } from '../../utils/errors.js';
import { AdminAuthContext } from '../../services/admin-auth.js';
import { checkPermission, checkOrganisationAccess } from '../../services/admin-auth.js';
import { queryRds } from '../../db/rds.js';

/**
 * Admin API: List Payments (Read-Only)
 * 
 * GET /api/v1/admin/organisations/:organisationId/payments
 * 
 * Returns list of payments for an organisation.
 * Read-only endpoint - financial data cannot be modified.
 */

export async function handleListPayments(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Check permission
    checkPermission(authContext, 'read');

    const url = new URL(request.url);
    // Extract organisation ID from path
    const pathMatch = url.pathname.match(/\/organisations\/([^/]+)\/payments/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: organisationId required in path');
    }

    const organisationId = pathMatch[1];
    checkOrganisationAccess(authContext, organisationId);

    // Parse query parameters
    const queryParams: Record<string, unknown> = {
      organisationId,
      invoiceId: url.searchParams.get('invoiceId') || undefined,
      status: url.searchParams.get('status') || undefined,
      startDate: url.searchParams.get('startDate') || undefined,
      endDate: url.searchParams.get('endDate') || undefined,
      limit: url.searchParams.get('limit')
        ? parseInt(url.searchParams.get('limit')!, 10)
        : 50,
      offset: url.searchParams.get('offset')
        ? parseInt(url.searchParams.get('offset')!, 10)
        : 0,
    };

    const validationResult = PaymentListQuerySchema.safeParse(queryParams);
    if (!validationResult.success) {
      throw new ValidationError('Invalid query parameters', {
        errors: validationResult.error.errors,
      });
    }

    const query = validationResult.data;

    // Build query
    const rdsPool = createRdsPool(env);
    let sql = `
      SELECT 
        p.id,
        p.organisation_id,
        p.invoice_id,
        i.invoice_number,
        p.payment_number,
        p.razorpay_order_id,
        p.razorpay_payment_id,
        p.amount,
        p.currency,
        p.status,
        p.payment_method,
        p.paid_at,
        p.reconciled_at,
        p.created_at,
        p.updated_at
      FROM payments p
      LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.organisation_id = $1
    `;

    const params: unknown[] = [organisationId];
    let paramIndex = 2;

    if (query.invoiceId) {
      sql += ` AND p.invoice_id = $${paramIndex}`;
      params.push(query.invoiceId);
      paramIndex++;
    }

    if (query.status) {
      sql += ` AND p.status = $${paramIndex}`;
      params.push(query.status);
      paramIndex++;
    }

    if (query.startDate) {
      sql += ` AND p.created_at >= $${paramIndex}::date`;
      params.push(query.startDate);
      paramIndex++;
    }

    if (query.endDate) {
      sql += ` AND p.created_at <= $${paramIndex}::date`;
      params.push(query.endDate);
      paramIndex++;
    }

    // Get total count
    const countSql = sql.replace(
      /SELECT.*FROM/,
      'SELECT COUNT(*) as total FROM'
    );
    const countResult = await queryRds<{ total: string }>(
      rdsPool,
      countSql,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Add pagination
    sql += ` ORDER BY p.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(query.limit, query.offset);

    const result = await queryRds<{
      id: string;
      organisation_id: string;
      invoice_id: string;
      invoice_number: string | null;
      payment_number: string;
      razorpay_order_id: string | null;
      razorpay_payment_id: string | null;
      amount: string;
      currency: string;
      status: string;
      payment_method: string | null;
      paid_at: Date | null;
      reconciled_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(rdsPool, sql, params);

    const payments = result.rows.map((row) => ({
      id: row.id,
      organisationId: row.organisation_id,
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      paymentNumber: row.payment_number,
      razorpayOrderId: row.razorpay_order_id,
      razorpayPaymentId: row.razorpay_payment_id,
      amount: row.amount,
      currency: row.currency,
      status: row.status as PaymentListResponseSchema['payments'][0]['status'],
      paymentMethod: row.payment_method,
      paidAt: row.paid_at?.toISOString() || null,
      reconciledAt: row.reconciled_at?.toISOString() || null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));

    const response: PaymentListResponse = {
      payments,
      total,
      limit: query.limit,
      offset: query.offset,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const formattedError = formatError(error);
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
