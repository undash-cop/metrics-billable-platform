import { Env } from '../../types/env.js';
import { createRdsPool } from '../../db/rds.js';
import {
  createTemplate,
  getTemplateById,
  getTemplatesByOrganisation,
  updateTemplate,
  deleteTemplate,
  renderTemplateWithData,
  prepareTemplateData,
} from '../../services/invoice-template.js';
import { formatError, ValidationError, NotFoundError } from '../../utils/errors.js';
import { AdminAuthContext } from '../../services/admin-auth.js';
import { checkPermission, checkOrganisationAccess } from '../../services/admin-auth.js';
import { z } from 'zod';
import { createLogger } from '../../utils/logger.js';
import { getInvoiceById } from '../../repositories/invoice.js';

/**
 * Admin API: Invoice Template Management
 * 
 * Provides CRUD operations for invoice templates and template preview.
 */

// Request/Response schemas
const TemplateCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  templateType: z.enum(['html', 'pdf']).default('html'),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  htmlContent: z.string().min(1),
  cssContent: z.string().optional(),
  variables: z.record(z.string()).optional(),
  previewData: z.record(z.unknown()).optional(),
});

const TemplateUpdateSchema = TemplateCreateSchema.partial();

/**
 * Create Invoice Template
 * 
 * POST /api/v1/admin/organisations/:organisationId/invoice-templates
 * POST /api/v1/admin/invoice-templates (for system templates)
 */
