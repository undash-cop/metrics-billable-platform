import { z } from 'zod';
import Decimal from 'decimal.js';

/**
 * Pricing Rule Data Structures
 * 
 * Config-driven pricing rules that support:
 * - Per-metric pricing
 * - Minimum monthly charges
 * - Tiered pricing (future)
 * - Volume discounts (future)
 */

// Base pricing rule
export const PricingRuleSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid().optional(), // NULL = global rule, UUID = org-specific
  metricName: z.string().min(1).max(100),
  unit: z.string().min(1).max(50),
  pricePerUnit: z.string(), // Decimal as string
  currency: z.string().length(3).default('INR'),
  effectiveFrom: z.date(),
  effectiveTo: z.date().optional(),
  isActive: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(), // For complex pricing rules
});

export type PricingRule = z.infer<typeof PricingRuleSchema>;

// Minimum monthly charge rule
export const MinimumChargeRuleSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid().optional(), // NULL = global rule, UUID = org-specific
  minimumAmount: z.string(), // Decimal as string
  currency: z.string().length(3).default('INR'),
  effectiveFrom: z.date(),
  effectiveTo: z.date().optional(),
  isActive: z.boolean().default(true),
  description: z.string().optional(),
});

export type MinimumChargeRule = z.infer<typeof MinimumChargeRuleSchema>;

// Billing configuration for an organisation
export const BillingConfigSchema = z.object({
  organisationId: z.string().uuid(),
  taxRate: z.string(), // Decimal as string, e.g., '0.18' for 18% GST
  currency: z.string().length(3).default('INR'),
  billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  paymentTerms: z.number().int().positive().default(30), // Days
  minimumChargeEnabled: z.boolean().default(false),
  minimumChargeAmount: z.string().optional(), // Decimal as string
});

export type BillingConfig = z.infer<typeof BillingConfigSchema>;

// Calculated line item (before persistence)
export interface CalculatedLineItem {
  projectId: string;
  metricName: string;
  description: string;
  quantity: Decimal;
  unit: string;
  unitPrice: Decimal;
  total: Decimal;
  currency: string;
  pricingRuleId?: string; // Reference to pricing rule used
  usageAggregateId?: string; // Reference to usage aggregate
}

// Calculated invoice (before persistence)
export interface CalculatedInvoice {
  organisationId: string;
  month: number;
  year: number;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  dueDate: Date;
  currency: string;
  lineItems: CalculatedLineItem[];
  subtotal: Decimal;
  minimumCharge: Decimal; // Applied minimum charge (if any)
  subtotalAfterMinimum: Decimal; // Subtotal after minimum charge applied
  taxRate: Decimal;
  taxAmount: Decimal;
  discountAmount: Decimal; // For future use
  total: Decimal;
}

// Pricing rule lookup result
export interface PricingRuleLookup {
  rule: PricingRule;
  pricePerUnit: Decimal;
}
