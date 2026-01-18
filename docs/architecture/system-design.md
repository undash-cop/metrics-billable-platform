# System Design

Detailed system design for the Metrics Billing Platform.

## Architecture Principles

### Multi-Tenancy

- **Organisations** - Top-level tenant boundary
- **Projects** - Sub-tenant under organisation
- **Data Isolation** - All queries filtered by organisation/project ID
- **API Keys** - Scoped to projects

### Financial Integrity

- **Decimal Precision** - All money calculations use Decimal.js
- **Database Constraints** - Enforce data correctness
- **Transactions** - Atomic operations for financial data
- **Reconciliation** - Regular verification of data integrity

### Reliability

- **Idempotency** - All operations are idempotent
- **Queue-Based** - Reliable event processing
- **Retry Logic** - Exponential backoff for failures
- **Dead-Letter Queue** - Failed message handling

## Component Details

### Event Ingestion

- **High Throughput** - Designed for millions of events/day
- **Idempotent** - Client-provided event IDs prevent duplicates
- **Fast Response** - Returns 202 Accepted immediately
- **Async Processing** - Events processed asynchronously via queue

### Data Storage

- **D1** - Hot event storage (7-day retention)
- **RDS** - Financial source of truth (permanent storage)
- **Migration** - Automatic D1 to RDS migration every 5 minutes

### Invoice Generation

- **Monthly Cycle** - Generates invoices monthly
- **Configurable Pricing** - Flexible pricing rules
- **Minimum Charges** - Support for minimum monthly charges
- **Immutable** - Invoices cannot be modified once finalized

### Payment Processing

- **Razorpay Integration** - India-first payment gateway
- **Webhook-Based** - Real-time payment status updates
- **Reconciliation** - Daily payment reconciliation
- **Idempotent** - Safe to retry webhooks

## See Also

- [Architecture Overview](./index)
- [Data Flow](./data-flow)
- [Database Schema](./database-schema)
- [Security](./security)
