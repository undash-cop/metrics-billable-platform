import { Env } from '../../types/env.js';
import { createRdsPool } from '../../db/rds.js';
import { formatError } from '../../utils/errors.js';
import { AdminAuthContext } from '../../services/admin-auth.js';
import { checkPermission, checkOrganisationAccess } from '../../services/admin-auth.js';
import { createLogger } from '../../utils/logger.js';
import { queryRds } from '../../db/rds.js';

/**
 * Admin API: Email Notifications
 * 
 * Provides endpoints for viewing email notification history.
 */

/**
 * List Email Notifications
 * 
 * GET /api/v1/admin/organisations/:organisationId/email-notifications
 * GET /api/v1/admin/invoices/:invoiceId/email-notifications
 * GET /api/v1/admin/payments/:paymentId/email-notifications
 */
export async function handleListEmailNotifications(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'read');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/organisations\/([^/]+)\/email-notifications/);
    const invoiceMatch = url.pathname.match(/\/invoices\/([^/]+)\/email-notifications/);
    const paymentMatch = url.pathname.match(/\/payments\/([^/]+)\/email-notifications/);

    const organisationId = pathMatch ? pathMatch[1] : undefined;
    const invoiceId = invoiceMatch ? invoiceMatch[1] : undefined;
    const paymentId = paymentMatch ? paymentMatch[1] : undefined;

    if (organisationId) {
      checkOrganisationAccess(authContext, organisationId);
    }

    const params = url.searchParams;
    const status = params.get('status') || undefined;
    const limit = params.has('limit') ? parseInt(params.get('limit')!, 10) : 100;
    const offset = params.has('offset') ? parseInt(params.get('offset')!, 10) : 0;

    const rdsPool = createRdsPool(env);

    let query = `
      SELECT 
        id, organisation_id, invoice_id, payment_id,
        recipient_email, subject, message_id, status,
        error_message, provider, metadata,
        created_at, sent_at, delivered_at, opened_at, clicked_at
      FROM email_notifications
      WHERE 1=1
    `;
    const queryParams: unknown[] = [];
    let paramIndex = 1;

    if (organisationId) {
      query += ` AND organisation_id = $${paramIndex++}`;
      queryParams.push(organisationId);
    }
    if (invoiceId) {
      query += ` AND invoice_id = $${paramIndex++}`;
      queryParams.push(invoiceId);
    }
    if (paymentId) {
      query += ` AND payment_id = $${paramIndex++}`;
      queryParams.push(paymentId);
    }
    if (status) {
      query += ` AND status = $${paramIndex++}`;
      queryParams.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    queryParams.push(limit, offset);

    const result = await queryRds(rdsPool, query, queryParams);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) as total FROM email_notifications WHERE 1=1`;
    const countParams: unknown[] = [];
    let countParamIndex = 1;

    if (organisationId) {
      countQuery += ` AND organisation_id = $${countParamIndex++}`;
      countParams.push(organisationId);
    }
    if (invoiceId) {
      countQuery += ` AND invoice_id = $${countParamIndex++}`;
      countParams.push(invoiceId);
    }
    if (paymentId) {
      countQuery += ` AND payment_id = $${countParamIndex++}`;
      countParams.push(paymentId);
    }
    if (status) {
      countQuery += ` AND status = $${countParamIndex++}`;
      countParams.push(status);
    }

    const countResult = await queryRds<{ total: string }>(rdsPool, countQuery, countParams);
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    return new Response(
      JSON.stringify({
        emailNotifications: result.rows.map((row) => ({
          id: row.id,
          organisationId: row.organisation_id,
          invoiceId: row.invoice_id || null,
          paymentId: row.payment_id || null,
          recipientEmail: row.recipient_email,
          subject: row.subject,
          messageId: row.message_id || null,
          status: row.status,
          errorMessage: row.error_message || null,
          provider: row.provider || null,
          metadata: row.metadata || null,
          createdAt: row.created_at.toISOString(),
          sentAt: row.sent_at?.toISOString() || null,
          deliveredAt: row.delivered_at?.toISOString() || null,
          openedAt: row.opened_at?.toISOString() || null,
          clickedAt: row.clicked_at?.toISOString() || null,
        })),
        total,
        limit,
        offset,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to list email notifications', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Get Email Notification
 * 
 * GET /api/v1/admin/email-notifications/:notificationId
 */
export async function handleGetEmailNotification(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'read');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/email-notifications\/([^/]+)/);
    if (!pathMatch || !pathMatch[1]) {
      throw new Error('Invalid URL: notificationId required in path');
    }
    const notificationId = pathMatch[1];

    const rdsPool = createRdsPool(env);

    const result = await queryRds(
      rdsPool,
      `SELECT 
        id, organisation_id, invoice_id, payment_id,
        recipient_email, subject, message_id, status,
        error_message, provider, metadata,
        created_at, sent_at, delivered_at, opened_at, clicked_at
      FROM email_notifications
      WHERE id = $1`,
      [notificationId]
    );

    if (result.rows.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'Email notification not found',
          code: 'NOT_FOUND',
          statusCode: 404,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const row = result.rows[0];

    // Check organisation access
    if (row.organisation_id) {
      checkOrganisationAccess(authContext, row.organisation_id);
    }

    return new Response(
      JSON.stringify({
        id: row.id,
        organisationId: row.organisation_id,
        invoiceId: row.invoice_id || null,
        paymentId: row.payment_id || null,
        recipientEmail: row.recipient_email,
        subject: row.subject,
        messageId: row.message_id || null,
        status: row.status,
        errorMessage: row.error_message || null,
        provider: row.provider || null,
        metadata: row.metadata || null,
        createdAt: row.created_at.toISOString(),
        sentAt: row.sent_at?.toISOString() || null,
        deliveredAt: row.delivered_at?.toISOString() || null,
        openedAt: row.opened_at?.toISOString() || null,
        clickedAt: row.clicked_at?.toISOString() || null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to get email notification', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
