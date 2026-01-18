import pg from 'pg';
import { queryRds, transaction } from '../db/rds.js';
import { Invoice, InvoiceLineItem, UsageAggregate } from '../types/domain.js';
import {
  CalculatedInvoice,
  PricingRule,
  MinimumChargeRule,
  BillingConfig,
} from '../types/pricing.js';
import { calculateInvoice } from './billing-calculator.js';
import { toFixedString } from '../utils/decimal.js';
import { NotFoundError, DatabaseError, ValidationError, ConflictError } from '../utils/errors.js';
import { createAuditLog } from '../db/audit.js';
import { withIdempotency } from '../db/idempotency.js';
import Decimal from 'decimal.js';
import { toDecimal, subtract, add } from '../utils/decimal.js';
import { getOrganisationCurrency, convertPricingPlanToCurrency } from './currency-conversion.js';
import { sendInvoiceEmail } from './invoice-email.js';

/**
 * Invoice Generator Service
 * 
 * Handles persistence of calculated invoices.
 * Separates calculation (billing-calculator) from persistence (this service).
 * 
 * Responsibilities:
 * - Fetch usage aggregates and pricing rules from database
 * - Call billing calculator for calculations
 * - Persist calculated invoice to database
 * - Mark invoice as immutable once finalized
 */

export interface InvoiceGenerationRequest {
  organisationId: string;
  month: number;
  year: number;
}

/**
 * Fetch usage aggregates for billing period
 */
