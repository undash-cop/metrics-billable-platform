# Quick Reference Guide

## Common Operations

### Create Admin User

```bash
# 1. Hash API key
node scripts/hash-api-key.js "your-secret-api-key"

# 2. Create user in database
psql $DATABASE_URL -f scripts/create-admin-user.sql

# 3. Insert API key (use hash from step 1)
psql $DATABASE_URL -c "
INSERT INTO admin_api_keys (user_id, key_hash, name)
SELECT id, 'hashed-key-from-step-1', 'Production Key'
FROM admin_users WHERE email = 'admin@example.com';
"
```

### Test Admin API

```bash
# Set API key
export ADMIN_API_KEY=your-admin-api-key

# Run tests
./scripts/test-admin-api.sh $ADMIN_API_KEY http://localhost:8787
```

### Check Reconciliation Status

```sql
-- D1 vs RDS discrepancies
SELECT * FROM d1_rds_reconciliation 
WHERE status = 'discrepancy' 
ORDER BY reconciliation_date DESC;

-- Payment discrepancies
SELECT * FROM payment_reconciliation 
WHERE status = 'discrepancy' 
ORDER BY reconciliation_date DESC;

-- Unreconciled payments
SELECT * FROM unreconciled_payments 
ORDER BY created_at DESC 
LIMIT 10;
```

### View Recent Admin Actions

```sql
SELECT 
  email,
  action,
  entity_type,
  created_at
FROM admin_action_logs
ORDER BY created_at DESC
LIMIT 20;
```

### Check Invoice Status

```sql
-- Recent invoices
SELECT 
  invoice_number,
  organisation_id,
  status,
  total,
  created_at
FROM invoices
ORDER BY created_at DESC
LIMIT 10;

-- Duplicate invoice attempts (should be empty)
SELECT 
  organisation_id,
  month,
  year,
  COUNT(*) as count
FROM invoices
WHERE status != 'cancelled'
GROUP BY organisation_id, month, year
HAVING COUNT(*) > 1;
```

### Check Migration Status

```sql
-- Events pending migration
SELECT COUNT(*) 
FROM usage_events 
WHERE processed_at IS NULL;

-- Migration statistics
SELECT 
  DATE(reconciliation_date) as date,
  SUM(d1_event_count) as d1_total,
  SUM(rds_event_count) as rds_total,
  SUM(discrepancy_count) as discrepancies
FROM d1_rds_reconciliation
GROUP BY DATE(reconciliation_date)
ORDER BY date DESC;
```

---

## API Endpoints

### Event Ingestion
```
POST /events
Authorization: Bearer <project-api-key>
Body: {
  "event_id": "unique-id",
  "metric_name": "api_calls",
  "metric_value": 1,
  "unit": "count"
}
```

### Admin - Create Organisation
```
POST /api/v1/admin/organisations
Authorization: Bearer <admin-api-key>
Body: {
  "name": "Org Name",
  "billingEmail": "billing@example.com"
}
```

### Admin - Create Project
```
POST /api/v1/admin/organisations/:orgId/projects
Authorization: Bearer <admin-api-key>
Body: {
  "name": "Project Name"
}
```

### Admin - Generate API Key
```
POST /api/v1/admin/projects/:projectId/api-keys
Authorization: Bearer <admin-api-key>
```

### Admin - List Invoices
```
GET /api/v1/admin/organisations/:orgId/invoices?status=paid&limit=10
Authorization: Bearer <admin-api-key>
```

---

## Environment Variables

### Required
- `RDS_HOST` - RDS PostgreSQL host
- `RDS_PORT` - RDS port (usually 5432)
- `RDS_DATABASE` - Database name
- `RDS_USER` - Database user
- `RDS_PASSWORD` - Database password
- `RAZORPAY_KEY_ID` - Razorpay key ID
- `RAZORPAY_KEY_SECRET` - Razorpay key secret
- `RAZORPAY_WEBHOOK_SECRET` - Razorpay webhook secret

### Optional
- `ADMIN_API_KEY` - Admin API key (simple deployment)
- `ADMIN_IP_WHITELIST` - Comma-separated IPs
- `MIGRATION_BATCH_SIZE` - Events per batch (default: 1000)
- `MIGRATION_MAX_BATCHES` - Max batches per run (default: 10)

---

## Cron Jobs

