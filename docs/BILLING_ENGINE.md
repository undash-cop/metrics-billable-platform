# Billing Engine Design

## Overview

The billing engine converts usage aggregates into invoices using config-driven pricing rules. It separates calculation logic from persistence for testability and maintainability.

## Architecture

### Separation of Concerns

```
┌─────────────────────────────────────────────────────────┐
│  Invoice Generator (invoice-generator.ts)              │
│  - Fetches data from database                          │
│  - Orchestrates calculation and persistence           │
│  - Handles transactions and audit logging             │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Billing Calculator (billing-calculator.ts)            │
│  - Pure calculation functions                          │
│  - No database access                                  │
│  - No side effects                                     │
│  - Fully testable                                      │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
Usage Aggregates → Pricing Rules → Billing Calculator → Calculated Invoice → Persistence
```

## Data Structures

### Pricing Rules

```typescript
interface PricingRule {
  id: string;
  organisationId?: string; // NULL = global, UUID = org-specific
  metricName: string;
  unit: string;
  pricePerUnit: string; // Decimal as string
  currency: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
  isActive: boolean;
  metadata?: Record<string, unknown>; // For future extensions
}
```

**Key Features**:
- **Organisation-specific rules**: Override global rules per organisation
- **Effective date ranges**: Support pricing changes over time
- **Per-metric pricing**: Each metric/unit combination has its own price

### Minimum Charge Rules

```typescript
interface MinimumChargeRule {
  id: string;
  organisationId?: string; // NULL = global, UUID = org-specific
  minimumAmount: string; // Decimal as string
  currency: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
  isActive: boolean;
  description?: string;
}
```

**Key Features**:
- **Organisation-specific minimums**: Different minimums per organisation
- **Effective date ranges**: Support minimum charge changes
- **Applied after subtotal**: Ensures minimum revenue

### Billing Configuration

```typescript
interface BillingConfig {
  organisationId: string;
  taxRate: string; // Decimal as string, e.g., '0.18' for 18%
  currency: string;
  billingCycle: 'monthly' | 'yearly';
  paymentTerms: number; // Days, e.g., 30 for Net 30
  minimumChargeEnabled: boolean;
  minimumChargeAmount?: string; // Decimal as string
}
```

**Key Features**:
- **Per-organisation config**: Each organisation has its own billing settings
- **Tax rate**: Configurable tax rate (e.g., GST in India)
- **Payment terms**: Configurable payment terms (e.g., Net 30)

### Calculated Invoice

```typescript
interface CalculatedInvoice {
  organisationId: string;
  month: number;
  year: number;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  dueDate: Date;
  currency: string;
  lineItems: CalculatedLineItem[];
  subtotal: Decimal;
  minimumCharge: Decimal; // Applied minimum charge
  subtotalAfterMinimum: Decimal;
  taxRate: Decimal;
  taxAmount: Decimal;
  discountAmount: Decimal; // For future use
  total: Decimal;
}
```

## Calculation Logic

### Step 1: Calculate Line Items

For each usage aggregate:
1. Find applicable pricing rule (org-specific > global)
2. Calculate: `quantity × unitPrice = total`
3. Create line item

### Step 2: Calculate Subtotal

Sum all line item totals:
```
subtotal = Σ(lineItem.total)
```

### Step 3: Apply Minimum Charge

If enabled and subtotal < minimum:
```
minimumChargeApplied = minimumCharge - subtotal
subtotalAfterMinimum = minimumCharge
```

Add minimum charge as a line item if applied.

### Step 4: Calculate Tax

```
taxAmount = subtotalAfterMinimum × taxRate
```

### Step 5: Calculate Total

```
total = subtotalAfterMinimum + taxAmount - discountAmount
```

## Invoice Generation Flow

### 1. Fetch Data

```typescript
const [aggregates, pricingRules, minimumChargeRules, billingConfig] = 
  await Promise.all([
    fetchUsageAggregates(organisationId, month, year),
    fetchPricingRules(billingDate),
    fetchMinimumChargeRules(billingDate),
    fetchBillingConfig(organisationId),
  ]);
```

### 2. Calculate Invoice