async function fetchUsageAggregates(
  pool: pg.Pool,
  organisationId: string,
  month: number,
  year: number
): Promise<UsageAggregate[]> {
  const result = await queryRds<UsageAggregate>(
    pool,
    `SELECT 
      id, organisation_id, project_id, metric_name, unit,
      total_value, month, year, created_at, updated_at
    FROM usage_aggregates
    WHERE organisation_id = $1
      AND month = $2
      AND year = $3
    ORDER BY project_id, metric_name`,
    [organisationId, month, year]
  );

  return result.rows.map((row) => ({
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
}

/**
 * Fetch all active pricing rules
 */
async function fetchPricingRules(
  pool: pg.Pool,
  date: Date
): Promise<PricingRule[]> {
  const result = await queryRds<PricingRule>(
    pool,
    `SELECT 
      id, organisation_id, metric_name, unit, price_per_unit, currency,
      effective_from, effective_to, is_active, metadata, created_at, updated_at
    FROM pricing_plans
    WHERE is_active = true
      AND effective_from <= $1
      AND (effective_to IS NULL OR effective_to >= $1)
    ORDER BY organisation_id NULLS LAST, effective_from DESC`,
    [date]
  );

  return result.rows.map((row) => ({
    id: row.id,
    organisationId: row.organisation_id || undefined,
    metricName: row.metric_name,
    unit: row.unit,
    pricePerUnit: row.price_per_unit.toString(),
    currency: row.currency,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || undefined,
    isActive: row.is_active,
    metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Fetch minimum charge rules
 * 
 * Note: This assumes a minimum_charge_rules table exists.
 * If not, minimum charges can be configured per organisation.
 */
async function fetchMinimumChargeRules(
  pool: pg.Pool,
  date: Date
): Promise<MinimumChargeRule[]> {
  try {
    const result = await queryRds<MinimumChargeRule>(
      pool,
      `SELECT 
        id, organisation_id, minimum_amount, currency,
        effective_from, effective_to, is_active, description, created_at, updated_at
      FROM minimum_charge_rules
      WHERE is_active = true
        AND effective_from <= $1
        AND (effective_to IS NULL OR effective_to >= $1)
      ORDER BY organisation_id NULLS LAST, effective_from DESC`,
      [date]
    );

    return result.rows.map((row) => ({
      id: row.id,
      organisationId: row.organisation_id || undefined,
      minimumAmount: row.minimum_amount.toString(),
      currency: row.currency,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to || undefined,
      isActive: row.is_active,
      description: row.description || undefined,
    }));
  } catch (error) {
    // Table might not exist - return empty array
    // Minimum charges can be configured per organisation instead
    return [];
  }
}

/**
 * Fetch billing configuration for organisation
 */
async function fetchBillingConfig(
  pool: pg.Pool,
  organisationId: string
): Promise<BillingConfig> {
  // Try to fetch from billing_configs table, or use defaults
  try {
    const result = await queryRds<BillingConfig>(
      pool,
      `SELECT 
        organisation_id, tax_rate, currency, billing_cycle, payment_terms,
        minimum_charge_enabled, minimum_charge_amount
      FROM billing_configs
      WHERE organisation_id = $1`,
      [organisationId]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        organisationId: row.organisation_id,
        taxRate: row.tax_rate.toString(),
        currency: row.currency,
        billingCycle: row.billing_cycle as 'monthly' | 'yearly',
        paymentTerms: row.payment_terms,
        minimumChargeEnabled: row.minimum_charge_enabled,
        minimumChargeAmount: row.minimum_charge_amount?.toString(),
      };
    }
  } catch (error) {
    // Table might not exist - use defaults
  }

  // Get organisation currency
  const orgCurrency = await getOrganisationCurrency(pool, organisationId);

  // Default billing config
  return {
    organisationId,
    taxRate: '0.18', // 18% GST (default)
    currency: orgCurrency,
    billingCycle: 'monthly',
    paymentTerms: 30,
    minimumChargeEnabled: false,
  };
}

/**
 * Generate invoice number
 */
function generateInvoiceNumber(
  organisationId: string,
  year: number,
  month: number
): string {
  const orgPrefix = organisationId.substring(0, 8).toUpperCase();
  const monthStr = String(month).padStart(2, '0');
  return `INV-${year}${monthStr}-${orgPrefix}`;
}

/**
 * Validate invoice calculations
 * 
 * Ensures:
 * - Total = subtotal + tax - discount
 * - Line item totals sum to subtotal
 * - All amounts are non-negative
 * - No calculation errors
 */
function validateInvoiceCalculations(
  calculatedInvoice: CalculatedInvoice
): void {
  // Validate total calculation
  const expectedTotal = subtract(
    add(calculatedInvoice.subtotalAfterMinimum, calculatedInvoice.taxAmount),
    calculatedInvoice.discountAmount
  );
  
  const totalDiff = expectedTotal.sub(calculatedInvoice.total).abs();
  if (totalDiff.gt(new Decimal('0.01'))) {
    throw new ValidationError(
      `Invoice total mismatch: expected ${expectedTotal.toString()}, got ${calculatedInvoice.total.toString()}`
    );
  }

  // Validate line items sum to subtotal
  const lineItemsTotal = calculatedInvoice.lineItems.reduce(
    (sum, item) => add(sum, item.total),
    new Decimal(0)
  );
  
  const subtotalDiff = lineItemsTotal.sub(calculatedInvoice.subtotalAfterMinimum).abs();
  if (subtotalDiff.gt(new Decimal('0.01'))) {
    throw new ValidationError(
      `Line items total mismatch: expected ${calculatedInvoice.subtotalAfterMinimum.toString()}, got ${lineItemsTotal.toString()}`
    );
  }

  // Validate all amounts are non-negative
  if (calculatedInvoice.subtotal.lt(0)) {
    throw new ValidationError('Subtotal cannot be negative');
  }
  if (calculatedInvoice.taxAmount.lt(0)) {
    throw new ValidationError('Tax amount cannot be negative');
  }
  if (calculatedInvoice.discountAmount.lt(0)) {
    throw new ValidationError('Discount amount cannot be negative');
  }
  if (calculatedInvoice.total.lt(0)) {
    throw new ValidationError('Total cannot be negative');
  }

  // Validate line items
  for (const lineItem of calculatedInvoice.lineItems) {
    if (lineItem.quantity.lt(0)) {
      throw new ValidationError(`Line item quantity cannot be negative: ${lineItem.metricName}`);
    }
    if (lineItem.unitPrice.lt(0)) {
      throw new ValidationError(`Line item unit price cannot be negative: ${lineItem.metricName}`);
    }
    if (lineItem.total.lt(0)) {
      throw new ValidationError(`Line item total cannot be negative: ${lineItem.metricName}`);
    }

    // Validate line item total = quantity * unitPrice (with rounding tolerance)
    const expectedLineTotal = lineItem.quantity.mul(lineItem.unitPrice);
    const lineTotalDiff = expectedLineTotal.sub(lineItem.total).abs();
    if (lineTotalDiff.gt(new Decimal('0.01'))) {
      throw new ValidationError(
        `Line item total mismatch for ${lineItem.metricName}: expected ${expectedLineTotal.toString()}, got ${lineItem.total.toString()}`
      );
    }
  }
}

/**
 * Persist calculated invoice to database
 */
async function persistInvoice(
  client: pg.PoolClient,
  calculatedInvoice: CalculatedInvoice,
  invoiceNumber: string,
  pricingRulesUsed: PricingRule[]
): Promise<Invoice> {
  // Validate calculations before persistence
  validateInvoiceCalculations(calculatedInvoice);
  // Store pricing rules used in metadata for audit trail
  const pricingRulesMetadata = pricingRulesUsed.map((rule) => ({
    id: rule.id,
    metricName: rule.metricName,
    unit: rule.unit,
    pricePerUnit: rule.pricePerUnit,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    effectiveTo: rule.effectiveTo?.toISOString(),
    organisationId: rule.organisationId || null,
  }));

  // Insert invoice with pricing rules metadata
  const invoiceResult = await client.query<Invoice>(
    `INSERT INTO invoices (
      organisation_id, invoice_number, status,
      subtotal, tax_amount, discount_amount, total,
      currency, billing_period_start, billing_period_end, due_date,
      month, year, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING id, organisation_id, invoice_number, status,
              subtotal, tax_amount, discount_amount, total,
              currency, billing_period_start, billing_period_end, due_date,
              month, year, issued_at, paid_at, created_at, updated_at`,
    [
      calculatedInvoice.organisationId,
      invoiceNumber,
      'draft', // Start as draft, must be finalized explicitly
      toFixedString(calculatedInvoice.subtotal, 2),
      toFixedString(calculatedInvoice.taxAmount, 2),
      toFixedString(calculatedInvoice.discountAmount, 2),
      toFixedString(calculatedInvoice.total, 2),
      calculatedInvoice.currency,
      calculatedInvoice.billingPeriodStart,
      calculatedInvoice.billingPeriodEnd,
      calculatedInvoice.dueDate,
      calculatedInvoice.month,
      calculatedInvoice.year,
      JSON.stringify({
        pricingRules: pricingRulesMetadata,
        calculationTimestamp: new Date().toISOString(),
        lineItemsCount: calculatedInvoice.lineItems.length,
      }),
    ]
  );

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
  };

  // Insert line items
  let lineNumber = 1;
  for (const lineItem of calculatedInvoice.lineItems) {
    await client.query(
      `INSERT INTO invoice_line_items (
        invoice_id, line_number, project_id, metric_name, description,
        quantity, unit, unit_price, total, currency
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        invoice.id,
        lineNumber++,
        lineItem.projectId || null,
        lineItem.metricName,
        lineItem.description,
        toFixedString(lineItem.quantity, 8),
        lineItem.unit,
        toFixedString(lineItem.unitPrice, 8),
        toFixedString(lineItem.total, 2),
        lineItem.currency,
      ]
    );
  }

  return invoice;
}

/**
 * Generate invoice for an organisation for a specific month
 * 
 * This is the main entry point for invoice generation.
 * It orchestrates fetching data, calculating invoice, and persisting it.
 */
export async function generateInvoice(
  pool: pg.Pool,
  request: InvoiceGenerationRequest,
  env?: Env,
  userId?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<Invoice> {
  // Generate idempotency key to prevent duplicate invoice generation
  // Format: invoice_{orgId}_{year}_{month}
  const idempotencyKey = `invoice_${request.organisationId}_${request.year}_${request.month}`;

  return await withIdempotency(
    pool,
    idempotencyKey,
    'invoice',
    async () => {
      return await transaction(pool, async (client) => {
        // Double-check if invoice already exists (race condition protection)
        // The unique constraint will also prevent duplicates, but this provides better error messages
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM invoices
           WHERE organisation_id = $1
             AND month = $2
             AND year = $3
             AND status != 'cancelled'`,
          [request.organisationId, request.month, request.year]
        );

        if (existing.rows.length > 0) {
          throw new ConflictError(
            `Invoice already exists for ${request.year}-${request.month}`,
            { invoiceId: existing.rows[0].id }
          );
        }

        // Validate month/year
        if (request.month < 1 || request.month > 12) {
          throw new ValidationError('Invalid month (must be 1-12)');
        }
        if (request.year < 2020) {
          throw new ValidationError('Invalid year (must be >= 2020)');
        }

        // Fetch data needed for calculation
        const billingDate = new Date(request.year, request.month - 1, 1);
        
        const [aggregates, rawPricingRules, minimumChargeRules, billingConfig] =
          await Promise.all([
            fetchUsageAggregates(pool, request.organisationId, request.month, request.year),
            fetchPricingRules(pool, billingDate),
            fetchMinimumChargeRules(pool, billingDate),
            fetchBillingConfig(pool, request.organisationId),
          ]);

        if (aggregates.length === 0) {
          throw new NotFoundError('No usage aggregates found for the period');
        }

        // Convert pricing rules to organisation currency if needed
        const pricingRules = await Promise.all(
          rawPricingRules.map(async (rule) => {
            if (rule.currency === billingConfig.currency) {
              return rule;
            }

            // Convert pricing rule to organisation currency
            const converted = await convertPricingPlanToCurrency(
              pool,
              {
                pricePerUnit: rule.pricePerUnit,
                currency: rule.currency,
              },
              billingConfig.currency,
              billingDate
            );

            return {
              ...rule,
              pricePerUnit: converted.pricePerUnit,
              currency: converted.currency,
            };
          })
        );

        // Calculate invoice (pure function - no side effects)
        const calculatedInvoice = calculateInvoice(
          aggregates,
          pricingRules,
          minimumChargeRules,
          billingConfig,
          request.month,
          request.year
        );

        // Generate invoice number
        const invoiceNumber = generateInvoiceNumber(
          request.organisationId,
          request.year,
          request.month
        );

        // Persist calculated invoice with pricing rules metadata for audit trail
        const invoice = await persistInvoice(client, calculatedInvoice, invoiceNumber, pricingRules);

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
            lineItemsCount: calculatedInvoice.lineItems.length,
          },
          ipAddress,
          userAgent,
        });

        // Send invoice email (non-blocking, don't fail invoice generation if email fails)
        // Only send if invoice is finalized (not draft) and env is provided
        if (env && (invoice.status === 'finalized' || invoice.status === 'pending')) {
          try {
            await sendInvoiceEmail(env, pool, invoice);
          } catch (emailError) {
            // Log but don't fail invoice generation if email fails
            const logger = createLogger(env.ENVIRONMENT);
            logger.error('Failed to send invoice email', {
              organisationId: request.organisationId,
              invoiceId: invoice.id,
              error: emailError instanceof Error ? emailError.message : String(emailError),
            });
          }
        }

        return { id: invoice.id, result: invoice };
      });
    }
  );
}

