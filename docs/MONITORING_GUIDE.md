# Monitoring Guide: What to Monitor and Why

## Overview

This guide explains what metrics should be monitored in the billing platform and why each is critical for financial integrity, system health, and business operations.

## Critical Metrics

### 1. Event Ingestion Rate

**What**: Number of usage events ingested per second/minute

**Metrics**:
- `events.ingested` (rate: events/second)
- `events.ingestion.failed` (rate: failures/second)
- `events.ingestion.duration` (latency: P50, P95, P99)

**Why Monitor**:
1. **Revenue Impact**: Missing events = missing revenue. Every uningested event is lost billing opportunity.
2. **Data Integrity**: Low ingestion rate indicates system issues that could affect billing accuracy.
3. **Capacity Planning**: Track growth trends to plan infrastructure scaling.
4. **Customer Impact**: Failed ingestion affects customer billing accuracy.

**Alert Thresholds**:
- **Warning**: >10 failures/minute
  - **Why**: Indicates some events are not being ingested, needs investigation
  - **Action**: Check logs, verify API key validation, check D1 status
- **Critical**: >50 failures/minute
  - **Why**: Significant portion of events failing, potential revenue loss
  - **Action**: Immediate investigation, check D1 database, network issues

**What to Check**:
- D1 database status and capacity
- API key validation service health
- Network connectivity to D1
- Event validation failures
- Queue publishing failures

---

### 2. Billing Failures

**What**: Invoice generation failures

**Metrics**:
- `billing.invoice_generated` (success rate)
- `billing.invoice_failed` (failure rate)
- `billing.failures` (total failures)
- `billing.*.duration` (latency: P50, P95, P99)

**Why Monitor**:
1. **Financial Impact**: Failed invoices = delayed revenue. Customers not billed = cash flow issues.
2. **Customer Impact**: Customers expect timely invoices. Delays affect trust.
3. **Compliance**: Billing accuracy is critical for financial compliance and audits.
4. **System Health**: Failures indicate pricing rule issues, aggregation problems, or database issues.

**Alert Thresholds**:
- **Warning**: >5 failures/hour
  - **Why**: Some invoices not generating, needs attention
  - **Action**: Investigate specific failures, check pricing rules, verify usage aggregates
- **Critical**: >20 failures/hour
  - **Why**: Significant billing disruption, revenue impact
  - **Action**: Immediate investigation, check invoice generation service, database connectivity

**What to Check**:
- Pricing rules availability (missing rules for metrics)
- Usage aggregates availability
- Invoice generation service health
- Database connectivity and query performance
- Invoice finalization process

---

### 3. Payment Failures

**What**: Payment processing failures

**Metrics**:
- `payments.payment_captured` (success rate)
- `payments.payment_failed` (failure rate)
- `payments.failures` (total failures)
- `payments.webhook_processed` (webhook success rate)
- `payments.*.duration` (latency: P50, P95, P99)

**Why Monitor**:
1. **Revenue Impact**: Failed payments = lost revenue. Direct impact on cash flow.
2. **Customer Experience**: Payment issues frustrate customers and affect retention.
3. **Reconciliation**: Failed payments require manual intervention, increasing operational cost.
4. **System Health**: Failures indicate Razorpay integration issues, webhook problems, or database issues.

**Alert Thresholds**:
- **Warning**: >3 failures/hour
  - **Why**: Some payments not processing, needs investigation
  - **Action**: Check webhook logs, verify Razorpay status, review payment processing
- **Critical**: >10 failures/hour
  - **Why**: Significant payment disruption, revenue loss
  - **Action**: Immediate investigation, check Razorpay API status, webhook processing, database

**What to Check**:
- Razorpay API status and availability
- Webhook signature verification
- Payment reconciliation status
- Database transaction failures
- Invoice payment status updates

---

### 4. API Performance

**What**: API request latency and error rates

**Metrics**:
- `api.requests` (request rate: requests/second)
- `api.errors` (error rate: errors/second)
- `api.request.duration` (latency: P50, P95, P99)

**Why Monitor**:
1. **User Experience**: Slow APIs = poor user experience. High latency causes timeouts and frustration.
2. **System Health**: High latency indicates performance problems (slow queries, database load, etc.).
3. **Capacity Planning**: Track load trends to plan scaling (horizontal/vertical).
4. **Error Tracking**: Identify problematic endpoints and error patterns.

**Alert Thresholds**:
- **Warning**: P95 latency >5 seconds OR >100 errors/minute
  - **Why**: Slower response times or increased error rate
  - **Action**: Optimize queries, check database load, review recent deployments