```typescript
const calculatedInvoice = calculateInvoice(
  aggregates,
  pricingRules,
  minimumChargeRules,
  billingConfig,
  month,
  year
);
```

This is a **pure function** - no side effects, fully testable.

### 3. Persist Invoice

```typescript
const invoice = await persistInvoice(calculatedInvoice, invoiceNumber);
```

### 4. Create Audit Log

Log invoice creation for auditability.

## Pricing Rule Priority

1. **Organisation-specific rule**: Highest priority
2. **Global rule**: Fallback if no org-specific rule
3. **Most recent rule**: If multiple rules match, use most recent

## Minimum Charge Logic

### When Applied

- Only if `minimumChargeEnabled` is true
- Only if subtotal < minimum charge amount
- Applied after calculating usage-based charges

### How Applied

1. Calculate subtotal from usage
2. Compare with minimum charge
3. If subtotal < minimum:
   - Add minimum charge line item
   - Set subtotalAfterMinimum = minimum charge
4. Calculate tax on adjusted subtotal

### Example

```
Usage charges: ₹500
Minimum charge: ₹1000
Applied minimum: ₹500 (₹1000 - ₹500)
Subtotal after minimum: ₹1000
Tax (18%): ₹180
Total: ₹1180
```

## Invoice Immutability

### States

1. **draft**: Can be modified
2. **finalized**: Immutable (enforced by database triggers)
3. **sent**: Sent to customer
4. **paid**: Payment received
5. **cancelled**: Cancelled invoice

### Finalization

```typescript
await finalizeInvoice(invoiceId);
```

Once finalized:
- Invoice cannot be modified (database triggers prevent)
- Line items cannot be modified
- Only status can change to 'paid', 'cancelled', or 'void'

## Monthly Billing Cycle

### Billing Period

- **Start**: First day of month (00:00:00)
- **End**: Last day of month (23:59:59)
- **Due Date**: End date + payment terms days

### Invoice Generation

Run monthly cron job:
1. Fetch usage aggregates for previous month
2. Generate invoice for each organisation
3. Finalize invoices
4. Send invoices to customers

## Testing

### Unit Tests (Billing Calculator)

Test pure calculation functions:
- Line item calculation
- Subtotal calculation
- Minimum charge application
- Tax calculation
- Total calculation

### Integration Tests (Invoice Generator)

Test end-to-end flow:
- Fetch data from database
- Calculate invoice
- Persist invoice
- Verify immutability

## Example Usage

### Generate Invoice

```typescript
const invoice = await generateInvoice(pool, {
  organisationId: 'org-123',
  month: 1,
  year: 2024,
});
```

### Finalize Invoice

```typescript
const finalizedInvoice = await finalizeInvoice(pool, invoice.id);
```

### Query Invoice

```typescript
const invoice = await getInvoiceById(pool, invoiceId);
const lineItems = await getInvoiceLineItems(pool, invoiceId);
```

## Configuration Examples

### Global Pricing Rule

```sql
INSERT INTO pricing_plans (
  metric_name, unit, price_per_unit, currency, effective_from
) VALUES (
  'api_calls', 'count', 0.001, 'INR', '2024-01-01'
);
```

### Organisation-Specific Pricing Rule

```sql
INSERT INTO pricing_plans (
  organisation_id, metric_name, unit, price_per_unit, currency, effective_from
) VALUES (
  'org-123', 'api_calls', 'count', 0.0005, 'INR', '2024-01-01'
);
```

### Minimum Charge Rule

```sql
INSERT INTO minimum_charge_rules (
  organisation_id, minimum_amount, currency, effective_from, description
) VALUES (
  'org-123', 1000.00, 'INR', '2024-01-01', 'Minimum Monthly Charge'
);
```

### Billing Configuration

```sql
INSERT INTO billing_configs (
  organisation_id, tax_rate, currency, payment_terms, minimum_charge_enabled
) VALUES (
  'org-123', 0.18, 'INR', 30, true
);
```

## Future Enhancements

1. **Tiered Pricing**: Volume-based discounts
2. **Promotional Pricing**: Time-limited discounts
3. **Credit System**: Apply credits to invoices
4. **Multi-Currency**: Support multiple currencies
5. **Proration**: Handle partial month billing
6. **Recurring Charges**: Fixed monthly fees
