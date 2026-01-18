# Observability Guide

## Overview

Comprehensive observability for the billing platform including structured logging, metrics collection, and alerting.

## Components

### 1. Structured Logging

**Purpose**: Consistent, parseable logs for debugging and audit trails.

**Features**:
- JSON-structured logs
- Log levels (DEBUG, INFO, WARN, ERROR, FATAL)
- Contextual information (requestId, userId, organisationId, etc.)
- Error tracking with stack traces
- Operation timing

**Usage**:
```typescript
const logger = createLogger(env);

logger.info('Event ingested', {
  requestId: 'req-123',
  organisationId: 'org-123',
  projectId: 'proj-123',
  eventId: 'event-123',
});

logger.logError(error, {
  operation: 'invoice_generation',
  invoiceId: 'inv-123',
});
```

### 2. Metrics Collection

**Purpose**: Track system performance and business metrics.

**Key Metrics**:

#### Ingestion Metrics
- `events.ingested` - Counter: Events successfully ingested
- `events.ingestion.failed` - Counter: Failed ingestion attempts
- `events.ingestion.duration` - Histogram: Ingestion latency

#### Billing Metrics
- `billing.invoice_generated` - Counter: Invoices generated
- `billing.invoice_finalized` - Counter: Invoices finalized
- `billing.invoice_failed` - Counter: Invoice generation failures
- `billing.failures` - Counter: Total billing failures
- `billing.*.duration` - Histogram: Operation latency

#### Payment Metrics
- `payments.order_created` - Counter: Razorpay orders created
- `payments.payment_captured` - Counter: Successful payments
- `payments.payment_failed` - Counter: Failed payments
- `payments.webhook_processed` - Counter: Webhooks processed
- `payments.failures` - Counter: Total payment failures
- `payments.*.duration` - Histogram: Operation latency

#### API Metrics
- `api.requests` - Counter: Total API requests
- `api.errors` - Counter: API errors (4xx, 5xx)
- `api.request.duration` - Histogram: Request latency

#### Database Metrics
- `database.operations.success` - Counter: Successful DB operations
- `database.operations.failed` - Counter: Failed DB operations
- `database.operation.duration` - Histogram: Query latency

#### Queue Metrics
- `queue.message_sent` - Counter: Messages sent to queue
- `queue.message_processed` - Counter: Messages processed
- `queue.message_failed` - Counter: Failed message processing
- `queue.*.duration` - Histogram: Processing latency

### 3. Alerting

**Purpose**: Proactive monitoring and incident response.

**Alert Thresholds**:

#### Critical Alerts (Immediate Action Required)

1. **Event Ingestion Failures**
   - Threshold: >50 failures/minute
   - Impact: Events not being ingested, potential revenue loss
   - Action: Check D1 database, API key validation, network issues

2. **Billing Failures**
   - Threshold: >20 failures/hour
   - Impact: Invoices not being generated, billing disruption
   - Action: Check invoice generation service, pricing rules, database

3. **Payment Failures**
   - Threshold: >10 failures/hour
   - Impact: Payments not processing, revenue loss
   - Action: Check Razorpay integration, webhook processing, database

4. **API Error Rate**
   - Threshold: >500 errors/minute
   - Impact: System degradation, user impact
   - Action: Check application errors, database connectivity, external services

5. **Database Failures**
   - Threshold: >50 failures/minute
   - Impact: Data operations failing, system instability
   - Action: Check RDS connectivity, connection pool, query performance

6. **API Latency**
   - Threshold: P95 >10 seconds
   - Impact: Poor user experience, timeouts
   - Action: Check query performance, database load, external API calls

#### Warning Alerts (Attention Needed)

1. **Event Ingestion Failures**
   - Threshold: >10 failures/minute
   - Impact: Some events not being ingested
   - Action: Monitor trend, check logs

2. **Billing Failures**
   - Threshold: >5 failures/hour
   - Impact: Some invoices not generating
   - Action: Investigate specific failures, check pricing rules

3. **Payment Failures**
   - Threshold: >3 failures/hour
   - Impact: Some payments not processing
   - Action: Check webhook logs, Razorpay status

