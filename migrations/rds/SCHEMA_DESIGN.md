# PostgreSQL Schema Design - Multi-Tenant Usage-Based Billing

## Overview

This schema implements a financial-grade, multi-tenant usage-based billing system with strict requirements for idempotency, immutability, and auditability.

## Design Principles

1. **Financial Integrity**: All monetary values use `NUMERIC` type with appropriate precision
2. **Immutability**: Finalized invoices cannot be modified (enforced via triggers)
3. **Idempotency**: All operations support idempotency keys
4. **Auditability**: Complete audit trail for all financial operations
5. **Multi-Tenancy**: Organisation-level isolation with soft deletes

## Table Justifications

### Core Tenant Tables

#### `organisations`
**Purpose**: Root tenant entity for multi-tenancy
- **Soft Deletes**: `deleted_at` preserves audit trail while hiding deleted orgs
- **Slug**: URL-friendly unique identifier
- **Razorpay Integration**: Stores customer ID for payment gateway
- **Indexes**: Optimized for active organisation queries

#### `projects`
**Purpose**: Multiple projects per organisation
- **API Key Security**: Stores hash, never plaintext
- **Organisation Isolation**: Unique slug per organisation
- **Soft Deletes**: Preserves audit trail
- **Indexes**: Fast lookup by API key hash and organisation

### Pricing Tables

#### `pricing_plans`
**Purpose**: Flexible pricing with future support
- **Effective Date Ranges**: Supports pricing changes over time
- **Exclusion Constraint**: Prevents overlapping active plans for same metric/unit
- **Metadata**: Supports complex pricing (tiers, volume discounts)
- **Billing Periods**: Monthly, yearly, one-time support
- **Indexes**: Optimized for pricing lookups by metric and date

### Usage Event Tables

#### `usage_events`
**Purpose**: Idempotent event storage
- **Idempotency**: Unique constraint on `idempotency_key` prevents duplicates
- **Processing Status**: `processed_at` tracks aggregation status
- **Indexes**: Optimized for time-range queries and aggregation
- **Metadata**: Flexible JSONB for event context

#### `usage_aggregates`
**Purpose**: Monthly aggregations for billing
- **Unique Constraint**: One aggregate per org/project/metric/month/year
- **Event Count**: Validation field to ensure aggregation correctness
- **Indexes**: Optimized for invoice generation queries
- **Precision**: NUMERIC(20,8) for high-precision usage values

### Invoice Tables (Immutable After Finalization)

#### `invoices`
**Purpose**: Immutable invoices after finalization
- **Immutability**: Trigger prevents changes to finalized invoices
- **Status Flow**: draft → finalized → sent → paid
- **Financial Validation**: CHECK constraints ensure total = subtotal + tax - discount
- **Finalization Timestamp**: `finalized_at` marks immutability point
- **Indexes**: Optimized for status queries and due date tracking

**Immutability Enforcement**:
- Trigger `prevent_finalized_invoice_updates()` blocks:
  - Changes to financial fields (subtotal, tax, total, discount)
  - Changes to billing period
  - Status changes except to 'paid', 'cancelled', 'void'

#### `invoice_line_items`
**Purpose**: Detailed invoice line items
- **Immutability**: Trigger prevents changes once parent invoice is finalized
- **Line Numbers**: Ensures consistent ordering
- **Validation**: CHECK ensures total ≈ quantity × unit_price
- **Metadata**: Links to usage aggregates and pricing plans for auditability

### Payment Tables (Fully Auditable)

#### `payments`
**Purpose**: Fully auditable payment records
- **Reconciliation**: `reconciled_at` tracks webhook verification
- **Complete Audit Trail**: Metadata stores full gateway response
- **Refund Support**: Tracks partial and full refunds
- **Status Tracking**: Multiple statuses for payment lifecycle
- **Indexes**: Optimized for reconciliation and status queries

#### `payment_allocations`
**Purpose**: Payment-to-invoice allocation tracking
- **Partial Payments**: Supports splitting payments across invoices
- **Credits**: Can allocate credits to future invoices
- **Audit Trail**: Complete record of payment allocations

### Idempotency Table

#### `idempotency_keys`
**Purpose**: System-wide idempotency tracking
- **Unique Constraint**: Prevents duplicate operations
- **Request Hash**: Validates request consistency (detects request changes)
- **Response Caching**: Stores response for idempotent retries
- **Expiration**: Automatic cleanup of old keys
- **Indexes**: Fast lookup by key and entity

### Audit Tables

#### `audit_logs`
**Purpose**: Complete audit trail for compliance
- **Immutable**: No UPDATE/DELETE allowed (application-level enforcement)
- **Complete Context**: Tracks who, what, when, why, where
- **Request Tracing**: `request_id` for distributed tracing
- **Changes Tracking**: JSONB stores before/after state
- **Indexes**: Optimized for entity queries and time-range searches

## Key Constraints

### Idempotency
- `usage_events.idempotency_key` UNIQUE constraint
- `idempotency_keys.idempotency_key` UNIQUE constraint
- Application logic checks idempotency keys before processing

### Immutability
- Triggers prevent updates to finalized invoices
- Triggers prevent updates/deletes to line items of finalized invoices
- Only status changes to 'paid', 'cancelled', 'void' allowed after finalization

### Financial Integrity
- CHECK constraints validate monetary calculations
- NUMERIC types prevent floating-point errors
- Foreign keys ensure referential integrity
- Transactions ensure atomicity

### Multi-Tenancy
- Organisation-level foreign keys on all tenant data
- Soft deletes preserve audit trail
- Indexes filter by `deleted_at IS NULL` for active records

## Index Strategy

### High-Frequency Queries
- Organisation/project lookups
- Invoice status queries
- Payment reconciliation queries
- Usage event time-range queries

### Partial Indexes
- Active records only (`WHERE deleted_at IS NULL`)
- Unprocessed events (`WHERE processed_at IS NULL`)
- Unreconciled payments (`WHERE reconciled_at IS NULL`)

### Composite Indexes
- Organisation + project + metric + time for aggregation
- Entity type + entity ID for audit log queries
- Year + month for invoice generation

## Views

### `invoice_summary`
Aggregates invoice data with payment totals for reporting.

### `organisation_usage_summary`
Monthly usage summary per organisation for analytics.

## Migration Notes

1. Run migrations in order
2. Create indexes after table creation for faster initial load
3. Test triggers with sample data
4. Verify constraints with edge cases
5. Monitor query performance and adjust indexes

## Security Considerations

1. **API Keys**: Never stored in plaintext, only hashes
2. **Soft Deletes**: Preserve audit trail without exposing deleted data
3. **Immutability**: Prevents tampering with finalized invoices
4. **Audit Logs**: Immutable record of all changes
5. **Foreign Keys**: Ensure referential integrity

## Performance Considerations

1. **Partial Indexes**: Reduce index size for active records
2. **Composite Indexes**: Optimize common query patterns
3. **JSONB**: Efficient storage and querying of flexible data
4. **Partitioning**: Consider partitioning `usage_events` and `audit_logs` by time
5. **Archival**: Archive old audit logs and usage events

## Future Enhancements

1. **Table Partitioning**: Partition large tables by time
2. **Materialized Views**: Pre-aggregate common queries
3. **Full-Text Search**: Add GIN indexes for JSONB metadata searches
4. **Time-Series Optimization**: Consider TimescaleDB for usage events
5. **Read Replicas**: Separate read/write workloads