/**
 * Finalize invoice (mark as immutable)
 * 
 * Once finalized, invoice cannot be modified (enforced by database triggers).
 * Also generates PDF if PDF generation is configured.
 */
export async function finalizeInvoice(
  pool: pg.Pool,
  invoiceId: string,
  env?: Env,
  userId?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<Invoice> {
  return await transaction(pool, async (client) => {
    const result = await client.query<Invoice>(
      `UPDATE invoices
       SET status = 'finalized', finalized_at = NOW()
       WHERE id = $1 AND status = 'draft'
       RETURNING id, organisation_id, invoice_number, status,
                 subtotal, tax_amount, discount_amount, total,
                 currency, billing_period_start, billing_period_end, due_date,
                 month, year, issued_at, paid_at, finalized_at, created_at, updated_at`,
      [invoiceId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError(
        'Invoice not found or not in draft status'
      );
    }

    const invoiceRow = result.rows[0];
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
    };

    // Create audit log
    await createAuditLog(pool, {
      organisationId: invoice.organisationId,
      entityType: 'invoice',
      entityId: invoice.id,
      action: 'finalized',
      userId,
      ipAddress,
      userAgent,
    });

    // Generate PDF asynchronously (non-blocking)
    if (env && env.INVOICE_PDFS_R2) {
      // Don't await - let it generate in background
      generateInvoicePdfForInvoice(env, pool, invoiceId).catch((error) => {
        const logger = createLogger(env.ENVIRONMENT);
        logger.error('Failed to generate PDF after invoice finalization', {
          invoiceId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return invoice;
  });
}
