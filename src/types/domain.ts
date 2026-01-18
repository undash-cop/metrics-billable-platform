import { z } from 'zod';
import Decimal from 'decimal.js';

/**
 * Core domain types for the billing platform.
 * All monetary values use Decimal.js for precision.
 */

// Organisation
export const OrganisationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  razorpayCustomerId: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Organisation = z.infer<typeof OrganisationSchema>;

// Project
export const ProjectSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  apiKey: z.string().min(32).max(64), // For authentication
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Project = z.infer<typeof ProjectSchema>;

// Usage Event (stored in D1 for hot storage)
export const UsageEventSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organisationId: z.string().uuid(),
  metricName: z.string().min(1).max(100),
  metricValue: z.number().nonnegative(),
  unit: z.string().min(1).max(50),
  timestamp: z.date(),
  metadata: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(1).max(255), // For deduplication
  ingestedAt: z.date(),
});

export type UsageEvent = z.infer<typeof UsageEventSchema>;

// Usage Aggregate (monthly aggregation)
export const UsageAggregateSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),
  projectId: z.string().uuid(),
  metricName: z.string().min(1).max(100),
  unit: z.string().min(1).max(50),
  totalValue: z.number().nonnegative(),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UsageAggregate = z.infer<typeof UsageAggregateSchema>;

// Pricing Plan
export const PricingPlanSchema = z.object({
  id: z.string().uuid(),
  metricName: z.string().min(1).max(100),
  unit: z.string().min(1).max(50),
  pricePerUnit: z.string(), // Decimal as string for precision
  currency: z.string().length(3).default('INR'),
  effectiveFrom: z.date(),
  effectiveTo: z.date().optional(),
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PricingPlan = z.infer<typeof PricingPlanSchema>;

// Invoice (financial source of truth in RDS)
export const InvoiceSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),
  invoiceNumber: z.string().min(1).max(50), // Human-readable invoice number
  status: z.enum(['draft', 'pending', 'paid', 'overdue', 'cancelled']),
  subtotal: z.string(), // Decimal as string
  tax: z.string(), // Decimal as string
  total: z.string(), // Decimal as string
  currency: z.string().length(3).default('INR'),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
  dueDate: z.date(),
  issuedAt: z.date().optional(),
  paidAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Invoice = z.infer<typeof InvoiceSchema>;

// Invoice Line Item
export const InvoiceLineItemSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  projectId: z.string().uuid(),
  metricName: z.string().min(1).max(100),
  quantity: z.string(), // Decimal as string
  unit: z.string().min(1).max(50),
  unitPrice: z.string(), // Decimal as string
  total: z.string(), // Decimal as string
  currency: z.string().length(3).default('INR'),
  createdAt: z.date(),
});

export type InvoiceLineItem = z.infer<typeof InvoiceLineItemSchema>;

// Payment (financial source of truth in RDS)
export const PaymentSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  razorpayPaymentId: z.string(), // Razorpay payment ID
  razorpayOrderId: z.string().optional(), // Razorpay order ID
  amount: z.string(), // Decimal as string
  currency: z.string().length(3).default('INR'),
  status: z.enum(['pending', 'authorized', 'captured', 'failed', 'refunded']),
  paymentMethod: z.string().optional(),
  paidAt: z.date().optional(),
  reconciledAt: z.date().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Payment = z.infer<typeof PaymentSchema>;

// Audit Log (for financial auditability)
export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid().optional(),
  entityType: z.string().min(1).max(100), // e.g., 'invoice', 'payment'
  entityId: z.string().uuid(),
  action: z.string().min(1).max(100), // e.g., 'created', 'updated', 'paid'
  userId: z.string().optional(),
  changes: z.record(z.unknown()).optional(), // Before/after state
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  createdAt: z.date(),
});

export type AuditLog = z.infer<typeof AuditLogSchema>;

// Helper type for monetary calculations
export type Money = {
  amount: Decimal;
  currency: string;
};

// Helper type for idempotency
export type IdempotencyRecord = {
  idempotencyKey: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
};
