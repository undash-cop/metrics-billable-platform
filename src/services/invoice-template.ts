import pg from 'pg';
import { Env } from '../types/env.js';
import { queryRds, transaction } from '../db/rds.js';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

/**
 * Invoice Template Service
 * 
 * Handles invoice template management and rendering.
 * Supports customizable HTML templates with variable substitution.
 */

export interface InvoiceTemplate {
  id: string;
  organisationId?: string;
  name: string;
  description?: string;
  templateType: 'html' | 'pdf';
  isDefault: boolean;
  isActive: boolean;
  htmlContent: string;
  cssContent: string;
  variables: Record<string, string>; // Variable name -> description
  previewData?: Record<string, unknown>;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateRenderData {
  invoice_number: string;
  organisation_name: string;
  billing_email?: string;
  invoice_date: string;
  due_date: string;
  billing_period_start: string;
  billing_period_end: string;
  status: string;
  currency: string;
  subtotal: string;
  tax: string;
  tax_rate: string;
  total: string;
  line_items: Array<{
    description: string;
    quantity: string;
    unit_price: string;
    total: string;
    currency: string;
  }>;
}

/**
 * Simple template engine for variable substitution
 * Supports {{variable}} syntax and {{#if variable}}...{{/if}} conditionals
 */
function renderTemplate(template: string, data: Record<string, unknown>): string {
  let rendered = template;

  // Handle conditionals {{#if variable}}...{{/if}}
  const ifPattern = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  rendered = rendered.replace(ifPattern, (match, varName, content) => {
    const value = data[varName];
    if (value && value !== '' && value !== null && value !== undefined) {
      return content;
    }
    return '';
  });

  // Handle {{#each array}}...{{/each}} loops
  const eachPattern = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  rendered = rendered.replace(eachPattern, (match, arrayName, content) => {
    const array = data[arrayName];
    if (Array.isArray(array)) {
      return array.map((item) => {
        let itemContent = content;
        // Replace {{property}} with item.property
        Object.keys(item).forEach((key) => {
          const value = item[key];
          const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
          itemContent = itemContent.replace(regex, String(value));
        });
        return itemContent;
      }).join('');
    }
    return '';
  });

  // Handle simple variable substitution {{variable}}
  Object.keys(data).forEach((key) => {
    const value = data[key];
    if (value !== null && value !== undefined) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      rendered = rendered.replace(regex, String(value));
    }
  });

  return rendered;
}

/**
 * Get default template for an organisation
 */
export async function getDefaultTemplate(
  pool: pg.Pool,
  organisationId?: string
): Promise<InvoiceTemplate> {
  let query = `
    SELECT id, organisation_id, name, description, template_type,
           is_default, is_active, html_content, css_content,
           variables, preview_data, created_by, created_at, updated_at
    FROM invoice_templates
    WHERE is_active = true
  `;
  const params: unknown[] = [];

  if (organisationId) {
    // First try organisation-specific default
    query += ` AND organisation_id = $1 AND is_default = true`;
    params.push(organisationId);
  } else {
    // Get system-wide default
    query += ` AND organisation_id IS NULL AND is_default = true`;
  }

  query += ` ORDER BY created_at ASC LIMIT 1`;

  const result = await queryRds<InvoiceTemplate>(pool, query, params);

  if (result.rows.length === 0) {
    // Fallback: get any active system template
    const fallbackResult = await queryRds<InvoiceTemplate>(
      pool,
      `SELECT id, organisation_id, name, description, template_type,
              is_default, is_active, html_content, css_content,
              variables, preview_data, created_by, created_at, updated_at
       FROM invoice_templates
       WHERE organisation_id IS NULL AND is_active = true
       ORDER BY created_at ASC
       LIMIT 1`
    );

    if (fallbackResult.rows.length === 0) {
      throw new NotFoundError('No invoice template found');
    }

    return mapTemplateFromDb(fallbackResult.rows[0]);
  }

  return mapTemplateFromDb(result.rows[0]);
}

/**
 * Get template by ID
 */
