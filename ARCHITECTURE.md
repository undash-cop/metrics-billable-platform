# Architecture Overview

## System Design

This is a metrics-based billing platform built for financial-grade operations with multi-tenant support.

### Data Flow

```
Usage Events (D1) -> Aggregation (Queue) -> Usage Aggregates (RDS) -> Invoice Generation -> Payment (Razorpay)
```

### Components

1. **Cloudflare Workers** - API endpoints and event ingestion
2. **Cloudflare D1** - Hot event storage (high-throughput usage events)
3. **Cloudflare Queues** - Reliable event processing
4. **Amazon RDS (Postgres)** - Financial source of truth
5. **Razorpay** - Payment processing (India-first)

## Data Hierarchy

```
Organisation
  └── Project (with API key)
      └── Usage Events (D1)
          └── Usage Aggregates (RDS, monthly)
              └── Invoice (RDS)
                  └── Payment (Razorpay)
```

## Key Design Principles

### Financial-Grade Data Integrity

- All monetary calculations use `Decimal.js` (never floating point)
- Database constraints enforce data correctness
- Transactions ensure atomicity
- Audit logs for all financial operations

### Idempotency

- All operations support idempotency keys
- Prevents duplicate charges or payments
- Safe to retry failed operations

### Auditability

- Complete audit trail for all financial operations
- Tracks who, what, when, and why
- Required for financial compliance

### Multi-Tenant Isolation

- Organisation-level data segregation
- API key authentication per project
- Tenant-specific queries and operations

## API Endpoints

### Usage Ingestion

```
POST /api/v1/ingest
Authorization: Bearer <api_key>
Content-Type: application/json

{
  "metricName": "api_calls",
  "metricValue": 1000,
  "unit": "count",
  "timestamp": "2024-01-15T10:00:00Z",
  "metadata": {},
  "idempotencyKey": "optional-unique-key"
}
```

### Razorpay Webhook

```
POST /api/v1/webhooks/razorpay
X-Razorpay-Signature: <signature>
Content-Type: application/json

<Razorpay webhook payload>
```

## Database Schemas

### RDS (Financial Source of Truth)

- `organisations` - Tenant data
- `projects` - Projects per organisation
- `pricing_plans` - Metric pricing
- `usage_aggregates` - Monthly usage aggregations
- `invoices` - Generated invoices
- `invoice_line_items` - Invoice details
- `payments` - Payment records
- `idempotency_keys` - Idempotency tracking
- `audit_logs` - Audit trail

### D1 (Hot Event Storage)

- `usage_events` - Raw usage events (temporary storage)

## Invoice Generation Flow

1. Monthly cron job triggers invoice generation
2. Fetch usage aggregates for the month
3. Apply pricing plans to calculate line items
4. Calculate subtotal, tax, and total
5. Create invoice in 'draft' status
6. Issue invoice (status: 'pending')
7. Generate Razorpay order
8. Customer pays via Razorpay
9. Webhook updates payment status
10. Invoice marked as 'paid'

## Security Considerations

- API keys for project authentication
- Webhook signature verification
- SQL injection prevention (parameterized queries)
- HTTPS only
- Environment variable secrets

## Error Handling

- Explicit error types (`BillingError`, `ValidationError`, etc.)
- Structured error responses
- No silent failures
- Comprehensive logging

## Deployment

1. Set up Cloudflare D1 database
2. Set up Amazon RDS Postgres
3. Run RDS migrations: `npm run db:migrate:rds`
4. Run D1 migrations: `npm run db:migrate:d1`
5. Configure environment variables
6. Deploy Cloudflare Worker: `npm run deploy`

## Monitoring & Observability

- Cloudflare Workers analytics
- Database query monitoring
- Payment reconciliation logs
- Audit log queries for compliance
