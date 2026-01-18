import pg from 'pg';
import { queryRds } from '../db/rds.js';
import { Invoice, InvoiceLineItem } from '../types/domain.js';
import { NotFoundError } from '../utils/errors.js';

/**
 * Invoice repository
 */

export async function getInvoiceById(
  pool: pg.Pool,
  id: string
): Promise<Invoice | null> {
  const result = await queryRds<Invoice>(
    pool,
    `SELECT 
      id, organisation_id, invoice_number, status, subtotal, tax, total,
      currency, month, year, due_date, issued_at, paid_at,
      created_at, updated_at
    FROM invoices
    WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    organisationId: row.organisation_id,
    invoiceNumber: row.invoice_number,
    status: row.status as Invoice['status'],
    subtotal: row.subtotal.toString(),
    tax: row.tax.toString(),
    total: row.total.toString(),
    currency: row.currency,
    month: row.month,
    year: row.year,
    dueDate: row.due_date,
    issuedAt: row.issued_at || undefined,
    paidAt: row.paid_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getInvoicesByOrganisation(
  pool: pg.Pool,
  organisationId: string,
  limit: number = 100
): Promise<Invoice[]> {
  const result = await queryRds<Invoice>(
    pool,
    `SELECT 
      id, organisation_id, invoice_number, status, subtotal, tax, total,
      currency, month, year, due_date, issued_at, paid_at,
      created_at, updated_at
    FROM invoices
    WHERE organisation_id = $1
    ORDER BY created_at DESC
    LIMIT $2`,
    [organisationId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    organisationId: row.organisation_id,
    invoiceNumber: row.invoice_number,
    status: row.status as Invoice['status'],
    subtotal: row.subtotal.toString(),
    tax: row.tax.toString(),
    total: row.total.toString(),
    currency: row.currency,
    month: row.month,
    year: row.year,
    dueDate: row.due_date,
    issuedAt: row.issued_at || undefined,
    paidAt: row.paid_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getInvoiceLineItems(
  pool: pg.Pool,
  invoiceId: string
): Promise<InvoiceLineItem[]> {
  const result = await queryRds<InvoiceLineItem>(
    pool,
    `SELECT 
      id, invoice_id, project_id, metric_name, quantity, unit,
      unit_price, total, currency, created_at
    FROM invoice_line_items
    WHERE invoice_id = $1
    ORDER BY created_at ASC`,
    [invoiceId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    invoiceId: row.invoice_id,
    projectId: row.project_id,
    metricName: row.metric_name,
    quantity: row.quantity.toString(),
    unit: row.unit,
    unitPrice: row.unit_price.toString(),
    total: row.total.toString(),
    currency: row.currency,
    createdAt: row.created_at,
  }));
}
