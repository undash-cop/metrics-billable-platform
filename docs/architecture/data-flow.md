# Data Flow

Detailed data flow diagrams for the Metrics Billing Platform.

## Event Ingestion Flow

```
Client
  │
  ├─ POST /api/v1/events
  │
  ▼
Worker (Event Ingestion)
  │
  ├─ Validate API Key (D1 cache or RDS)
  ├─ Validate Request Body
  ├─ Check Idempotency (event_id)
  │
  ▼
D1 Database
  │
  ├─ Insert Event (if not exists)
  │
  ▼
Return 202 Accepted

(D1 acts as queue; events stay in D1 until processed by cron)

Cron (every 5 minutes)
  │
  ├─ Fetch unprocessed events from D1
  ├─ Insert into RDS usage_events (with idempotency)
  ├─ For each distinct (org, project, metric, month, year): aggregate from D1 → RDS usage_aggregates
  ├─ Remove aggregated events from D1
  │
  ▼
RDS Database
  │
  ├─ usage_events (raw)
  ├─ usage_aggregates (monthly rollups)
```

## Invoice Generation Flow

```
Cron Job (1st of Month)
  │
  ├─ Get All Active Organisations
  │
  ▼
For Each Organisation:
  │
  ├─ Fetch Usage Aggregates (Previous Month)
  ├─ Fetch Pricing Rules
  ├─ Calculate Invoice
  ├─ Create Invoice Record
  ├─ Send Invoice Email
  │
  ▼
Log Results
```

## Payment Flow

```
Admin API
  │
  ├─ POST /api/v1/payments/orders
  │
  ▼
Worker
  │
  ├─ Verify Invoice Exists
  ├─ Verify Invoice is Finalized
  ├─ Create Razorpay Order
  ├─ Create Payment Record
  │
  ▼
Return Order Details
  │
  ▼
Client Redirects to Razorpay
  │
  ▼
User Completes Payment
  │
  ▼
Razorpay Webhook
  │
  ├─ POST /webhooks/razorpay
  │
  ▼
Worker
  │
  ├─ Verify Webhook Signature
  ├─ Process Payment
  ├─ Update Payment Status
  ├─ Update Invoice Status
  ├─ Send Payment Email
  │
  ▼
Return 200 OK
```

## Data Migration Flow (D1 as Queue)

```
Cron Job (Every 5 Minutes)
  │
  ├─ Fetch unprocessed events from D1 (D1 = queue)
  │
  ▼
For Each Batch:
  │
  ├─ Insert into RDS usage_events (with idempotency)
  ├─ For each distinct period: aggregate from D1 → RDS usage_aggregates
  ├─ Remove aggregated events from D1
  │
  ▼
Log Results
```

## See Also

- [Architecture Overview](./index)
- [System Design](./system-design)
- [Database Schema](./database-schema)