export async function handleCreateTemplate(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'write');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/organisations\/([^/]+)\/invoice-templates/);
    const organisationId = pathMatch ? pathMatch[1] : undefined;

    if (organisationId) {
      checkOrganisationAccess(authContext, organisationId);
    } else if (!authContext.role || authContext.role !== 'admin') {
      // Only admins can create system templates
      return new Response(
        JSON.stringify({ error: 'Only admins can create system templates', code: 'FORBIDDEN', statusCode: 403 }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const parsedBody = TemplateCreateSchema.parse(body);

    const rdsPool = createRdsPool(env);
    const template = await createTemplate(rdsPool, {
      organisationId,
      name: parsedBody.name,
      description: parsedBody.description,
      templateType: parsedBody.templateType,
      isDefault: parsedBody.isDefault,
      isActive: parsedBody.isActive,
      htmlContent: parsedBody.htmlContent,
      cssContent: parsedBody.cssContent || '',
      variables: parsedBody.variables || {},
      previewData: parsedBody.previewData,
      createdBy: authContext.userId,
    });

    return new Response(
      JSON.stringify({
        id: template.id,
        organisationId: template.organisationId,
        name: template.name,
        description: template.description,
        templateType: template.templateType,
        isDefault: template.isDefault,
        isActive: template.isActive,
        variables: template.variables,
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to create invoice template', {
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
 * List Invoice Templates
 * 
 * GET /api/v1/admin/organisations/:organisationId/invoice-templates
 * GET /api/v1/admin/invoice-templates (system templates)
 */
export async function handleListTemplates(
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
    const pathMatch = url.pathname.match(/\/organisations\/([^/]+)\/invoice-templates/);
    const organisationId = pathMatch ? pathMatch[1] : undefined;
    const includeSystem = url.searchParams.get('includeSystem') === 'true';
    const isActive = url.searchParams.get('isActive') === 'true' ? true : url.searchParams.get('isActive') === 'false' ? false : undefined;

    if (organisationId) {
      checkOrganisationAccess(authContext, organisationId);
    }

    const rdsPool = createRdsPool(env);
    const templates = await getTemplatesByOrganisation(rdsPool, organisationId, {
      includeSystem,
      isActive,
    });

    return new Response(
      JSON.stringify({
        templates: templates.map((template) => ({
          id: template.id,
          organisationId: template.organisationId,
          name: template.name,
          description: template.description,
          templateType: template.templateType,
          isDefault: template.isDefault,
          isActive: template.isActive,
          variables: template.variables,
          createdAt: template.createdAt.toISOString(),
          updatedAt: template.updatedAt.toISOString(),
        })),
        total: templates.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to list invoice templates', {
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
 * Get Invoice Template
 * 
 * GET /api/v1/admin/invoice-templates/:templateId
 */
export async function handleGetTemplate(
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
    const pathMatch = url.pathname.match(/\/invoice-templates\/([^/]+)/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: templateId required in path');
    }
    const templateId = pathMatch[1];

    const rdsPool = createRdsPool(env);
    const template = await getTemplateById(rdsPool, templateId);

    if (!template) {
      throw new NotFoundError(`Invoice template not found: ${templateId}`);
    }

    if (template.organisationId) {
      checkOrganisationAccess(authContext, template.organisationId);
    }

    return new Response(
      JSON.stringify({
        id: template.id,
        organisationId: template.organisationId,
        name: template.name,
        description: template.description,
        templateType: template.templateType,
        isDefault: template.isDefault,
        isActive: template.isActive,
        htmlContent: template.htmlContent,
        cssContent: template.cssContent,
        variables: template.variables,
        previewData: template.previewData,
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to get invoice template', {
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
 * Update Invoice Template
 * 
 * PATCH /api/v1/admin/invoice-templates/:templateId
 */
export async function handleUpdateTemplate(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'PATCH') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'write');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/invoice-templates\/([^/]+)/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: templateId required in path');
    }
    const templateId = pathMatch[1];

    const rdsPool = createRdsPool(env);
    const existingTemplate = await getTemplateById(rdsPool, templateId);

    if (!existingTemplate) {
      throw new NotFoundError(`Invoice template not found: ${templateId}`);
    }

    if (existingTemplate.organisationId) {
      checkOrganisationAccess(authContext, existingTemplate.organisationId);
    } else if (!authContext.role || authContext.role !== 'admin') {
      // Only admins can update system templates
      return new Response(
        JSON.stringify({ error: 'Only admins can update system templates', code: 'FORBIDDEN', statusCode: 403 }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const parsedBody = TemplateUpdateSchema.parse(body);

    const updatedTemplate = await updateTemplate(rdsPool, templateId, parsedBody);

    return new Response(
      JSON.stringify({
        id: updatedTemplate.id,
        organisationId: updatedTemplate.organisationId,
        name: updatedTemplate.name,
        description: updatedTemplate.description,
        templateType: updatedTemplate.templateType,
        isDefault: updatedTemplate.isDefault,
        isActive: updatedTemplate.isActive,
        htmlContent: updatedTemplate.htmlContent,
        cssContent: updatedTemplate.cssContent,
        variables: updatedTemplate.variables,
        createdAt: updatedTemplate.createdAt.toISOString(),
        updatedAt: updatedTemplate.updatedAt.toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to update invoice template', {
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
 * Delete Invoice Template
 * 
 * DELETE /api/v1/admin/invoice-templates/:templateId
 */
export async function handleDeleteTemplate(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'DELETE') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'write');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/invoice-templates\/([^/]+)/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: templateId required in path');
    }
    const templateId = pathMatch[1];

    const rdsPool = createRdsPool(env);
    const template = await getTemplateById(rdsPool, templateId);

    if (!template) {
      throw new NotFoundError(`Invoice template not found: ${templateId}`);
    }

    if (template.organisationId) {
      checkOrganisationAccess(authContext, template.organisationId);
    } else if (!authContext.role || authContext.role !== 'admin') {
      // Only admins can delete system templates
      return new Response(
        JSON.stringify({ error: 'Only admins can delete system templates', code: 'FORBIDDEN', statusCode: 403 }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await deleteTemplate(rdsPool, templateId);

    return new Response(
      JSON.stringify({
        message: 'Invoice template deleted successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to delete invoice template', {
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
 * Preview Invoice Template
 * 
 * POST /api/v1/admin/invoice-templates/:templateId/preview
 * GET /api/v1/admin/invoice-templates/:templateId/preview?invoiceId={invoiceId}
 */
export async function handlePreviewTemplate(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'read');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/invoice-templates\/([^/]+)\/preview/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: templateId required in path');
    }
    const templateId = pathMatch[1];

    const rdsPool = createRdsPool(env);
    const template = await getTemplateById(rdsPool, templateId);

    if (!template) {
      throw new NotFoundError(`Invoice template not found: ${templateId}`);
    }

    if (template.organisationId) {
      checkOrganisationAccess(authContext, template.organisationId);
    }

    let templateData;

    if (request.method === 'GET') {
      // Use invoice ID from query params
      const invoiceId = url.searchParams.get('invoiceId');
      if (invoiceId) {
        const invoice = await getInvoiceById(rdsPool, invoiceId);
        if (!invoice) {
          throw new NotFoundError(`Invoice not found: ${invoiceId}`);
        }

        // Fetch organisation and line items
        const orgResult = await rdsPool.query(
          `SELECT name, billing_email FROM organisations WHERE id = $1`,
          [invoice.organisationId]
        );
        const organisation = orgResult.rows[0];

        const lineItemsResult = await rdsPool.query(
          `SELECT description, metric_name, unit, quantity, unit_price, total, currency
           FROM invoice_line_items
           WHERE invoice_id = $1
           ORDER BY COALESCE(line_number, 1) ASC`,
          [invoiceId]
        );

        templateData = prepareTemplateData(
          invoice,
          {
            name: organisation.name,
            billingEmail: organisation.billing_email || undefined,
          },
          lineItemsResult.rows.map((row) => ({
            description: row.description,
            metricName: row.metric_name,
            unit: row.unit,
            quantity: row.quantity.toString(),
            unitPrice: row.unit_price.toString(),
            total: row.total.toString(),
            currency: row.currency,
          }))
        );
      } else {
        // Use preview data from template
        templateData = template.previewData as any;
      }
    } else {
      // POST: Use provided preview data
      const body = await request.json();
      templateData = body.previewData || template.previewData;
    }

    if (!templateData) {
      throw new ValidationError('Preview data is required');
    }

    // Render template
    const html = renderTemplateWithData(template, templateData);

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
      },
    });
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to preview invoice template', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
