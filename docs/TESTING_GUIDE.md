# Testing Guide

## Overview

This guide covers testing strategies for the metrics-based billing platform.

---

## Unit Tests

### Test Invoice Generation

```typescript
import { calculateInvoice } from '../services/billing-calculator.js';
import { UsageAggregate } from '../types/domain.js';

const aggregates: UsageAggregate[] = [
  {
    id: '1',
    organisationId: 'org-1',
    projectId: 'proj-1',
    metricName: 'api_calls',
    unit: 'count',
    totalValue: 1000,
    month: 1,
    year: 2024,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const pricingRules = [
  {
    id: '1',
    metricName: 'api_calls',
    unit: 'count',
    pricePerUnit: '0.001',
    currency: 'INR',
    effectiveFrom: new Date('2024-01-01'),
    effectiveTo: undefined,
    isActive: true,
  },
];

const invoice = calculateInvoice(
  aggregates,
  pricingRules,
  [],
  {
    organisationId: 'org-1',
    taxRate: '0.18',
    currency: 'INR',
    paymentTerms: 30,
    minimumChargeEnabled: false,
  },
  1,
  2024
);

// Assertions
assert.equal(invoice.total.toString(), '1.18'); // 1000 * 0.001 * 1.18
```

### Test Idempotency

```typescript
import { withIdempotency } from '../db/idempotency.js';

// First call should succeed
const result1 = await withIdempotency(
  pool,
  'test-key',
  'invoice',
  async () => ({ id: 'invoice-1', result: { total: 100 } })
);

// Second call with same key should throw IdempotencyError
await assert.rejects(
  () => withIdempotency(
    pool,
    'test-key',
    'invoice',
    async () => ({ id: 'invoice-2', result: { total: 200 } })
  ),
  IdempotencyError
);
```

---

## Integration Tests

### Test Event Ingestion Flow

```bash
# 1. Create organisation and project
ORG_ID=$(curl -X POST http://localhost:8787/api/v1/admin/organisations \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Org"}' | jq -r '.id')

PROJECT_ID=$(curl -X POST "http://localhost:8787/api/v1/admin/organisations/$ORG_ID/projects" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Project"}' | jq -r '.id')

API_KEY=$(curl -X POST "http://localhost:8787/api/v1/admin/projects/$PROJECT_ID/api-keys" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" | jq -r '.apiKey')

# 2. Ingest events
for i in {1..10}; do
  curl -X POST http://localhost:8787/events \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"event_id\": \"test-event-$i\",
      \"metric_name\": \"api_calls\",
      \"metric_value\": $i,
      \"unit\": \"count\"
    }"
done

# 3. Wait for migration (5 minutes) or trigger manually
# 4. Verify events in RDS
psql $DATABASE_URL -c "SELECT COUNT(*) FROM usage_events WHERE organisation_id = '$ORG_ID';"

# 5. Generate invoice
curl -X POST "http://localhost:8787/api/v1/admin/invoices/generate" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"organisationId\": \"$ORG_ID\",
    \"month\": 1,
    \"year\": 2024
  }"

# 6. Verify invoice
psql $DATABASE_URL -c "SELECT * FROM invoices WHERE organisation_id = '$ORG_ID';"
```

### Test Payment Flow

```bash
# 1. Generate invoice (from above)
INVOICE_ID="invoice-uuid"

# 2. Finalize invoice
curl -X POST "http://localhost:8787/api/v1/admin/invoices/$INVOICE_ID/finalize" \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# 3. Create Razorpay order
curl -X POST "http://localhost:8787/api/v1/payments/orders" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"invoiceId\": \"$INVOICE_ID\"}"

# 4. Simulate webhook (use Razorpay test webhook)
curl -X POST "http://localhost:8787/webhooks/razorpay" \
  -H "X-Razorpay-Signature: test-signature" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "payment.captured",
    "payload": {
      "entity": {
        "id": "pay_test123",
        "order_id": "order_test123",
        "amount": 11800,
        "currency": "INR",
        "status": "captured",
        "method": "card"
      }
    }
  }'

# 5. Verify payment
psql $DATABASE_URL -c "SELECT * FROM payments WHERE invoice_id = '$INVOICE_ID';"
```

---

## Load Testing

### Test Event Ingestion Rate

```bash
# Install Apache Bench or use wrk
# ab -n 10000 -c 100 -H "Authorization: Bearer $API_KEY" \
#   -p event.json -T application/json \
#   http://localhost:8787/events

# Or use wrk
wrk -t4 -c100 -d30s -s event.lua \
  -H "Authorization: Bearer $API_KEY" \
  http://localhost:8787/events
```

### Test Concurrent Invoice Generation