- **Critical**: P95 latency >10 seconds OR >500 errors/minute
  - **Why**: Severe performance degradation or high error rate
  - **Action**: Immediate investigation, check database connectivity, external service status

**What to Check**:
- Database query performance
- Connection pool usage
- External API latency (Razorpay, etc.)
- Worker CPU/memory usage
- Error patterns by endpoint

---

### 5. Database Performance

**What**: Database operation success rate and latency

**Metrics**:
- `database.operations.success` (success rate)
- `database.operations.failed` (failure rate)
- `database.operation.duration` (query latency: P50, P95, P99)

**Why Monitor**:
1. **System Stability**: Database failures affect ALL operations. Critical dependency.
2. **Performance**: Slow queries impact user experience and system throughput.
3. **Capacity**: Track connection pool usage and query load.
4. **Data Integrity**: Failed operations may indicate data issues or constraint violations.

**Alert Thresholds**:
- **Warning**: >10 failures/minute OR P95 latency >2 seconds
  - **Why**: Some queries failing or slow queries affecting performance
  - **Action**: Check connection pool, optimize slow queries, review database load
- **Critical**: >50 failures/minute OR P95 latency >5 seconds
  - **Why**: Significant database issues, system instability
  - **Action**: Immediate investigation, check RDS status, connection limits, query performance

**What to Check**:
- RDS connection pool usage
- Query performance (slow query log)
- Database CPU/memory usage
- Connection limits
- Transaction deadlocks

---

### 6. Queue Processing

**What**: Queue message processing rate and failures

**Metrics**:
- `queue.message_sent` (send rate: messages/second)
- `queue.message_processed` (processing rate: messages/second)
- `queue.message_failed` (failure rate: failures/second)
- `queue.*.duration` (processing latency: P50, P95, P99)

**Why Monitor**:
1. **Data Flow**: Queue failures block data processing. Events not aggregated = invoices not generated.
2. **Backlog**: Unprocessed messages indicate processing issues or capacity problems.
3. **Reliability**: Queue is critical for async processing. Failures affect billing timeliness.
4. **Latency**: Processing delays affect how quickly invoices can be generated.

**Alert Thresholds**:
- **Warning**: >10 failures/minute OR processing lag >5 minutes
  - **Why**: Some messages not processing or processing delays
  - **Action**: Check queue consumer health, review processing logic, check database
- **Critical**: >50 failures/minute OR processing lag >30 minutes
  - **Why**: Significant queue issues, data processing blocked
  - **Action**: Immediate investigation, check queue consumer, database connectivity

**What to Check**:
- Queue consumer health
- Message processing errors
- Database connectivity from queue consumer
- Processing latency
- Message backlog size

---

### 7. Financial Reconciliation

**What**: Payment-to-invoice reconciliation status

**Metrics**:
- `payments.reconciled` (reconciliation rate)
- `payments.unreconciled` (unreconciled count)
- `payments.reconciliation.duration` (time to reconcile)

**Why Monitor**:
1. **Financial Accuracy**: Unreconciled payments need manual attention. Affects financial reporting.
2. **Compliance**: Reconciliation is required for financial audits. Missing reconciliations = audit risk.
3. **Revenue Tracking**: Ensure all payments are properly recorded and linked to invoices.
4. **Customer Service**: Unreconciled payments affect customer account balances.

**Alert Thresholds**:
- **Warning**: >10 unreconciled payments OR reconciliation delay >1 hour
  - **Why**: Some payments not reconciled, needs attention
  - **Action**: Review unreconciled payments, check webhook processing, verify payment records
- **Critical**: >50 unreconciled payments OR reconciliation delay >24 hours
  - **Why**: Significant reconciliation backlog, financial accuracy risk
  - **Action**: Immediate investigation, check webhook processing, payment records, manual reconciliation

**What to Check**:
- Unreconciled payments count
- Webhook processing status
- Payment record completeness
- Invoice payment status
- Razorpay webhook delivery

---

### 8. Invoice Generation Timeliness

**What**: Time between billing period end and invoice generation

**Metrics**:
- `billing.invoice.generation.delay` (hours/days delay)
- `billing.invoice.generated.on_time` (on-time rate)

**Why Monitor**:
1. **Customer Experience**: Delayed invoices affect customer trust and satisfaction.
2. **Cash Flow**: Late invoices = delayed payments = cash flow issues.
3. **Compliance**: Timely billing is often required by contracts and regulations.
4. **System Health**: Delays indicate processing issues or capacity problems.

