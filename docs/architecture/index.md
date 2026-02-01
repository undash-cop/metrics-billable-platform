# Architecture Overview

High-level architecture of the Undash-cop Metrics Billing Platform.

**Copyright © 2026 Undash-cop Private Limited. All rights reserved.**

## System Architecture

```
                     ┌─────────────┐ 
                     │   Clients   │
                     └──────┬──────┘
                            │
                            ▼
       ┌─────────────────────────────────────────┐
       │     Cloudflare Workers                  │
       │ (API Gateway, Event Ingestion, Cron)    │
       └────────┬──────────┬───────────┬─────────┘
                │          │           │
                ▼          ▼           ▼
     ┌─────────────┐ ┌────────────┐ ┌───────────┐
     │ Cloudflare  │ │ Cron (5m)  │ │ Cloudflare│
     │    D1       │ │ D1→RDS+agg │ │   R2      │
     │ (Hot Events │ │ (D1 queue) │ │ (Object   │
     │  as queue)  │ │             │ │ Storage)  │
     └─────────────┘ └──────┬─────┘ └───────────┘
                            │
                            ▼
       ┌────────────────────────────────────────┐
       │     Amazon RDS (Postgres)              │
       │ (Financial Source of Truth, Aggregates)│
       └────────────────────┬───────────────────┘
                            │
                            ▼
                     ┌─────────────┐
                     │   Razorpay  │
                     │ (Payments)  │
                     └─────────────┘
```

## Components

### Cloudflare Workers

- **Event Ingestion API** - Receives usage events from clients
- **Admin API** - Management endpoints for organisations, projects, invoices
- **Payment API** - Creates Razorpay payment orders
- **Webhook Handlers** - Processes Razorpay payment webhooks
- **Cron Jobs** - Scheduled tasks (invoice generation, data migration, cleanup)

### Cloudflare D1

- **Hot Event Storage** - Temporary storage for incoming events
- **API Key Cache** - Fast API key validation
- **Retention** - Events retained for 7 days after processing

### D1 as Queue (Cron Polling)

- **D1 as queue** - Events land in D1; no Cloudflare Queues required
- **Cron every 5 min** - Polls D1 for unprocessed events, copies to RDS, updates usage_aggregates, removes from D1
- **Idempotency** - RDS insert uses idempotency_key; aggregation errors are logged and skipped

### Amazon RDS (PostgreSQL)

- **Financial Source of Truth** - All financial data stored here
- **Usage Aggregates** - Monthly usage summaries
- **Invoices** - Invoice records
- **Payments** - Payment records
- **Organisations & Projects** - Multi-tenant data

### Razorpay

- **Payment Processing** - India-first payment gateway
- **Webhooks** - Payment status updates
- **Orders** - Payment order creation

## Data Flow

### Event Ingestion Flow

1. Client sends event to `/api/v1/events`
2. Worker validates API key (checks D1 cache or RDS)
3. Worker writes event to D1 (D1 acts as queue)
4. Worker returns 202 Accepted
5. Cron (every 5 min) fetches unprocessed events from D1
6. Cron inserts into RDS usage_events, then aggregates from D1 into RDS usage_aggregates and removes events from D1

### Invoice Generation Flow

1. Cron job runs on 1st of each month
2. Fetches all active organisations
3. For each organisation:
   - Fetches usage aggregates for previous month
   - Calculates invoice using pricing rules
   - Creates invoice record in RDS
   - Sends invoice email
4. Logs results and metrics

### Payment Flow

1. Admin creates payment order via API
2. Worker creates Razorpay order
3. Client redirects to Razorpay checkout
4. User completes payment
5. Razorpay sends webhook
6. Worker verifies webhook signature
7. Worker updates payment status
8. Worker updates invoice status
9. Worker sends payment confirmation email

## Design Principles

### Multi-Tenancy

- **Organisations** - Top-level tenant
- **Projects** - Sub-tenant under organisation
- **Data Isolation** - All queries filtered by organisation/project

### Idempotency

- **Event IDs** - Client-provided unique IDs prevent duplicates
- **Idempotency Keys** - Database-level idempotency for critical operations
- **Unique Constraints** - Database constraints prevent duplicates

### Financial Integrity

- **Decimal Precision** - Uses Decimal.js for money calculations
- **Database Transactions** - Atomic operations for financial data
- **Reconciliation** - Regular reconciliation jobs verify data integrity
- **Audit Logging** - Complete audit trail for all financial operations

### Reliability

- **D1 as Queue** - Events stored in D1; cron polls every 5 min for migration + aggregation (no Cloudflare Queues)
- **Idempotency** - RDS insert and aggregation support safe retries
- **Error Handling** - Aggregation errors logged and skipped per period; migration fail-fast
- **Comprehensive Logging** - All operations and failures logged

### Security

- **API Key Authentication** - Secure API access
- **RBAC** - Role-based access control
- **Rate Limiting** - Prevents abuse
- **IP Whitelisting** - Optional IP restrictions
- **Audit Logging** - Complete audit trail

## Scalability

- **Serverless** - Auto-scaling Cloudflare Workers
- **D1 + Cron** - D1 holds events; cron batches migration and aggregation (no queue product required)
- **Database Indexing** - Optimized queries
- **Caching** - D1 cache for API keys

## See Also

- [System Design](./system-design) - Detailed system design
- [Data Flow](./data-flow) - Detailed data flow diagrams
- [Database Schema](./database-schema) - Database schema design
- [Security](./security) - Security architecture
