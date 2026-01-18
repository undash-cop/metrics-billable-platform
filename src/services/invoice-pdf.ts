import { Env } from '../types/env.js';
import { Invoice } from '../types/domain.js';
import { createLogger } from '../utils/logger.js';
import { queryRds } from '../db/rds.js';
import type pg from 'pg';
import {
  getDefaultTemplate,
  getTemplateById,
  renderTemplateWithData,
  prepareTemplateData,
} from './invoice-template.js';

/**
 * Invoice PDF Service
 * 
 * Generates PDF invoices from invoice data.
 * Uses HTML template + PDF generation service, stores in Cloudflare R2.
 * 
 * Design Decisions:
 * 1. HTML Template: Generate HTML invoice, convert to PDF
 * 2. R2 Storage: Store PDFs in Cloudflare R2 for cost-effective storage
 * 3. Async Generation: PDF generation is async, doesn't block invoice creation
 * 4. Idempotent: Safe to regenerate PDFs
 */

export interface InvoicePdfData {
  invoice: Invoice;
  organisation: {
    name: string;
    billingEmail?: string;
  };
  lineItems: Array<{
    id: string;
    invoiceId: string;
    projectId: string;
    lineNumber?: number;
    description?: string;
    metricName: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    total: string;
    currency: string;
  }>;
}

/**
 * Generate HTML invoice template
 */
