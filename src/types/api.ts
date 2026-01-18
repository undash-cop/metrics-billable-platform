import { z } from 'zod';

/**
 * Admin API Request/Response Schemas
 * 
 * All schemas use Zod for validation and type safety.
 */

// ============================================================================
// ORGANISATION APIs
// ============================================================================

export const CreateOrganisationRequestSchema = z.object({
  name: z.string().min(1).max(255),
  razorpayCustomerId: z.string().optional(),
  billingEmail: z.string().email().optional(),
  taxId: z.string().optional(),
  currency: z.string().length(3).optional(), // ISO 4217 currency code (e.g., INR, USD, EUR)
});

export type CreateOrganisationRequest = z.infer<typeof CreateOrganisationRequestSchema>;

export const OrganisationResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  razorpayCustomerId: z.string().nullable(),
  billingEmail: z.string().nullable(),
  taxId: z.string().nullable(),
  currency: z.string().length(3).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type OrganisationResponse = z.infer<typeof OrganisationResponseSchema>;

// ============================================================================
// PROJECT APIs
// ============================================================================

export const CreateProjectRequestSchema = z.object({
  organisationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const ProjectResponseSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  apiKey: z.string(), // Only returned on creation
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;

export const ProjectListResponseSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;

export const GenerateApiKeyRequestSchema = z.object({
  projectId: z.string().uuid(),
});

export type GenerateApiKeyRequest = z.infer<typeof GenerateApiKeyRequestSchema>;

export const GenerateApiKeyResponseSchema = z.object({
  projectId: z.string().uuid(),
  apiKey: z.string(),
  message: z.string(),
});

export type GenerateApiKeyResponse = z.infer<typeof GenerateApiKeyResponseSchema>;

// ============================================================================
// USAGE SUMMARY APIs
// ============================================================================

export const UsageSummaryQuerySchema = z.object({
  organisationId: z.string().uuid(),
  startMonth: z.number().int().min(1).max(12).optional(),
  startYear: z.number().int().min(2020).optional(),
  endMonth: z.number().int().min(1).max(12).optional(),
  endYear: z.number().int().min(2020).optional(),
  projectId: z.string().uuid().optional(),
  metricName: z.string().optional(),
});

export type UsageSummaryQuery = z.infer<typeof UsageSummaryQuerySchema>;

export const UsageSummaryResponseSchema = z.object({
  organisationId: z.string().uuid(),
  organisationName: z.string(),
  period: z.object({
    start: z.object({
      month: z.number().int(),
      year: z.number().int(),
    }),
    end: z.object({
      month: z.number().int(),
      year: z.number().int(),
    }),
  }),
  metrics: z.array(
    z.object({
      metricName: z.string(),
      unit: z.string(),
      totalValue: z.number(),
      eventCount: z.number().optional(),
      projects: z.array(
        z.object({
          projectId: z.string().uuid(),
          projectName: z.string(),
          value: z.number(),
        })
      ),
    })
  ),
  totalProjects: z.number().int(),
  totalMetrics: z.number().int(),
});

export type UsageSummaryResponse = z.infer<typeof UsageSummaryResponseSchema>;

// ============================================================================
// INVOICE APIs (Read-Only)
// ============================================================================

export const InvoiceListQuerySchema = z.object({
  organisationId: z.string().uuid(),
  status: z.enum(['draft', 'finalized', 'sent', 'paid', 'overdue', 'cancelled']).optional(),
  startMonth: z.number().int().min(1).max(12).optional(),
  startYear: z.number().int().min(2020).optional(),
  endMonth: z.number().int().min(1).max(12).optional(),
  endYear: z.number().int().min(2020).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;

export const InvoiceResponseSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),
  invoiceNumber: z.string(),
  status: z.enum(['draft', 'finalized', 'sent', 'paid', 'overdue', 'cancelled']),
  subtotal: z.string(),
  tax: z.string(),
  total: z.string(),
  currency: z.string(),
  month: z.number().int(),
  year: z.number().int(),
  billingPeriodStart: z.string().date().nullable(),
  billingPeriodEnd: z.string().date().nullable(),
  dueDate: z.string().date(),
  issuedAt: z.string().datetime().nullable(),
  paidAt: z.string().datetime().nullable(),
  finalizedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type InvoiceResponse = z.infer<typeof InvoiceResponseSchema>;

export const InvoiceListResponseSchema = z.object({
  invoices: z.array(InvoiceResponseSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export type InvoiceListResponse = z.infer<typeof InvoiceListResponseSchema>;

export const InvoiceDetailResponseSchema = InvoiceResponseSchema.extend({
  lineItems: z.array(
    z.object({
      id: z.string().uuid(),
      lineNumber: z.number().int(),
      projectId: z.string().uuid().nullable(),
      projectName: z.string().nullable(),
      metricName: z.string(),
      description: z.string().nullable(),
      quantity: z.string(),
      unit: z.string(),
      unitPrice: z.string(),
      total: z.string(),
      currency: z.string(),
    })
  ),
});

export type InvoiceDetailResponse = z.infer<typeof InvoiceDetailResponseSchema>;

// ============================================================================
// PAYMENT APIs (Read-Only)
// ============================================================================

export const PaymentListQuerySchema = z.object({
  organisationId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  status: z.enum(['pending', 'authorized', 'captured', 'failed', 'refunded']).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type PaymentListQuery = z.infer<typeof PaymentListQuerySchema>;

export const PaymentResponseSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string().nullable(),
  paymentNumber: z.string(),
  razorpayOrderId: z.string().nullable(),
  razorpayPaymentId: z.string().nullable(),
  amount: z.string(),
  currency: z.string(),
  status: z.enum(['pending', 'authorized', 'captured', 'failed', 'refunded']),
  paymentMethod: z.string().nullable(),
  paidAt: z.string().datetime().nullable(),
  reconciledAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PaymentResponse = z.infer<typeof PaymentResponseSchema>;

export const PaymentListResponseSchema = z.object({
  payments: z.array(PaymentResponseSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export type PaymentListResponse = z.infer<typeof PaymentListResponseSchema>;

// ============================================================================
// ERROR RESPONSES
// ============================================================================

export const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
  statusCode: z.number().int(),
  details: z.record(z.unknown()).optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