export async function getTemplateById(
  pool: pg.Pool,
  templateId: string
): Promise<InvoiceTemplate | null> {
  const result = await queryRds<InvoiceTemplate>(
    pool,
    `SELECT id, organisation_id, name, description, template_type,
            is_default, is_active, html_content, css_content,
            variables, preview_data, created_by, created_at, updated_at
     FROM invoice_templates
     WHERE id = $1`,
    [templateId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapTemplateFromDb(result.rows[0]);
}

/**
 * Get all templates for an organisation
 */
export async function getTemplatesByOrganisation(
  pool: pg.Pool,
  organisationId?: string,
  options?: {
    includeSystem?: boolean;
    isActive?: boolean;
  }
): Promise<InvoiceTemplate[]> {
  let query = `
    SELECT id, organisation_id, name, description, template_type,
           is_default, is_active, html_content, css_content,
           variables, preview_data, created_by, created_at, updated_at
    FROM invoice_templates
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (organisationId !== undefined) {
    if (options?.includeSystem) {
      query += ` AND (organisation_id = $1 OR organisation_id IS NULL)`;
      params.push(organisationId);
    } else {
      query += ` AND organisation_id = $1`;
      params.push(organisationId);
    }
  } else {
    // Only system templates
    query += ` AND organisation_id IS NULL`;
  }

  if (options?.isActive !== undefined) {
    query += ` AND is_active = $${params.length + 1}`;
    params.push(options.isActive);
  }

  query += ` ORDER BY is_default DESC, created_at DESC`;

  const result = await queryRds<InvoiceTemplate>(pool, query, params);

  return result.rows.map(mapTemplateFromDb);
}

/**
 * Create a new template
 */
export async function createTemplate(
  pool: pg.Pool,
  template: Omit<InvoiceTemplate, 'id' | 'createdAt' | 'updatedAt'>
): Promise<InvoiceTemplate> {
  // Validate template
  if (!template.htmlContent || template.htmlContent.trim().length === 0) {
    throw new ValidationError('HTML content is required');
  }

  return await transaction(pool, async (client) => {
    // If setting as default, unset other defaults for the same organisation
    if (template.isDefault) {
      await client.query(
        `UPDATE invoice_templates
         SET is_default = false
         WHERE organisation_id IS NOT DISTINCT FROM $1
           AND is_active = true`,
        [template.organisationId || null]
      );
    }

    const result = await queryRds<InvoiceTemplate>(
      pool,
      `INSERT INTO invoice_templates (
        organisation_id, name, description, template_type,
        is_default, is_active, html_content, css_content,
        variables, preview_data, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, organisation_id, name, description, template_type,
                is_default, is_active, html_content, css_content,
                variables, preview_data, created_by, created_at, updated_at`,
      [
        template.organisationId || null,
        template.name,
        template.description || null,
        template.templateType,
        template.isDefault,
        template.isActive,
        template.htmlContent,
        template.cssContent || '',
        JSON.stringify(template.variables || {}),
        template.previewData ? JSON.stringify(template.previewData) : null,
        template.createdBy || null,
      ]
    );

    return mapTemplateFromDb(result.rows[0]);
  });
}

/**
 * Update template
 */
export async function updateTemplate(
  pool: pg.Pool,
  templateId: string,
  updates: Partial<Omit<InvoiceTemplate, 'id' | 'organisationId' | 'createdAt' | 'createdBy'>>
): Promise<InvoiceTemplate> {
  const existing = await getTemplateById(pool, templateId);
  if (!existing) {
    throw new NotFoundError(`Template not found: ${templateId}`);
  }

  return await transaction(pool, async (client) => {
    // If setting as default, unset other defaults
    if (updates.isDefault === true) {
      await client.query(
        `UPDATE invoice_templates
         SET is_default = false
         WHERE id != $1
           AND organisation_id IS NOT DISTINCT FROM $2
           AND is_active = true`,
        [templateId, existing.organisationId || null]
      );
    }

    const updateFields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.templateType !== undefined) {
      updateFields.push(`template_type = $${paramIndex++}`);
      values.push(updates.templateType);
    }
    if (updates.isDefault !== undefined) {
      updateFields.push(`is_default = $${paramIndex++}`);
      values.push(updates.isDefault);
    }
    if (updates.isActive !== undefined) {
      updateFields.push(`is_active = $${paramIndex++}`);
      values.push(updates.isActive);
    }
    if (updates.htmlContent !== undefined) {
      updateFields.push(`html_content = $${paramIndex++}`);
      values.push(updates.htmlContent);
    }
    if (updates.cssContent !== undefined) {
      updateFields.push(`css_content = $${paramIndex++}`);
      values.push(updates.cssContent);
    }
    if (updates.variables !== undefined) {
      updateFields.push(`variables = $${paramIndex++}`);
      values.push(JSON.stringify(updates.variables));
    }
    if (updates.previewData !== undefined) {
      updateFields.push(`preview_data = $${paramIndex++}`);
      values.push(updates.previewData ? JSON.stringify(updates.previewData) : null);
    }

    updateFields.push(`updated_at = NOW()`);
    values.push(templateId);
    updateFields.push(`WHERE id = $${paramIndex++}`);

    const result = await queryRds<InvoiceTemplate>(
      pool,
      `UPDATE invoice_templates SET ${updateFields.join(', ')}
       RETURNING id, organisation_id, name, description, template_type,
                 is_default, is_active, html_content, css_content,
                 variables, preview_data, created_by, created_at, updated_at`,
      values
    );

    return mapTemplateFromDb(result.rows[0]);
  });
}

/**
 * Delete template
 */
export async function deleteTemplate(
  pool: pg.Pool,
  templateId: string
): Promise<void> {
  const result = await queryRds(
    pool,
    `DELETE FROM invoice_templates WHERE id = $1`,
    [templateId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError(`Template not found: ${templateId}`);
  }
}

/**
 * Render template with data
 */
export function renderTemplateWithData(
  template: InvoiceTemplate,
  data: TemplateRenderData
): string {
  // Combine HTML and CSS
  let html = template.htmlContent;

  // Replace {{css_content}} placeholder if present
  html = html.replace(/\{\{css_content\}\}/g, template.cssContent);

  // Render template with data
  const rendered = renderTemplate(html, data as Record<string, unknown>);

  return rendered;
}

/**
 * Prepare template data from invoice
 */
export function prepareTemplateData(
  invoice: {
    invoiceNumber: string;
    status: string;
    subtotal: string;
    tax: string;
    total: string;
    currency: string;
    dueDate: Date;
    issuedAt?: Date;
    createdAt: Date;
    billingPeriodStart: Date;
    billingPeriodEnd: Date;
    taxRate?: number;
  },
  organisation: {
    name: string;
    billingEmail?: string;
  },
  lineItems: Array<{
    description?: string;
    metricName: string;
    unit: string;
    quantity: string;
    unitPrice: string;
    total: string;
    currency: string;
  }>
): TemplateRenderData {
  const invoiceDate = invoice.issuedAt
    ? new Date(invoice.issuedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : new Date(invoice.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

  const dueDate = new Date(invoice.dueDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const billingPeriodStart = new Date(invoice.billingPeriodStart).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const billingPeriodEnd = new Date(invoice.billingPeriodEnd).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const taxRate = invoice.taxRate
    ? (invoice.taxRate * 100).toFixed(2)
    : invoice.subtotal !== '0'
    ? ((parseFloat(invoice.tax) / parseFloat(invoice.subtotal)) * 100).toFixed(2)
    : '0.00';

  return {
    invoice_number: invoice.invoiceNumber,
    organisation_name: organisation.name,
    billing_email: organisation.billingEmail,
    invoice_date: invoiceDate,
    due_date: dueDate,
    billing_period_start: billingPeriodStart,
    billing_period_end: billingPeriodEnd,
    status: invoice.status,
    currency: invoice.currency,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    tax_rate: taxRate,
    total: invoice.total,
    line_items: lineItems.map((item) => ({
      description: item.description || `${item.metricName} (${item.unit})`,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total: item.total,
      currency: item.currency,
    })),
  };
}

// Helper function to map database row to InvoiceTemplate
function mapTemplateFromDb(row: any): InvoiceTemplate {
  return {
    id: row.id,
    organisationId: row.organisation_id || undefined,
    name: row.name,
    description: row.description || undefined,
    templateType: row.template_type,
    isDefault: row.is_default,
    isActive: row.is_active,
    htmlContent: row.html_content,
    cssContent: row.css_content || '',
    variables: (row.variables as Record<string, string>) || {},
    previewData: row.preview_data || undefined,
    createdBy: row.created_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