4. **API Error Rate**
   - Threshold: >100 errors/minute
   - Impact: Increased error rate
   - Action: Monitor error types, check recent deployments

5. **Database Failures**
   - Threshold: >10 failures/minute
   - Impact: Some queries failing
   - Action: Check connection pool, query performance

6. **API Latency**
   - Threshold: P95 >5 seconds
   - Impact: Slower response times
   - Action: Optimize queries, check database load

## What Should Be Monitored and Why

### 1. Event Ingestion Rate

**What**: Number of events ingested per second/minute

**Why**:
- **Business Impact**: Directly affects billing accuracy
- **System Health**: High failure rate indicates system issues
- **Capacity Planning**: Track growth trends
- **Revenue Impact**: Missing events = missing revenue

**Metrics**:
- `events.ingested` (rate)
- `events.ingestion.failed` (rate)
- `events.ingestion.duration` (latency)

**Alert Thresholds**:
- Warning: >10 failures/minute
- Critical: >50 failures/minute

### 2. Billing Failures

**What**: Invoice generation failures

**Why**:
- **Financial Impact**: Failed invoices = delayed revenue
- **Customer Impact**: Customers not billed correctly
- **Compliance**: Billing accuracy is critical
- **System Health**: Indicates pricing/aggregation issues

**Metrics**:
- `billing.invoice_generated` (success rate)
- `billing.invoice_failed` (failure rate)
- `billing.failures` (total failures)
- `billing.*.duration` (latency)

**Alert Thresholds**:
- Warning: >5 failures/hour
- Critical: >20 failures/hour

### 3. Payment Failures

**What**: Payment processing failures

**Why**:
- **Revenue Impact**: Failed payments = lost revenue
- **Customer Impact**: Payment issues affect customer experience
- **Reconciliation**: Failed payments need manual intervention
- **System Health**: Indicates Razorpay/webhook issues

**Metrics**:
- `payments.payment_captured` (success rate)
- `payments.payment_failed` (failure rate)
- `payments.failures` (total failures)
- `payments.webhook_processed` (webhook success)
- `payments.*.duration` (latency)

**Alert Thresholds**:
- Warning: >3 failures/hour
- Critical: >10 failures/hour

### 4. API Performance

**What**: API request latency and error rates

**Why**:
- **User Experience**: Slow APIs = poor UX
- **System Health**: High latency indicates problems
- **Capacity**: Track load and plan scaling
- **Error Tracking**: Identify problematic endpoints

**Metrics**:
- `api.requests` (request rate)
- `api.errors` (error rate)
- `api.request.duration` (latency - P50, P95, P99)

**Alert Thresholds**:
- Warning: P95 >5 seconds
- Critical: P95 >10 seconds
- Warning: >100 errors/minute
- Critical: >500 errors/minute

### 5. Database Performance

**What**: Database operation success rate and latency

**Why**:
- **System Stability**: DB failures affect all operations
- **Performance**: Slow queries impact user experience
- **Capacity**: Track connection pool usage
- **Data Integrity**: Failed operations may indicate data issues

**Metrics**:
- `database.operations.success` (success rate)
- `database.operations.failed` (failure rate)
- `database.operation.duration` (query latency)

**Alert Thresholds**:
- Warning: >10 failures/minute
- Critical: >50 failures/minute

### 6. Queue Processing

**What**: Queue message processing rate and failures

**Why**:
- **Data Flow**: Queue failures block data processing
- **Backlog**: Unprocessed messages indicate issues
- **Reliability**: Queue is critical for async processing
- **Latency**: Processing delays affect billing timeliness

**Metrics**:
- `queue.message_sent` (send rate)
- `queue.message_processed` (processing rate)
- `queue.message_failed` (failure rate)
- `queue.*.duration` (processing latency)

**Alert Thresholds**:
- Warning: >10 failures/minute
- Critical: >50 failures/minute

### 7. Financial Reconciliation

**What**: Payment-to-invoice reconciliation status

