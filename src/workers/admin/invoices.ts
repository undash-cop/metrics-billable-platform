import { Env } from '../../types/env.js';
import { createRdsPool, queryRds } from '../../db/rds.js';
import {
  InvoiceListQuerySchema,
  InvoiceDetailResponse,
  type InvoiceListQuery,
} from '../../types/api.js';
import { formatError, ValidationError, NotFoundError } from '../../utils/errors.js';
import { AdminAuthContext } from '../../services/admin-auth.js';
import { checkPermission, checkOrganisationAccess } from '../../services/admin-auth.js';
import { getInvoiceById, getInvoiceLineItems } from '../../repositories/invoice.js';

/**
 * Admin API: Invoices
 * 
 * GET /api/v1/admin/organisations/:organisationId/invoices
 * GET /api/v1/admin/invoices/:invoiceId
 * GET /api/v1/admin/invoices/:invoiceId/pdf
 * 
 * Returns invoice data.
 * Read-only endpoint.
 */

export async function handleListInvoices(
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
    const pathMatch = url.pathname.match(/\/organisations\/([^/]+)\/invoices/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: organisationId required in path');
    }

    const organisationId = pathMatch[1];
    checkOrganisationAccess(authContext, organisationId);

    // Parse query parameters
    const queryParams: Record<string, unknown> = {
      organisationId,
      limit: url.searchParams.get('limit')
        ? parseInt(url.searchParams.get('limit')!, 10)
        : 100,
      offset: url.searchParams.get('offset')
        ? parseInt(url.searchParams.get('offset')!, 10)
        : 0,
      status: url.searchParams.get('status') || undefined,
    };

    const validationResult = InvoiceListQuerySchema.safeParse(queryParams);
    if (!validationResult.success) {
      throw new ValidationError('Invalid query parameters', {
        errors: validationResult.error.errors,
      });
    }

    const query = validationResult.data;

    // Build SQL query
    let sql = `
      SELECT 
        id, organisation_id, invoice_number, status, subtotal, tax, total,
        currency, month, year, due_date, issued_at, paid_at,
        pdf_url, created_at, updated_at
      FROM invoices
      WHERE organisation_id = $1
    `;
    const params: unknown[] = [organisationId];
    let paramIndex = 2;

    if (query.status) {
      sql += ` AND status = $${paramIndex}`;
      params.push(query.status);
      paramIndex++;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(query.limit, query.offset);

    const rdsPool = createRdsPool(env);
    const result = await queryRds<{
      id: string;
      organisation_id: string;
      invoice_number: string;
      status: string;
      subtotal: string;
      tax: string;
      total: string;
      currency: string;
      month: number;
      year: number;
      due_date: Date;
      issued_at: Date | null;
      paid_at: Date | null;
      pdf_url: string | null;
      created_at: Date;
      updated_at: Date;
    }>(rdsPool, sql, params);

    const invoices = result.rows.map((row) => ({
      id: row.id,
      organisationId: row.organisation_id,
      invoiceNumber: row.invoice_number,
      status: row.status,
      subtotal: row.subtotal,
      tax: row.tax,
      total: row.total,
      currency: row.currency,
      month: row.month,
      year: row.year,
      dueDate: row.due_date.toISOString().split('T')[0],
      issuedAt: row.issued_at?.toISOString() || null,
      paidAt: row.paid_at?.toISOString() || null,
      pdfUrl: row.pdf_url || null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));

    await rdsPool.end();

    return new Response(
      JSON.stringify({
        invoices,
        total: invoices.length,
        limit: query.limit,
        offset: query.offset,
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
 * GET /api/v1/admin/invoices/:invoiceId
 * Returns detailed invoice with line items.
 * Read-only endpoint.
 */

export async function handleGetInvoice(
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

    // Extract invoice ID from path
    const pathMatch = url.pathname.match(/\/invoices\/([^/]+)/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: invoiceId required in path');
    }

    const invoiceId = pathMatch[1];

    // Get invoice
    const rdsPool = createRdsPool(env);
    const invoice = await getInvoiceById(rdsPool, invoiceId);

    if (!invoice) {
      throw new NotFoundError(`Invoice not found: ${invoiceId}`);
    }

    // Check organisation access
    checkOrganisationAccess(authContext, invoice.organisationId);

    // Get line items
    const lineItems = await getInvoiceLineItems(rdsPool, invoiceId);

    // Get PDF URL if available
    const pdfResult = await queryRds<{ pdf_url: string | null }>(
      rdsPool,
      `SELECT pdf_url FROM invoices WHERE id = $1`,
      [invoiceId]
    );
    const pdfUrl = pdfResult.rows[0]?.pdf_url || null;

    // Get project names for line items
    const projectIds = lineItems
      .map((item) => item.projectId)
      .filter((id) => id) as string[];

    const projectNames = new Map<string, string>();
    if (projectIds.length > 0) {
      const projectResult = await queryRds<{ id: string; name: string }>(
        rdsPool,
        `SELECT id, name FROM projects WHERE id = ANY($1)`,
        [projectIds]
      );

      for (const row of projectResult.rows) {
        projectNames.set(row.id, row.name);
      }
    }

    const response: InvoiceDetailResponse = {
      id: invoice.id,
      organisationId: invoice.organisationId,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total: invoice.total,
      currency: invoice.currency,
      month: invoice.month,
      year: invoice.year,
      billingPeriodStart: null, // Not in current schema
      billingPeriodEnd: null, // Not in current schema
      dueDate: invoice.dueDate.toISOString().split('T')[0],
      issuedAt: invoice.issuedAt?.toISOString() || null,
      paidAt: invoice.paidAt?.toISOString() || null,
      finalizedAt: undefined, // Not in current schema
      pdfUrl,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
      lineItems: lineItems.map((item, index) => ({
        id: item.id,
        lineNumber: index + 1,
        projectId: item.projectId || null,
        projectName: item.projectId ? projectNames.get(item.projectId) || null : null,
        metricName: item.metricName,
        description: null, // Not in current schema
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        total: item.total,
        currency: item.currency,
      })),
    };

    await rdsPool.end();

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

/**
 * GET /api/v1/admin/invoices/:invoiceId/pdf
 * Download invoice PDF
 */
export async function handleDownloadInvoicePdf(
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

    // Extract invoice ID from path
    const pathMatch = url.pathname.match(/\/invoices\/([^/]+)\/pdf/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: invoiceId required in path');
    }

    const invoiceId = pathMatch[1];

    // Get invoice
    const rdsPool = createRdsPool(env);
    const invoice = await getInvoiceById(rdsPool, invoiceId);

    if (!invoice) {
      throw new NotFoundError(`Invoice not found: ${invoiceId}`);
    }

    // Check organisation access
    checkOrganisationAccess(authContext, invoice.organisationId);

    // Get PDF URL from database
    const pdfResult = await queryRds<{ pdf_url: string | null }>(
      rdsPool,
      `SELECT pdf_url FROM invoices WHERE id = $1`,
      [invoiceId]
    );
    const pdfUrl = pdfResult.rows[0]?.pdf_url;

    await rdsPool.end();

    if (!pdfUrl) {
      return new Response(
        JSON.stringify({
          error: 'PDF not yet generated for this invoice',
          code: 'PDF_NOT_GENERATED',
          statusCode: 404,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // If PDF URL is a path (stored in R2), fetch from R2
    if (pdfUrl.startsWith('/')) {
      if (!env.INVOICE_PDFS_R2) {
        throw new Error('R2 bucket not configured');
      }

      // Extract key from URL (e.g., /api/v1/invoices/INV-001/pdf -> invoices/INV-001.pdf)
      const key = pdfUrl.replace('/api/v1/invoices/', 'invoices/').replace('/pdf', '.pdf');
      
      // Try PDF first, then HTML
      let object = await env.INVOICE_PDFS_R2.get(key);
      if (!object) {
        // Try HTML version
        const htmlKey = key.replace('.pdf', '.html');
        object = await env.INVOICE_PDFS_R2.get(htmlKey);
      }

      if (!object) {
        throw new NotFoundError('PDF file not found in storage');
      }

      const data = await object.arrayBuffer();
      const contentType = object.httpMetadata?.contentType || 'application/pdf';

      return new Response(data, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`,
          'Cache-Control': 'public, max-age=31536000', // 1 year
        },
      });
    }

    // If PDF URL is external, redirect
    return Response.redirect(pdfUrl, 302);
  } catch (error) {
    const formattedError = formatError(error);
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