**Alert Thresholds**:
- **Warning**: >1 day delay
  - **Why**: Invoices not generated on time, needs attention
  - **Action**: Check invoice generation cron job, verify usage aggregates availability
- **Critical**: >3 days delay
  - **Why**: Significant billing delays, customer impact
  - **Action**: Immediate investigation, check cron job status, processing capacity

**What to Check**:
- Invoice generation cron job status
- Usage aggregates availability
- Invoice generation service health
- Processing capacity
- Billing period calculations

---

## Secondary Metrics

### 9. Idempotency Effectiveness

**What**: Rate of duplicate operations prevented

**Metrics**:
- `operations.idempotent_retries` (duplicate operations prevented)
- `operations.duplicate_rate` (percentage of duplicates)

**Why Monitor**:
- **Data Integrity**: High duplicate rate indicates client retry issues
- **System Efficiency**: Idempotency prevents unnecessary processing
- **Client Health**: High duplicate rate may indicate client-side issues

### 10. Usage Aggregation Rate

**What**: Rate of usage events aggregated into monthly aggregates

**Metrics**:
- `aggregation.events_aggregated` (events aggregated per hour)
- `aggregation.aggregation.duration` (aggregation latency)

**Why Monitor**:
- **Billing Accuracy**: Aggregation must complete before invoice generation
- **Processing Capacity**: Track aggregation throughput
- **Data Completeness**: Ensure all events are aggregated

### 11. D1 to RDS Migration Rate

**What**: Rate of events migrated from D1 to RDS

**Metrics**:
- `migration.events_migrated` (events migrated per run)
- `migration.migration.duration` (migration latency)
- `migration.failures` (migration failures)

**Why Monitor**:
- **Data Flow**: Migration must complete for events to be available in RDS
- **Storage Management**: Track D1 storage usage
- **Processing Health**: Migration failures indicate system issues

---

## Dashboard Recommendations

### Real-Time Dashboard

Display:
- Current ingestion rate (events/second)
- Current API request rate
- Current error rate
- Active alerts (critical/warning)
- System health status

### Business Dashboard

Display:
- Total revenue (by period)
- Invoices generated (by period)
- Payments processed (by period)
- Outstanding invoices
- Payment success rate

### Operations Dashboard

Display:
- Event ingestion rate and failures
- Billing operation success rate
- Payment processing success rate
- API latency (P50, P95, P99)
- Database operation success rate
- Queue processing rate

### Financial Dashboard

Display:
- Total revenue
- Outstanding invoices
- Payment reconciliation status
- Failed payment amount
- Invoice generation timeliness

---

## Alert Response Procedures

### Event Ingestion Failures

1. **Check D1 Status**: Verify D1 database is accessible
2. **Review Logs**: Check for specific error patterns
3. **Verify API Keys**: Check API key validation service
4. **Check Network**: Verify connectivity to D1
5. **Review Recent Changes**: Check for recent deployments

### Billing Failures

1. **Check Pricing Rules**: Verify pricing rules exist for all metrics
2. **Verify Aggregates**: Check usage aggregates are available
3. **Review Invoice Service**: Check invoice generation service health
4. **Check Database**: Verify RDS connectivity and query performance
5. **Review Errors**: Check specific failure reasons in logs

### Payment Failures

1. **Check Razorpay Status**: Verify Razorpay API is operational
2. **Review Webhooks**: Check webhook processing logs
3. **Verify Reconciliation**: Check payment reconciliation status
4. **Review Payment Records**: Verify payment records are created
5. **Check Database**: Verify transaction processing

---

## Best Practices

1. **Monitor Trends**: Track metrics over time, not just absolute values
2. **Set Baselines**: Establish normal operating ranges
3. **Correlate Metrics**: Use requestId to correlate logs and metrics
4. **Review Regularly**: Adjust thresholds based on historical data
5. **Document Runbooks**: Create runbooks for alert response
6. **Test Alerts**: Regularly test alerting to ensure it works
7. **Avoid Alert Fatigue**: Set thresholds appropriately
8. **Monitor Business Metrics**: Track revenue, invoices, payments
9. **Track SLAs**: Monitor against SLA targets
10. **Review Anomalies**: Investigate unusual patterns

---

## Metric Retention

- **Real-Time Metrics**: 24 hours (for dashboards)
- **Aggregated Metrics**: 90 days (for trend analysis)
- **Business Metrics**: 7 years (for financial compliance)
- **Logs**: 90 days (for debugging)
- **Audit Logs**: 7 years (for financial compliance)