**Why**:
- **Financial Accuracy**: Unreconciled payments need attention
- **Compliance**: Reconciliation is required for audit
- **Revenue Tracking**: Ensure all payments are recorded
- **Customer Service**: Unreconciled payments affect customer accounts

**Metrics**:
- `payments.reconciled` (reconciliation rate)
- `payments.unreconciled` (unreconciled count)
- `payments.reconciliation.duration` (time to reconcile)

**Alert Thresholds**:
- Warning: >10 unreconciled payments
- Critical: >50 unreconciled payments

### 8. Invoice Generation Timeliness

**What**: Time between billing period end and invoice generation

**Why**:
- **Customer Experience**: Delayed invoices affect customer trust
- **Cash Flow**: Late invoices = delayed payments
- **Compliance**: Timely billing is often required
- **System Health**: Delays indicate processing issues

**Metrics**:
- `billing.invoice.generation.delay` (days/hours delay)
- `billing.invoice.generated.on_time` (on-time rate)

**Alert Thresholds**:
- Warning: >1 day delay
- Critical: >3 days delay

## Implementation

### Logging Integration

Add logging to all operations:

```typescript
const logger = createLogger(env);
const startTime = Date.now();

try {
  // Operation
  logger.logOperationStart('invoice_generation', {
    organisationId,
    month,
    year,
  });

  const result = await generateInvoice(...);

  logger.logOperationComplete('invoice_generation', Date.now() - startTime, {
    organisationId,
    invoiceId: result.id,
  });
} catch (error) {
  logger.logOperationFailure('invoice_generation', error, Date.now() - startTime, {
    organisationId,
    month,
    year,
  });
}
```

### Metrics Integration

Add metrics to all operations:

```typescript
const metrics = createMetricsCollector(env);
const startTime = Date.now();

try {
  // Operation
  const result = await processPayment(...);

  metrics.trackPaymentOperation('payment_captured', Date.now() - startTime, {
    organisationId: result.organisationId,
    paymentId: result.id,
  });
} catch (error) {
  metrics.trackPaymentOperation('payment_failed', Date.now() - startTime, {
    organisationId,
    errorCode: error.code,
  });
}
```

### Alerting Integration

Monitor metrics and trigger alerts:

```typescript
const alertManager = createAlertManager(logger, metrics);

// Check thresholds periodically
const failures = getMetricValue('events.ingestion.failed', '1m');
const alert = alertManager.checkThreshold('events.ingestion.failed', failures);

if (alert) {
  // Alert triggered - send notification
  await sendAlert(alert);
}
```

## Monitoring Dashboard

### Key Dashboards

1. **Ingestion Dashboard**
   - Events ingested per minute
   - Ingestion failure rate
   - Ingestion latency (P50, P95, P99)
   - Events by organisation/project

2. **Billing Dashboard**
   - Invoices generated per hour
   - Billing failure rate
   - Invoice generation latency
   - Failed invoices by organisation

3. **Payment Dashboard**
   - Payments processed per hour
   - Payment success rate
   - Payment failure rate
   - Unreconciled payments
   - Webhook processing rate

4. **System Health Dashboard**
   - API request rate
   - API error rate
   - API latency (P50, P95, P99)
   - Database operation success rate
   - Queue processing rate

5. **Financial Dashboard**
   - Total revenue (by period)
   - Outstanding invoices
   - Payment reconciliation status
   - Failed payment amount

## Alerting Channels

### Critical Alerts
- **PagerDuty**: Immediate notification
- **Slack**: #critical-alerts channel
- **Email**: On-call engineer

### Warning Alerts
- **Slack**: #warnings channel
- **Email**: Team distribution list

### Info Alerts
- **Slack**: #info channel

## Best Practices

1. **Structured Logging**: Always use structured logs with context
2. **Metrics First**: Track metrics for all critical operations
3. **Alert Fatigue**: Set thresholds appropriately to avoid false positives
4. **Runbooks**: Document alert response procedures
5. **Review Regularly**: Review and adjust thresholds based on trends
6. **Correlation**: Correlate logs and metrics for debugging
7. **Retention**: Keep logs/metrics for compliance period (7 years for financial data)
