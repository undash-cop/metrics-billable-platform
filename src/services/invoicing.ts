import pg from 'pg';
import { queryRds, transaction } from '../db/rds.js';
import { Invoice, InvoiceLineItem, UsageAggregate, PricingPlan } from '../types/domain.js';
import { multiply, add, toFixedString } from '../utils/decimal.js';
import Decimal from 'decimal.js';
import { NotFoundError, DatabaseError } from '../utils/errors.js';
import { createAuditLog } from '../db/audit.js';

/**
 * Invoice generation service
 * Generates monthly invoices from usage aggregates
 */

export interface InvoiceGenerationRequest {
  organisationId: string;
  month: number;
  year: number;
  taxRate: string; // Decimal as string, e.g., '0.18' for 18% GST
}

/**
 * Get active pricing plan for a metric
 */
async function getActivePricingPlan(
  pool: pg.Pool,
  metricName: string,
  unit: string,
  date: Date
): Promise<PricingPlan | null> {
  const result = await queryRds<PricingPlan>(
    pool,
    `SELECT 
      id, metric_name, unit, price_per_unit, currency,
      effective_from, effective_to, is_active, created_at, updated_at
    FROM pricing_plans
    WHERE metric_name = $1
      AND unit = $2
      AND is_active = true
      AND effective_from <= $3
      AND (effective_to IS NULL OR effective_to >= $3)
    ORDER BY effective_from DESC
    LIMIT 1`,
    [metricName, unit, date]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    metricName: row.metric_name,
    unit: row.unit,
    pricePerUnit: row.price_per_unit.toString(),
    currency: row.currency,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Generate invoice for an organisation for a specific month
 */
export async function generateInvoice(
  pool: pg.Pool,
  request: InvoiceGenerationRequest,
  userId?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<Invoice> {
  return await transaction(pool, async (client) => {
    // Check if invoice already exists
    const existing = await client.query<Invoice>(
      `SELECT id FROM invoices
       WHERE organisation_id = $1
         AND month = $2
         AND year = $3
         AND status != 'cancelled'`,
      [request.organisationId, request.month, request.year]
    );

    if (existing.rows.length > 0) {
      throw new DatabaseError(
        `Invoice already exists for ${request.year}-${request.month}`
      );
    }

    // Get all usage aggregates for the month
    const aggregatesResult = await client.query<UsageAggregate>(
      `SELECT 
        id, organisation_id, project_id, metric_name, unit,
        total_value, month, year, created_at, updated_at
      FROM usage_aggregates
      WHERE organisation_id = $1
        AND month = $2
        AND year = $3`,
      [request.organisationId, request.month, request.year]
    );

    if (aggregatesResult.rows.length === 0) {
      throw new NotFoundError('No usage aggregates found for the period');
    }

    const aggregates = aggregatesResult.rows.map((row) => ({
      id: row.id,
      organisationId: row.organisation_id,
      projectId: row.project_id,
      metricName: row.metric_name,
      unit: row.unit,
      totalValue: Number(row.total_value),
      month: row.month,
      year: row.year,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    // Calculate invoice line items
    const lineItems: Array<{
      projectId: string;
      metricName: string;
      quantity: Decimal;
      unit: string;
      unitPrice: Decimal;
      total: Decimal;
      currency: string;
    }> = [];

    let subtotal = new Decimal(0);
    const currency = 'INR'; // Default currency

    for (const aggregate of aggregates) {
      // Get pricing plan
      const pricingPlan = await getActivePricingPlan(
        pool,
        aggregate.metricName,
        aggregate.unit,
        new Date(request.year, request.month - 1, 1)
      );

      if (!pricingPlan) {
        console.warn(
          `No pricing plan found for ${aggregate.metricName}/${aggregate.unit}`
        );
        continue;
      }

      const quantity = new Decimal(aggregate.totalValue);
      const unitPrice = new Decimal(pricingPlan.pricePerUnit);
      const total = multiply(quantity, unitPrice);

      lineItems.push({
        projectId: aggregate.projectId,
        metricName: aggregate.metricName,
        quantity,
        unit: aggregate.unit,
        unitPrice,
        total,
        currency: pricingPlan.currency,
      });

      subtotal = add(subtotal, total);
    }

    if (lineItems.length === 0) {
      throw new NotFoundError('No billable usage found for the period');
    }

    // Calculate tax
    const taxRate = new Decimal(request.taxRate);
    const tax = multiply(subtotal, taxRate);
    const total = add(subtotal, tax);

    // Generate invoice number
    const invoiceNumber = `INV-${request.year}${String(request.month).padStart(2, '0')}-${request.organisationId.substring(0, 8).toUpperCase()}`;

    // Calculate due date (30 days from invoice date)
    const invoiceDate = new Date(request.year, request.month - 1, 1);
    const dueDate = new Date(invoiceDate);
    dueDate.setMonth(dueDate.getMonth() + 1);
    dueDate.setDate(1); // First day of next month

    // Create invoice
    const invoiceResult = await client.query<Invoice>(
      `INSERT INTO invoices (
        organisation_id, invoice_number, status, subtotal, tax, total,
        currency, month, year, due_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, organisation_id, invoice_number, status, subtotal, tax, total,
                currency, month, year, due_date, issued_at, paid_at,
                created_at, updated_at`,
      [
        request.organisationId,
        invoiceNumber,
        'draft',
        toFixedString(subtotal, 2),
        toFixedString(tax, 2),
        toFixedString(total, 2),
        currency,
        request.month,
        request.year,
        dueDate,
      ]
    );

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

    // Create invoice line items
    for (const item of lineItems) {
      await client.query(
        `INSERT INTO invoice_line_items (
          invoice_id, project_id, metric_name, quantity, unit,
          unit_price, total, currency
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          invoice.id,
          item.projectId,
          item.metricName,
          toFixedString(item.quantity, 8),
          item.unit,
          toFixedString(item.unitPrice, 8),
          toFixedString(item.total, 2),
          item.currency,
        ]
      );
    }

    // Create audit log
    await createAuditLog(pool, {
      organisationId: request.organisationId,
      entityType: 'invoice',
      entityId: invoice.id,
      action: 'created',
      userId,
      changes: {
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        month: invoice.month,
        year: invoice.year,
      },
      ipAddress,
      userAgent,
    });

    return invoice;
  });
}

/**
 * Issue an invoice (change status from draft to pending)
 */
export async function issueInvoice(
  pool: pg.Pool,
  invoiceId: string,
  userId?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<Invoice> {
  return await transaction(pool, async (client) => {
    const result = await client.query<Invoice>(
      `UPDATE invoices
       SET status = 'pending', issued_at = NOW()
       WHERE id = $1 AND status = 'draft'
       RETURNING id, organisation_id, invoice_number, status, subtotal, tax, total,
                 currency, month, year, due_date, issued_at, paid_at,
                 created_at, updated_at`,
      [invoiceId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Invoice not found or not in draft status');
    }

    const invoiceRow = result.rows[0];
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

    // Create audit log
    await createAuditLog(pool, {
      organisationId: invoice.organisationId,
      entityType: 'invoice',
      entityId: invoice.id,
      action: 'issued',
      userId,
      ipAddress,
      userAgent,
    });

    return invoice;
  });
}
