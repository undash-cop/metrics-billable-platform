import Decimal from 'decimal.js';
import {
  CalculatedInvoice,
  CalculatedLineItem,
  PricingRule,
  MinimumChargeRule,
  BillingConfig,
  PricingRuleLookup,
} from '../types/pricing.js';
import { UsageAggregate } from '../types/domain.js';
import { multiply, add, subtract, max, toDecimal } from '../utils/decimal.js';

/**
 * Billing Calculator Service
 * 
 * Pure calculation logic - no database access, no side effects.
 * Separates billing calculation from persistence for testability and clarity.
 * 
 * Responsibilities:
 * - Calculate line items from usage aggregates
 * - Apply pricing rules
 * - Calculate minimum charges
 * - Calculate taxes and totals
 * - Generate invoice calculations
 */

/**
 * Calculate price for a usage aggregate using pricing rule
 */
export function calculateLineItemPrice(
  aggregate: UsageAggregate,
  pricingRule: PricingRule
): CalculatedLineItem {
  const quantity = toDecimal(aggregate.totalValue);
  const unitPrice = toDecimal(pricingRule.pricePerUnit);
  const total = multiply(quantity, unitPrice);

  return {
    projectId: aggregate.projectId,
    metricName: aggregate.metricName,
    description: `${aggregate.metricName} (${aggregate.unit})`,
    quantity,
    unit: aggregate.unit,
    unitPrice,
    total,
    currency: pricingRule.currency,
    pricingRuleId: pricingRule.id,
    usageAggregateId: aggregate.id,
  };
}

/**
 * Find applicable pricing rule for a metric
 * 
 * Priority:
 * 1. Organisation-specific rule (if organisationId provided)
 * 2. Global rule (organisationId is null)
 * 
 * Returns null if no rule found.
 */
export function findApplicablePricingRule(
  rules: PricingRule[],
  metricName: string,
  unit: string,
  organisationId: string | null,
  date: Date
): PricingRule | null {
  // Filter active rules for this metric/unit
  const applicableRules = rules.filter((rule) => {
    if (!rule.isActive) return false;
    if (rule.metricName !== metricName) return false;
    if (rule.unit !== unit) return false;
    if (rule.effectiveFrom > date) return false;
    if (rule.effectiveTo && rule.effectiveTo < date) return false;
    return true;
  });

  if (applicableRules.length === 0) {
    return null;
  }

  // Prefer organisation-specific rule over global rule
  const orgSpecificRule = applicableRules.find(
    (rule) => rule.organisationId === organisationId
  );
  if (orgSpecificRule) {
    return orgSpecificRule;
  }

  // Fall back to global rule (organisationId is null)
  const globalRule = applicableRules.find(
    (rule) => rule.organisationId === null || rule.organisationId === undefined
  );
  if (globalRule) {
    return globalRule;
  }

  // If no match, return the most recent rule (by effectiveFrom)
  return applicableRules.sort(
    (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
  )[0];
}

/**
 * Calculate all line items from usage aggregates
 */
export function calculateLineItems(
  aggregates: UsageAggregate[],
  pricingRules: PricingRule[],
  organisationId: string,
  billingDate: Date
): CalculatedLineItem[] {
  const lineItems: CalculatedLineItem[] = [];

  for (const aggregate of aggregates) {
    const pricingRule = findApplicablePricingRule(
      pricingRules,
      aggregate.metricName,
      aggregate.unit,
      organisationId,
      billingDate
    );

    if (!pricingRule) {
      // Skip aggregates without pricing rules
      // In production, you might want to log this or raise an error
      continue;
    }

    const lineItem = calculateLineItemPrice(aggregate, pricingRule);
    lineItems.push(lineItem);
  }

  return lineItems;
}

/**
 * Calculate subtotal from line items
 */
export function calculateSubtotal(lineItems: CalculatedLineItem[]): Decimal {
  return lineItems.reduce(
    (sum, item) => add(sum, item.total),
    new Decimal(0)
  );
}

/**
 * Find applicable minimum charge rule
 */
export function findApplicableMinimumChargeRule(
  rules: MinimumChargeRule[],
  organisationId: string,
  date: Date
): MinimumChargeRule | null {
  const applicableRules = rules.filter((rule) => {
    if (!rule.isActive) return false;
    if (rule.effectiveFrom > date) return false;
    if (rule.effectiveTo && rule.effectiveTo < date) return false;
    return true;
  });

  if (applicableRules.length === 0) {
    return null;
  }

  // Prefer organisation-specific rule
  const orgSpecificRule = applicableRules.find(
    (rule) => rule.organisationId === organisationId
  );
  if (orgSpecificRule) {
    return orgSpecificRule;
  }

  // Fall back to global rule
  const globalRule = applicableRules.find(
    (rule) => rule.organisationId === null || rule.organisationId === undefined
  );
  if (globalRule) {
    return globalRule;
  }

  return null;
}

/**
 * Apply minimum charge to subtotal
 * 
 * If subtotal is less than minimum charge, returns the minimum charge.
 * Otherwise, returns the subtotal unchanged.
 */
export function applyMinimumCharge(
  subtotal: Decimal,
  minimumCharge: Decimal
): { subtotalAfterMinimum: Decimal; minimumChargeApplied: Decimal } {
  if (subtotal.gte(minimumCharge)) {
    // Subtotal meets or exceeds minimum, no adjustment needed
    return {
      subtotalAfterMinimum: subtotal,
      minimumChargeApplied: new Decimal(0),
    };
  }

  // Subtotal is below minimum, apply minimum charge
  const minimumChargeApplied = subtract(minimumCharge, subtotal);
  return {
    subtotalAfterMinimum: minimumCharge,
    minimumChargeApplied,
  };
}

/**
 * Calculate tax amount
 */
export function calculateTax(
  subtotal: Decimal,
  taxRate: Decimal
): Decimal {
  return multiply(subtotal, taxRate);
}

/**
 * Calculate total invoice amount
 */
export function calculateTotal(
  subtotal: Decimal,
  taxAmount: Decimal,
  discountAmount: Decimal = new Decimal(0)
): Decimal {
  return subtract(add(subtotal, taxAmount), discountAmount);
}

/**
 * Calculate billing period dates for a month
 */
export function calculateBillingPeriod(
  month: number,
  year: number
): { start: Date; end: Date } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999); // Last moment of the month
  return { start, end };
}