export function generateInvoiceHtml(data: InvoicePdfData): string {
  const { invoice, organisation, lineItems } = data;
  
  const invoiceDate = invoice.issuedAt 
    ? new Date(invoice.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date(invoice.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  
  const dueDate = new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const billingPeriod = `${monthNames[invoice.month - 1]} ${invoice.year}`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #fff;
      padding: 40px;
    }
    
    .invoice-container {
      max-width: 800px;
      margin: 0 auto;
      background: #fff;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 2px solid #e5e7eb;
    }
    
    .company-info h1 {
      font-size: 24px;
      color: #1f2937;
      margin-bottom: 10px;
    }
    
    .invoice-info {
      text-align: right;
    }
    
    .invoice-info h2 {
      font-size: 28px;
      color: #646cff;
      margin-bottom: 10px;
    }
    
    .invoice-details {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin-bottom: 40px;
    }
    
    .detail-section h3 {
      font-size: 14px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }
    
    .detail-section p {
      font-size: 16px;
      color: #1f2937;
      margin: 5px 0;
    }
    
    .line-items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    
    .line-items thead {
      background: #f9fafb;
    }
    
    .line-items th {
      padding: 12px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 2px solid #e5e7eb;
    }
    
    .line-items td {
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
      color: #1f2937;
    }
    
    .line-items tbody tr:hover {
      background: #f9fafb;
    }
    
    .text-right {
      text-align: right;
    }
    
    .totals {
      display: flex;
      justify-content: flex-end;
      margin-top: 20px;
    }
    
    .totals-table {
      width: 300px;
    }
    
    .totals-table tr {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
    }
    
    .totals-table .label {
      color: #6b7280;
      font-weight: 500;
    }
    
    .totals-table .amount {
      color: #1f2937;
      font-weight: 600;
    }
    
    .totals-table .total-row {
      border-top: 2px solid #e5e7eb;
      margin-top: 10px;
      padding-top: 10px;
    }
    
    .totals-table .total-row .label,
    .totals-table .total-row .amount {
      font-size: 18px;
      font-weight: 700;
      color: #646cff;
    }
    
    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 12px;
    }
    
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .status-paid {
      background: #d1fae5;
      color: #065f46;
    }
    
    .status-pending {
      background: #fef3c7;
      color: #92400e;
    }
    
    .status-overdue {
      background: #fee2e2;
      color: #991b1b;
    }
    
    @media print {
      body {
        padding: 0;
      }
      
      .header {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    <div class="header">
      <div class="company-info">
        <h1>Metrics Billing Platform</h1>
        <p>Invoice for ${organisation.name}</p>
      </div>
      <div class="invoice-info">
        <h2>INVOICE</h2>
        <p><strong>${invoice.invoiceNumber}</strong></p>
        <p>
          <span class="status-badge status-${invoice.status}">${invoice.status.toUpperCase()}</span>
        </p>
      </div>
    </div>
    
    <div class="invoice-details">
      <div class="detail-section">
        <h3>Bill To</h3>
        <p><strong>${organisation.name}</strong></p>
        ${organisation.billingEmail ? `<p>${organisation.billingEmail}</p>` : ''}
      </div>
      <div class="detail-section">
        <h3>Invoice Details</h3>
        <p><strong>Invoice Date:</strong> ${invoiceDate}</p>
        <p><strong>Due Date:</strong> ${dueDate}</p>
        <p><strong>Billing Period:</strong> ${billingPeriod}</p>
      </div>
    </div>
    
    <table class="line-items">
      <thead>
        <tr>
          <th>Description</th>
          <th class="text-right">Quantity</th>
          <th class="text-right">Unit Price</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${lineItems.map(item => `
        <tr>
          <td>${item.description || `${item.metricName} (${item.unit})`}</td>
          <td class="text-right">${parseFloat(item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</td>
          <td class="text-right">${parseFloat(item.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${invoice.currency}</td>
          <td class="text-right"><strong>${parseFloat(item.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${invoice.currency}</strong></td>
        </tr>
        `).join('')}
      </tbody>
    </table>
    
    <div class="totals">
      <table class="totals-table">
        <tr>
          <td class="label">Subtotal:</td>
          <td class="amount">${parseFloat(invoice.subtotal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${invoice.currency}</td>
        </tr>
        <tr>
          <td class="label">Tax:</td>
          <td class="amount">${parseFloat(invoice.tax).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${invoice.currency}</td>
        </tr>
        <tr class="total-row">
          <td class="label">Total:</td>
          <td class="amount">${parseFloat(invoice.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${invoice.currency}</td>
        </tr>
      </table>
    </div>
    
    <div class="footer">
      <p>Thank you for your business!</p>
      <p>This is an automated invoice generated by Metrics Billing Platform.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate PDF from HTML using PDF generation service
 * 
 * For Cloudflare Workers, we can use:
 * - PDFShift API
 * - HTMLtoPDF API
 * - Or generate HTML and let client convert to PDF
 * 
 * This implementation uses HTML generation and stores HTML in R2.
 * PDF conversion can be done client-side or via a service.
 */
export async function generateInvoicePdf(
  env: Env,
  html: string,
  invoiceNumber: string
): Promise<{ pdfUrl: string; pdfData?: Uint8Array }> {
  const logger = createLogger(env);

  // Option 1: Use PDF generation service (e.g., PDFShift, HTMLtoPDF)
  if (env.PDF_GENERATION_API_KEY) {
    try {
      const pdfData = await generatePdfViaService(env, html);
      
      // Upload to R2
      const pdfUrl = await uploadPdfToR2(env, pdfData, invoiceNumber);
      
      return { pdfUrl };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('PDF generation via service failed', {
        error: {
          message: errorMessage,
          code: 'PDF_GENERATION_FAILED',
        },
        invoiceNumber,
      });
      // Fall through to HTML storage
    }
  }

  // Option 2: Store HTML in R2, convert client-side or via worker
  // For now, we'll store HTML and serve it with PDF headers
  const htmlUrl = await uploadHtmlToR2(env, html, invoiceNumber);
  
  return {
    pdfUrl: htmlUrl, // Will be served as HTML with PDF download headers
  };
}

/**
 * Generate PDF using external service (PDFShift, HTMLtoPDF, etc.)
 */
async function generatePdfViaService(
  env: Env,
  html: string
): Promise<Uint8Array> {
  const apiKey = env.PDF_GENERATION_API_KEY;
  if (!apiKey) {
    throw new Error('PDF_GENERATION_API_KEY not configured');
  }
  
  const apiUrl = env.PDF_GENERATION_API_URL || 'https://api.pdfshift.io/v3/convert';

  // btoa and fetch are available in Cloudflare Workers runtime
  // @ts-expect-error - btoa is available in Cloudflare Workers
  const authHeader = `Basic ${btoa(`api:${apiKey}`)}`;

  // @ts-expect-error - fetch is available in Cloudflare Workers
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: html,
      format: 'pdf',
      landscape: false,
      margin: '20mm',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PDF generation failed: ${error}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Upload PDF to Cloudflare R2
 */
async function uploadPdfToR2(
  env: Env,
  pdfData: Uint8Array,
  invoiceNumber: string
): Promise<string> {
  if (!env.INVOICE_PDFS_R2) {
    throw new Error('R2 bucket not configured for invoice PDFs');
  }

  const key = `invoices/${invoiceNumber}.pdf`;
  
  await env.INVOICE_PDFS_R2.put(key, pdfData, {
    httpMetadata: {
      contentType: 'application/pdf',
      cacheControl: 'public, max-age=31536000', // 1 year cache
    },
    customMetadata: {
      invoiceNumber,
      uploadedAt: new Date().toISOString(),
    },
  });

  // Return public URL (if R2 public bucket) or signed URL
  // For now, return a path that will be served by a worker endpoint
  return `/api/v1/invoices/${invoiceNumber}/pdf`;
}

/**
 * Upload HTML to R2 (fallback if PDF service not available)
 */
async function uploadHtmlToR2(
  env: Env,
  html: string,
  invoiceNumber: string
): Promise<string> {
  if (!env.INVOICE_PDFS_R2) {
    throw new Error('R2 bucket not configured for invoice PDFs');
  }

  const key = `invoices/${invoiceNumber}.html`;
  
  await env.INVOICE_PDFS_R2.put(key, html, {
    httpMetadata: {
      contentType: 'text/html',
      cacheControl: 'public, max-age=31536000',
    },
    customMetadata: {
      invoiceNumber,
      uploadedAt: new Date().toISOString(),
    },
  });

  return `/api/v1/invoices/${invoiceNumber}/pdf`;
}

/**
 * Generate and store PDF for an invoice
 */
export async function generateInvoicePdfForInvoice(
  env: Env,
  pool: pg.Pool,
  invoiceId: string
): Promise<string> {
  const logger = createLogger(env);

  try {
    // Fetch invoice data
    const invoiceResult = await queryRds<Invoice & { organisation_name: string; billing_email: string | null; template_id: string | null; billing_period_start: Date; billing_period_end: Date; tax_rate?: number }>(
      pool,
      `SELECT 
        i.*,
        o.name as organisation_name,
        o.billing_email,
        i.template_id,
        i.billing_period_start,
        i.billing_period_end,
        CASE WHEN i.subtotal > 0 THEN (i.tax_amount / i.subtotal) ELSE 0 END as tax_rate
      FROM invoices i
      JOIN organisations o ON o.id = i.organisation_id
      WHERE i.id = $1`,
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      throw new Error(`Invoice not found: ${invoiceId}`);
    }

    const invoiceRow = invoiceResult.rows[0];
    const invoice: Invoice = {
      id: invoiceRow.id,
      organisationId: invoiceRow.organisation_id,
      invoiceNumber: invoiceRow.invoice_number,
      status: invoiceRow.status as Invoice['status'],
      subtotal: invoiceRow.subtotal.toString(),
      tax: invoiceRow.tax_amount.toString(),
      total: invoiceRow.total.toString(),
      currency: invoiceRow.currency,
      month: invoiceRow.month,
      year: invoiceRow.year,
      dueDate: invoiceRow.due_date,
      issuedAt: invoiceRow.issued_at || undefined,
      paidAt: invoiceRow.paid_at || undefined,
      createdAt: invoiceRow.created_at,
      updatedAt: invoiceRow.updated_at,
      billingPeriodStart: invoiceRow.billing_period_start,
      billingPeriodEnd: invoiceRow.billing_period_end,
      taxRate: invoiceRow.tax_rate,
    };

    // Fetch line items
    type LineItemRow = {
      id: string;
      invoice_id: string;
      project_id: string;
      line_number?: number;
      description?: string;
      metric_name: string;
      quantity: string;
      unit: string;
      unit_price: string;
      total: string;
      currency: string;
    };

    const lineItemsResult = await queryRds<LineItemRow>(
      pool,
      `SELECT 
        id, invoice_id, project_id, line_number, description, metric_name,
        quantity, unit, unit_price, total, currency
      FROM invoice_line_items
      WHERE invoice_id = $1
      ORDER BY COALESCE(line_number, 1) ASC, created_at ASC`,
      [invoiceId]
    );

    const lineItems: Array<{
      id: string;
      invoiceId: string;
      projectId: string;
      lineNumber?: number;
      description?: string;
      metricName: string;
      quantity: string;
      unit: string;
      unitPrice: string;
      total: string;
      currency: string;
    }> = lineItemsResult.rows.map((row: LineItemRow, index: number) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      projectId: row.project_id,
      lineNumber: row.line_number || index + 1,
      description: row.description || `${row.metric_name} (${row.unit})`,
      metricName: row.metric_name,
      quantity: row.quantity,
      unit: row.unit,
      unitPrice: row.unit_price,
      total: row.total,
      currency: row.currency,
    }));

    // Get template (use invoice template_id if set, otherwise default)
    let template;
    if (invoiceRow.template_id) {
      template = await getTemplateById(pool, invoiceRow.template_id);
    }
    if (!template) {
      template = await getDefaultTemplate(pool, invoice.organisationId);
    }

    // Prepare template data
    const templateData = prepareTemplateData(
      invoice,
      {
        name: invoiceRow.organisation_name,
        billingEmail: invoiceRow.billing_email || undefined,
      },
      lineItems
    );

    // Render template
    const html = renderTemplateWithData(template, templateData);

    // Generate PDF
    const { pdfUrl } = await generateInvoicePdf(env, html, invoice.invoiceNumber);

    // Update invoice with PDF URL
    await queryRds(
      pool,
      `UPDATE invoices 
       SET pdf_url = $1, pdf_generated_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [pdfUrl, invoiceId]
    );

    logger.info('Invoice PDF generated successfully', {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      pdfUrl,
    });

    return pdfUrl;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate invoice PDF', {
      invoiceId,
      error: {
        message: errorMessage,
        code: 'PDF_GENERATION_ERROR',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error instanceof Error ? error : new Error(String(error));
  }
}