```typescript
// Test concurrent invoice generation (should be idempotent)
const promises = Array.from({ length: 10 }, () =>
  generateInvoice(pool, {
    organisationId: 'org-1',
    month: 1,
    year: 2024,
  })
);

const results = await Promise.allSettled(promises);

// Should have exactly 1 success, 9 idempotency errors
const successes = results.filter(r => r.status === 'fulfilled').length;
const idempotencyErrors = results.filter(
  r => r.status === 'rejected' && r.reason instanceof IdempotencyError
).length;

assert.equal(successes, 1);
assert.equal(idempotencyErrors, 9);
```

---

## Chaos Testing

### Test Migration Failure Recovery

```bash
# 1. Start migration
# 2. Kill RDS connection mid-migration
# 3. Verify:
#    - Events not marked as processed in D1
#    - Partial events in RDS (if any)
#    - Retry succeeds without duplicates
```

### Test Queue Processing Failure

```bash
# 1. Send events to queue
# 2. Simulate processing failure
# 3. Verify:
#    - Events retry with exponential backoff
#    - Failed events go to DLQ after max retries
#    - No data loss
```

---

## Security Testing

### Test Authentication

```bash
# Test invalid API key
curl -X GET http://localhost:8787/api/v1/admin/organisations \
  -H "Authorization: Bearer invalid-key"
# Should return 401

# Test missing API key
curl -X GET http://localhost:8787/api/v1/admin/organisations
# Should return 401

# Test expired API key
# (Set expires_at in database, then test)
# Should return 401
```

### Test Rate Limiting

```bash
# Send 31 requests in 1 minute
for i in {1..31}; do
  curl -X GET http://localhost:8787/api/v1/admin/organisations \
    -H "Authorization: Bearer $ADMIN_API_KEY" &
done
wait

# 30th should succeed, 31st should return 429
```

### Test IP Whitelisting

```bash
# Test from whitelisted IP (should succeed)
curl -X GET http://localhost:8787/api/v1/admin/organisations \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "CF-Connecting-IP: 192.168.1.1"

# Test from non-whitelisted IP (should return 403)
curl -X GET http://localhost:8787/api/v1/admin/organisations \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "CF-Connecting-IP: 10.0.0.1"
```

---

## Reconciliation Testing

### Test D1 vs RDS Reconciliation

```bash
# 1. Create events in D1
# 2. Manually delete some from RDS (simulate data loss)
# 3. Run reconciliation job
# 4. Verify discrepancies detected
psql $DATABASE_URL -c "SELECT * FROM d1_rds_reconciliation WHERE status = 'discrepancy';"
```

### Test Payment Reconciliation

```bash
# 1. Create payment records
# 2. Manually delete some (simulate webhook failure)
# 3. Run reconciliation job
# 4. Verify unreconciled payments detected
psql $DATABASE_URL -c "SELECT * FROM unreconciled_payments;"
```

---

## Performance Testing

### Test Invoice Generation Performance

```typescript
// Generate invoice for large dataset
const start = Date.now();
const invoice = await generateInvoice(pool, {
  organisationId: 'org-1',
  month: 1,
  year: 2024,
});
const duration = Date.now() - start;

// Should complete in <5 seconds for 1000 line items
assert(duration < 5000, 'Invoice generation too slow');
```

### Test Database Query Performance

```sql
-- Test invoice lookup performance
EXPLAIN ANALYZE
SELECT * FROM invoices
WHERE organisation_id = 'org-uuid'
  AND month = 1
  AND year = 2024;

-- Should use index: idx_invoices_org_month_year_unique
```

---

## Test Data Setup

### Create Test Organisation

```sql
-- Insert test organisation
INSERT INTO organisations (id, name, slug, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Test Organisation',
  'test-org',
  true
)
ON CONFLICT (slug) DO NOTHING;
```

### Create Test Pricing Rules

```sql
-- Insert test pricing rule
INSERT INTO pricing_plans (
  id, metric_name, unit, price_per_unit, currency,
  effective_from, is_active
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'api_calls',
  'count',
  0.001,
  'INR',
  '2024-01-01',
  true
);
```

---

## Continuous Testing

### Pre-Commit Tests

```bash
# Run linter
npm run lint

# Run type check
npm run type-check

# Run unit tests
npm test
```

### CI/CD Pipeline

```yaml
# Example GitHub Actions workflow
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm run lint
      - run: npm run type-check
      - run: npm test
```

---

## Test Coverage Goals

- **Unit Tests**: >80% coverage
- **Integration Tests**: All critical paths
- **E2E Tests**: Main user flows
- **Security Tests**: All authentication/authorization paths
- **Performance Tests**: Critical operations

---

## Test Reports

Generate test reports:
```bash
# Coverage report
npm run test:coverage

# HTML report
open coverage/index.html
```

---

## Debugging Failed Tests

1. **Check Logs**: `wrangler tail`
2. **Check Database**: Verify data state
3. **Check Idempotency**: Verify no duplicate keys
4. **Check Transactions**: Verify atomic operations
5. **Check Error Messages**: Review error details

---

For more testing examples, see `scripts/test-admin-api.sh` and test files in the codebase.