/**
 * Calculate due date based on billing config
 */
export function calculateDueDate(
  billingPeriodEnd: Date,
  paymentTermsDays: number
): Date {
  const dueDate = new Date(billingPeriodEnd);
  dueDate.setDate(dueDate.getDate() + paymentTermsDays);
  return dueDate;
}

/**
 * Main billing calculation function
 * 
 * Pure function that calculates invoice from usage aggregates and pricing rules.
 * No database access, no side effects.
 */
export function calculateInvoice(
  aggregates: UsageAggregate[],
  pricingRules: PricingRule[],
  minimumChargeRules: MinimumChargeRule[],
  billingConfig: BillingConfig,
  month: number,
  year: number
): CalculatedInvoice {
  // Calculate billing period
  const { start: billingPeriodStart, end: billingPeriodEnd } =
    calculateBillingPeriod(month, year);

  // Calculate line items from usage aggregates
  const lineItems = calculateLineItems(
    aggregates,
    pricingRules,
    billingConfig.organisationId,
    billingPeriodStart
  );

  if (lineItems.length === 0) {
    throw new Error('No billable line items found');
  }

  // Calculate subtotal
  const subtotal = calculateSubtotal(lineItems);

  // Apply minimum charge if enabled
  let minimumChargeApplied = new Decimal(0);
  let subtotalAfterMinimum = subtotal;

  if (billingConfig.minimumChargeEnabled) {
    const minimumChargeRule = findApplicableMinimumChargeRule(
      minimumChargeRules,
      billingConfig.organisationId,
      billingPeriodStart
    );

    if (minimumChargeRule) {
      const minimumCharge = toDecimal(minimumChargeRule.minimumAmount);
      const result = applyMinimumCharge(subtotal, minimumCharge);
      subtotalAfterMinimum = result.subtotalAfterMinimum;
      minimumChargeApplied = result.minimumChargeApplied;

      // If minimum charge was applied, add it as a line item
      if (minimumChargeApplied.gt(0)) {
        lineItems.push({
          projectId: '', // No specific project for minimum charge
          metricName: 'minimum_charge',
          description: minimumChargeRule.description || 'Minimum Monthly Charge',
          quantity: new Decimal(1),
          unit: 'charge',
          unitPrice: minimumChargeApplied,
          total: minimumChargeApplied,
          currency: minimumChargeRule.currency,
        });
      }
    } else if (billingConfig.minimumChargeAmount) {
      // Use config-level minimum charge if no rule found
      const minimumCharge = toDecimal(billingConfig.minimumChargeAmount);
      const result = applyMinimumCharge(subtotal, minimumCharge);
      subtotalAfterMinimum = result.subtotalAfterMinimum;
      minimumChargeApplied = result.minimumChargeApplied;

      if (minimumChargeApplied.gt(0)) {
        lineItems.push({
          projectId: '',
          metricName: 'minimum_charge',
          description: 'Minimum Monthly Charge',
          quantity: new Decimal(1),
          unit: 'charge',
          unitPrice: minimumChargeApplied,
          total: minimumChargeApplied,
          currency: billingConfig.currency,
        });
      }
    }
  }

  // Calculate tax
  const taxRate = toDecimal(billingConfig.taxRate);
  const taxAmount = calculateTax(subtotalAfterMinimum, taxRate);

  // Calculate total
  const total = calculateTotal(subtotalAfterMinimum, taxAmount);

  // Calculate due date
  const dueDate = calculateDueDate(
    billingPeriodEnd,
    billingConfig.paymentTerms
  );

  return {
    organisationId: billingConfig.organisationId,
    month,
    year,
    billingPeriodStart,
    billingPeriodEnd,
    dueDate,
    currency: billingConfig.currency,
    lineItems,
    subtotal,
    minimumCharge: minimumChargeApplied,
    subtotalAfterMinimum,
    taxRate,
    taxAmount,
    discountAmount: new Decimal(0), // For future use
    total,
  };
}