### D1 to RDS Migration
- **Schedule**: Every 5 minutes (`*/5 * * * *`)
- **Purpose**: Migrate events from D1 to RDS
- **Logs**: Check `wrangler tail` for "migration"

### Reconciliation
- **Schedule**: Daily at 2 AM UTC (`0 2 * * *`)
- **Purpose**: Reconcile D1 vs RDS, payments, aggregates
- **Logs**: Check reconciliation tables

### D1 Cleanup
- **Schedule**: Daily at 3 AM UTC (`0 3 * * *`)
- **Purpose**: Delete processed events older than 7 days
- **Logs**: Check `wrangler tail` for "cleanup"

---

## Database Tables

### Core Tables
- `organisations` - Tenant organisations
- `projects` - Projects per organisation
- `usage_events` - Raw usage events (RDS)
- `usage_aggregates` - Aggregated usage
- `invoices` - Generated invoices
- `invoice_line_items` - Invoice line items
- `payments` - Payment records
- `pricing_plans` - Pricing rules

### Admin Tables
- `admin_users` - Admin users
- `admin_api_keys` - Admin API keys (hashed)
- `admin_action_logs` - Admin audit logs

### Reconciliation Tables
- `d1_rds_reconciliation` - D1 vs RDS reconciliation
- `payment_reconciliation` - Payment reconciliation

### System Tables
- `idempotency_keys` - Idempotency tracking
- `audit_logs` - General audit logs
- `alert_history` - Alert history

---

## Common Queries

### Find Duplicate Events
```sql
SELECT idempotency_key, COUNT(*) 
FROM usage_events 
GROUP BY idempotency_key 
HAVING COUNT(*) > 1;
```

### Find Missing Aggregates
```sql
SELECT 
  ue.organisation_id,
  ue.project_id,
  ue.metric_name,
  COUNT(*) as event_count
FROM usage_events ue
LEFT JOIN usage_aggregates ua ON 
  ue.organisation_id = ua.organisation_id AND
  ue.project_id = ua.project_id AND
  ue.metric_name = ua.metric_name AND
  EXTRACT(MONTH FROM ue.timestamp) = ua.month AND
  EXTRACT(YEAR FROM ue.timestamp) = ua.year
WHERE ua.id IS NULL
GROUP BY ue.organisation_id, ue.project_id, ue.metric_name;
```

### Find Unpaid Invoices
```sql
SELECT 
  invoice_number,
  organisation_id,
  total,
  due_date,
  DATEDIFF(day, due_date, CURRENT_DATE) as days_overdue
FROM invoices
WHERE status NOT IN ('paid', 'cancelled')
  AND due_date < CURRENT_DATE
ORDER BY days_overdue DESC;
```

### Find Failed Migrations
```sql
SELECT 
  organisation_id,
  project_id,
  metric_name,
  discrepancy_count,
  reconciliation_date
FROM d1_rds_reconciliation
WHERE status = 'error'
ORDER BY reconciliation_date DESC;
```

---

## Error Codes

### HTTP Status Codes
- `200` - Success
- `201` - Created
- `202` - Accepted (event ingestion)
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid API key)
- `403` - Forbidden (access denied, IP whitelist)
- `404` - Not Found
- `409` - Conflict (duplicate)
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

### Error Response Format
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "statusCode": 400,
  "details": {
    "field": "additional context"
  }
}
```

---

## Monitoring Queries

### Event Ingestion Rate
```sql
SELECT 
  DATE(ingested_at) as date,
  COUNT(*) as event_count,
  COUNT(DISTINCT organisation_id) as org_count
FROM usage_events
WHERE ingested_at > NOW() - INTERVAL '24 hours'
GROUP BY DATE(ingested_at)
ORDER BY date DESC;
```

### Invoice Generation Rate
```sql
SELECT 
  DATE(created_at) as date,
  COUNT(*) as invoice_count,
  SUM(total::numeric) as total_revenue
FROM invoices
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### Payment Success Rate
```sql
SELECT 
  status,
  COUNT(*) as count,
  SUM(amount::numeric) as total_amount
FROM payments
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY status;
```

---

## Troubleshooting Commands

### Check Worker Logs
```bash
wrangler tail --env production
```

### Check Cron Execution
```bash
wrangler tail --env production | grep "cron"
```

### Check Database Connections
```sql
SELECT count(*) FROM pg_stat_activity;
```

### Check Queue Depth
```bash
# Check Cloudflare Dashboard → Queues → usage-events
```

