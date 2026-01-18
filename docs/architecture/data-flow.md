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
Cloudflare Queue
  │
  ├─ Publish Event
  │
  ▼
Return 202 Accepted
  │
  ▼
Queue Consumer
  │
  ├─ Process Event Batch
  ├─ Aggregate Usage
  │
  ▼
RDS Database
  │
  ├─ Update Usage Aggregates
  │
  ▼
Mark D1 Event as Processed
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

## Data Migration Flow

```
Cron Job (Every 5 Minutes)
  │
  ├─ Fetch Unprocessed Events from D1
  │
  ▼
For Each Batch:
  │
  ├─ Insert into RDS (with idempotency)
  ├─ Mark D1 Event as Processed
  │
  ▼
Log Results
```

## See Also

- [Architecture Overview](./index)
- [System Design](./system-design)
- [Database Schema](./database-schema)