### Check D1 Storage
```bash
wrangler d1 execute EVENTS_DB --command "SELECT COUNT(*) FROM usage_events;"
```

---

## Useful Scripts

### Hash API Key
```bash
node scripts/hash-api-key.js "your-api-key"
```

### Create Admin User
```bash
psql $DATABASE_URL -f scripts/create-admin-user.sql
```

### Test Admin API
```bash
./scripts/test-admin-api.sh $ADMIN_API_KEY http://localhost:8787
```

---

## Refunds

### Create Refund
```bash
curl -X POST https://your-worker.workers.dev/api/v1/admin/payments/{paymentId}/refunds \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount": "500.00", "reason": "Customer request"}'
```

### List Refunds
```bash
curl https://your-worker.workers.dev/api/v1/admin/payments/{paymentId}/refunds \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

### Get Refund Details
```bash
curl https://your-worker.workers.dev/api/v1/admin/refunds/{refundId} \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

## PDF Invoices

### Download Invoice PDF
```bash
curl https://your-worker.workers.dev/api/v1/admin/invoices/{invoiceId}/pdf \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -o invoice.pdf
```

### Check PDF Status
```bash
curl https://your-worker.workers.dev/api/v1/admin/invoices/{invoiceId} \
  -H "Authorization: Bearer $ADMIN_API_KEY" | jq .pdfUrl
```

## Payment Retry

### Retry Failed Payment
```bash
curl -X POST https://your-worker.workers.dev/api/v1/admin/payments/{paymentId}/retry \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

### Get Retry Status
```bash
curl https://your-worker.workers.dev/api/v1/admin/payments/{paymentId}/retry-status \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

### Update Retry Config
```bash
curl -X PATCH https://your-worker.workers.dev/api/v1/admin/payments/{paymentId}/retry-config \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"maxRetries": 5}'
```

## Usage Alerts

### Create Alert Rule
```bash
curl -X POST https://your-worker.workers.dev/api/v1/admin/organisations/{orgId}/alert-rules \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "High Usage Alert",
    "alertType": "usage_threshold",
    "metricName": "api_calls",
    "unit": "count",
    "thresholdValue": "10000",
    "thresholdOperator": "gte",
    "comparisonPeriod": "day",
    "notificationChannels": ["email"]
  }'
```

### List Alert Rules
```bash
curl https://your-worker.workers.dev/api/v1/admin/organisations/{orgId}/alert-rules \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

### Get Alert History
```bash
curl https://your-worker.workers.dev/api/v1/admin/organisations/{orgId}/alert-history \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

## Invoice Templates

### Create Template
```bash
curl -X POST https://your-worker.workers.dev/api/v1/admin/organisations/{orgId}/invoice-templates \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Custom Template",
    "htmlContent": "<html>...</html>",
    "cssContent": "body { ... }",
    "isDefault": true
  }'
```

### Preview Template
```bash
curl https://your-worker.workers.dev/api/v1/admin/invoice-templates/{templateId}/preview?invoiceId={invoiceId} \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

## Exchange Rates

### List Exchange Rates
```bash
curl https://your-worker.workers.dev/api/v1/admin/exchange-rates?baseCurrency=INR \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

### Get Exchange Rate
```bash
curl https://your-worker.workers.dev/api/v1/admin/exchange-rates/INR/USD \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

### Update Exchange Rate
```bash
curl -X POST https://your-worker.workers.dev/api/v1/admin/exchange-rates \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "baseCurrency": "INR",
    "targetCurrency": "USD",
    "rate": "0.012",
    "source": "manual"
  }'
```

### Sync Exchange Rates
```bash
curl -X POST https://your-worker.workers.dev/api/v1/admin/exchange-rates/sync?baseCurrency=INR \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

## Email Notifications

### List Email Notifications
```bash
curl https://your-worker.workers.dev/api/v1/admin/organisations/{orgId}/email-notifications?status=sent \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

### Get Email Notification
```bash
curl https://your-worker.workers.dev/api/v1/admin/email-notifications/{notificationId} \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

## Support Resources

- **Documentation**: `docs/` directory
- **Architecture**: [Architecture Overview](/architecture/)
- **API Reference**: [Admin API](/api/admin), [Events API](/api/events)
- **Deployment**: [Deployment Guide](/getting-started/deployment)
- **Testing**: [Testing Guide](/TESTING_GUIDE)
