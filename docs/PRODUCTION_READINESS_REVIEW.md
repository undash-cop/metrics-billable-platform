# Production Readiness Review

## Executive Summary

This document identifies the top 10 production risks for the metrics-based billing platform, categorized by:
- Data Loss Scenarios
- Double Billing Risks
- Payment Reconciliation Issues
- Cost Risks
- Security Risks

Each risk includes severity, impact, likelihood, and specific mitigations.

---

## Top 10 Production Risks

### 1. **CRITICAL: D1 to RDS Migration Data Loss**

**Category**: Data Loss  
**Severity**: CRITICAL  
**Impact**: Permanent loss of usage events = lost revenue  
**Likelihood**: Medium (cron failures, RDS outages, partial batch failures)

**Risk Description**:
- If migration cron fails partway through a batch, events may be marked as processed in D1 but not inserted into RDS
- RDS connection failures during migration could cause data loss
- D1 storage limits could cause events to be purged before migration
- No reconciliation mechanism to detect missing events

**Current Mitigations**:
- ✅ `ON CONFLICT DO NOTHING` prevents duplicates
- ✅ Only marks events as processed after successful RDS insert
- ✅ Batch processing with configurable limits

**Gaps**:
- ❌ No reconciliation job to detect missing events
- ❌ No alerting on migration failures
- ❌ No dead-letter queue for failed migrations
- ❌ D1 events can be purged before migration completes

**Recommended Mitigations**:
1. **Add reconciliation job**: Daily job comparing D1 vs RDS event counts by organisation/project/metric
2. **Implement dead-letter queue**: Failed events go to DLQ for manual review
3. **Add alerting**: Alert on migration failures, skipped events > threshold, processing lag
4. **D1 retention policy**: Keep events in D1 for 7 days after `processed_at` before purging
5. **Add idempotency check**: Before marking processed, verify event exists in RDS
6. **Add metrics**: Track migration success rate, lag time, failed batches

---

### 2. **CRITICAL: Duplicate Invoice Generation**

**Category**: Double Billing  
**Severity**: CRITICAL  
**Impact**: Customers billed multiple times for same period = customer trust loss, refunds  
**Likelihood**: Medium (concurrent invoice generation, retry logic)

**Risk Description**:
- No idempotency check before generating invoice for month/year
- Concurrent invoice generation requests could create duplicate invoices
- Retry logic could generate multiple invoices for same period
- No database constraint preventing duplicate invoices per organisation/month/year

**Current Mitigations**:
- ✅ Invoice status workflow (draft → finalized → paid)
- ✅ Invoice immutability triggers prevent modification after finalization

**Gaps**:
- ❌ No unique constraint on `(organisation_id, month, year)` in invoices table
- ❌ No idempotency key for invoice generation
- ❌ No check for existing invoice before generation
- ❌ Race condition: Two concurrent requests could both pass "no invoice exists" check

**Recommended Mitigations**:
1. **Add unique constraint**: `CREATE UNIQUE INDEX idx_invoices_org_month_year ON invoices(organisation_id, month, year) WHERE status != 'cancelled'`
2. **Add idempotency check**: Use `withIdempotency` wrapper with key `invoice_{orgId}_{year}_{month}`
3. **Check before generate**: Query for existing invoice before calculation
4. **Add transaction**: Wrap invoice generation in transaction with row-level lock
5. **Add alerting**: Alert on duplicate invoice attempts

---

### 3. **CRITICAL: Payment Webhook Loss or Duplication**

**Category**: Payment Reconciliation  
**Severity**: CRITICAL  
**Impact**: Payments not recorded = lost revenue, duplicate payments = refunds  
**Likelihood**: Medium (webhook delivery failures, retries, signature verification failures)

**Risk Description**:
- Razorpay webhook delivery failures (network issues, timeouts)
- Webhook signature verification failures could reject valid payments
- Duplicate webhook deliveries could create duplicate payment records
- No reconciliation mechanism to detect missing payments

**Current Mitigations**:
- ✅ Idempotency key: `razorpay_payment_{payment_id}` prevents duplicates
- ✅ Signature verification before processing
- ✅ Atomic transaction for payment + invoice status update
- ✅ Unique constraint on `razorpay_payment_id`

**Gaps**:
- ❌ No reconciliation job to detect missing payments
- ❌ No alerting on webhook failures
- ❌ No manual payment reconciliation UI
- ❌ Webhook failures return 500, causing Razorpay to retry (good) but no alerting
- ❌ No fallback: If webhook fails, payment is lost until manual reconciliation

**Recommended Mitigations**:
1. **Add reconciliation job**: Daily job comparing Razorpay orders vs our payment records
2. **Add alerting**: Alert on webhook failures, signature verification failures, unreconciled payments
3. **Add manual reconciliation**: Admin UI to manually create payment records from Razorpay dashboard
4. **Add webhook retry logic**: Exponential backoff for transient failures
5. **Add payment status sync**: Periodic job to sync payment status from Razorpay API
6. **Add metrics**: Track webhook success rate, reconciliation lag, unreconciled payments

---

### 4. **HIGH: API Key Exposure and Unauthorized Access**

**Category**: Security  
**Severity**: HIGH  
**Impact**: Unauthorized usage ingestion = incorrect billing, data breach  
**Likelihood**: Medium (API key leaks, weak validation, missing rate limiting)

**Risk Description**:
- API keys stored in plaintext in D1 cache (`projects_cache` table)
- API key validation falls back to RDS but no rate limiting
- No API key rotation mechanism
- No detection of API key compromise
- Admin endpoints may not have proper authentication

**Current Mitigations**:
- ✅ API keys hashed in RDS (`api_key_hash`)
- ✅ D1 cache for fast validation
- ✅ Project-level access control

**Gaps**:
- ❌ API keys stored in plaintext in D1 cache (line 149 in `api-key-validation.ts`)
- ❌ No rate limiting on `/events` endpoint
- ❌ No API key rotation mechanism
- ❌ No detection of unusual API key usage patterns
- ❌ Admin endpoints use placeholder authentication (`userId: 'admin'`)

**Recommended Mitigations**:
1. **Hash API keys in D1**: Store `api_key_hash` in D1 cache, not plaintext
2. **Add rate limiting**: Cloudflare rate limiting or Workers rate limiting
3. **Add API key rotation**: Allow regeneration with grace period for old keys
4. **Add anomaly detection**: Alert on unusual usage patterns (new IPs, sudden spikes)
5. **Implement proper admin auth**: JWT tokens, API keys, or OAuth for admin endpoints
6. **Add audit logging**: Log all API key usage for security monitoring

---

### 5. **HIGH: D1 Storage Cost Explosion**

**Category**: Cost  
**Severity**: HIGH  
**Impact**: Unbounded D1 storage costs as events accumulate  
**Likelihood**: High (no retention policy, events never purged)

**Risk Description**:
- Events stored in D1 indefinitely
- No automatic purging of processed events
- D1 storage costs scale linearly with event volume
- Migration failures could cause events to accumulate in D1

**Current Mitigations**:
- ✅ Migration marks events as processed
- ✅ Batch processing limits memory usage

**Gaps**:
- ❌ No automatic purging of processed events
- ❌ No retention policy (e.g., delete after 7 days)
- ❌ No monitoring of D1 storage usage
- ❌ No alerting on storage thresholds

**Recommended Mitigations**:
1. **Add retention policy**: Delete events older than 7 days with `processed_at` set
2. **Add cleanup cron**: Daily job to purge old events
3. **Add storage monitoring**: Track D1 storage usage and alert on thresholds
4. **Add cost alerts**: Alert when D1 storage exceeds budget
5. **Add event archiving**: Archive old events to cold storage (S3) before deletion

---

### 6. **HIGH: RDS Connection Pool Exhaustion**

**Category**: Cost / Availability  
**Severity**: HIGH  
**Impact**: Service unavailability, failed requests, data loss  
**Likelihood**: Medium (high concurrency, connection leaks, pool misconfiguration)

**Risk Description**:
- High concurrency on `/events` endpoint could exhaust RDS connection pool
- Connection leaks if transactions not properly closed
- No connection pool monitoring
- No circuit breaker for RDS failures

**Current Mitigations**:
- ✅ Connection pool via `pg.Pool`
- ✅ Transactions properly release connections (`finally` block)

**Gaps**:
- ❌ No connection pool size configuration
- ❌ No connection pool monitoring
- ❌ No circuit breaker for RDS failures
- ❌ No fallback if RDS is unavailable (API key validation fails)

**Recommended Mitigations**:
1. **Configure pool size**: Set `max` connections based on expected load
2. **Add connection monitoring**: Track pool usage, wait times, connection errors
3. **Add circuit breaker**: Fail fast if RDS is down, use cached data
4. **Add fallback**: Use D1 cache exclusively if RDS unavailable
5. **Add alerting**: Alert on pool exhaustion, high wait times, connection errors
6. **Add health checks**: Periodic RDS health checks

---

### 7. **MEDIUM: Queue Processing Failures**

**Category**: Data Loss  
**Severity**: MEDIUM  
**Impact**: Events not aggregated = missing usage data = incorrect invoices  
**Likelihood**: Medium (queue consumer failures, processing errors)

**Risk Description**:
- Queue consumer failures could cause events to be lost
- No dead-letter queue for failed messages
- No retry logic with exponential backoff
- No monitoring of queue depth or processing lag

**Current Mitigations**:
- ✅ Queue publishing is non-blocking (doesn't fail request)
- ✅ Events stored in D1 before queue publishing

**Gaps**:
- ❌ No dead-letter queue for failed messages
- ❌ No retry logic for failed processing
- ❌ No monitoring of queue depth
- ❌ No alerting on queue processing failures

**Recommended Mitigations**:
1. **Add dead-letter queue**: Failed messages go to DLQ for manual review
2. **Add retry logic**: Exponential backoff for transient failures
3. **Add queue monitoring**: Track queue depth, processing rate, failures
4. **Add alerting**: Alert on queue depth > threshold, processing failures
5. **Add metrics**: Track queue processing success rate, lag time

---

### 8. **MEDIUM: Invoice Calculation Errors**

**Category**: Double Billing / Data Loss  
**Severity**: MEDIUM  
**Impact**: Incorrect invoices = customer disputes, refunds, lost trust  
**Likelihood**: Low (well-tested calculation logic, but edge cases exist)

**Risk Description**:
- Pricing rule lookup failures could skip billable metrics
- Minimum charge calculation errors
- Tax calculation errors
- Decimal precision errors (though using Decimal.js)
- Race condition: Pricing rules change during invoice generation

**Current Mitigations**:
- ✅ Decimal.js for precise calculations
- ✅ Pure calculation functions (testable)
- ✅ Pricing rule lookup with fallback

**Gaps**:
- ❌ No validation of invoice totals vs line items
- ❌ No audit trail of pricing rules used
- ❌ No alerting on calculation errors
- ❌ No reconciliation of calculated vs persisted amounts

**Recommended Mitigations**:
1. **Add validation**: Verify `total = subtotal + tax - discount` before persistence
2. **Add audit trail**: Store pricing rules used in invoice metadata
3. **Add alerting**: Alert on calculation errors, validation failures
4. **Add reconciliation**: Compare calculated vs persisted amounts
5. **Add unit tests**: Comprehensive test coverage for edge cases

---

### 9. **MEDIUM: Missing Usage Aggregates**

**Category**: Data Loss  
**Severity**: MEDIUM  
**Impact**: Missing usage data = incorrect invoices = lost revenue  
**Likelihood**: Medium (aggregation failures, race conditions, partial failures)

**Risk Description**:
- Queue consumer failures could prevent aggregation
- Race condition: Events ingested after aggregation completes
- No reconciliation of events vs aggregates
- Aggregation could fail silently

**Current Mitigations**:
- ✅ Aggregation uses transactions
- ✅ Upsert logic prevents duplicates

**Gaps**:
- ❌ No reconciliation job to detect missing aggregates
- ❌ No alerting on aggregation failures
- ❌ No retry logic for failed aggregations
- ❌ Race condition: Events ingested during aggregation window

**Recommended Mitigations**:
1. **Add reconciliation job**: Compare event counts vs aggregate totals
2. **Add alerting**: Alert on aggregation failures, missing aggregates
3. **Add retry logic**: Retry failed aggregations with exponential backoff
4. **Add aggregation window**: Process events from previous hour (avoid race conditions)
5. **Add metrics**: Track aggregation success rate, lag time, missing aggregates

---

### 10. **LOW: Admin API Security Gaps**

**Category**: Security  
**Severity**: LOW (but could escalate)  
**Impact**: Unauthorized access to financial data, data breaches  
**Likelihood**: Low (admin endpoints not publicly exposed, but placeholder auth)

**Risk Description**:
- Admin endpoints use placeholder authentication (`userId: 'admin'`)
- No rate limiting on admin endpoints
- No audit logging of admin actions
- No authorization checks (any authenticated user can access any organisation)

**Current Mitigations**:
- ✅ Organisation-level access control (`checkOrganisationAccess`)
- ✅ Read-only enforcement for financial data

**Gaps**:
- ❌ Placeholder authentication (`userId: 'admin'`)
- ❌ No rate limiting
- ❌ No audit logging of admin actions
- ❌ No role-based access control (RBAC)

**Recommended Mitigations**:
1. **Implement proper auth**: JWT tokens, API keys, or OAuth
2. **Add rate limiting**: Prevent brute force attacks
3. **Add audit logging**: Log all admin actions (who, what, when)
4. **Add RBAC**: Role-based access control (admin, viewer, etc.)
5. **Add IP whitelisting**: Restrict admin endpoints to known IPs
6. **Add 2FA**: Two-factor authentication for admin access

---

## Risk Summary Matrix

| Risk | Severity | Impact | Likelihood | Priority |
|------|----------|--------|------------|----------|
| D1 to RDS Migration Data Loss | CRITICAL | Lost revenue | Medium | P0 |
| Duplicate Invoice Generation | CRITICAL | Customer trust loss | Medium | P0 |
| Payment Webhook Loss/Duplication | CRITICAL | Lost revenue | Medium | P0 |
| API Key Exposure | HIGH | Data breach | Medium | P1 |
| D1 Storage Cost Explosion | HIGH | Cost overrun | High | P1 |
| RDS Connection Pool Exhaustion | HIGH | Service unavailability | Medium | P1 |
| Queue Processing Failures | MEDIUM | Missing usage data | Medium | P2 |
| Invoice Calculation Errors | MEDIUM | Customer disputes | Low | P2 |
| Missing Usage Aggregates | MEDIUM | Lost revenue | Medium | P2 |
| Admin API Security Gaps | LOW | Data breach | Low | P3 |

---

## Recommended Implementation Priority

### Phase 1 (P0 - Critical - Immediate)
1. Add unique constraint on invoices (organisation_id, month, year)
2. Add idempotency check for invoice generation
3. Add reconciliation job for D1 vs RDS events
4. Add reconciliation job for Razorpay payments
5. Add alerting for migration failures, webhook failures, duplicate invoices

### Phase 2 (P1 - High - Week 1)
1. Hash API keys in D1 cache
2. Add rate limiting on `/events` endpoint
3. Add D1 retention policy and cleanup cron
4. Configure RDS connection pool size
5. Add connection pool monitoring

### Phase 3 (P2 - Medium - Week 2-3)
1. Add dead-letter queue for failed queue messages
2. Add retry logic for queue processing
3. Add reconciliation job for usage aggregates
4. Add validation for invoice calculations
5. Add audit trail for pricing rules

### Phase 4 (P3 - Low - Month 2)
1. Implement proper admin authentication
2. Add audit logging for admin actions
3. Add RBAC for admin endpoints
4. Add IP whitelisting for admin endpoints

---

## Monitoring and Alerting Requirements

### Critical Alerts (P0)
- D1 to RDS migration failures
- Duplicate invoice generation attempts
- Payment webhook failures
- Unreconciled payments > threshold
- Missing events in RDS reconciliation

### High Priority Alerts (P1)
- D1 storage usage > 80% threshold
- RDS connection pool exhaustion
- API key validation failures > threshold
- High API error rate

### Medium Priority Alerts (P2)
- Queue depth > threshold
- Aggregation failures
- Invoice calculation errors
- Missing usage aggregates

---

## Testing Recommendations

### Load Testing
- Test `/events` endpoint under high concurrency
- Test D1 to RDS migration with large batches
- Test invoice generation under concurrent requests
- Test RDS connection pool under load

### Chaos Testing
- Simulate RDS failures during migration
- Simulate queue processing failures
- Simulate webhook delivery failures
- Simulate D1 storage exhaustion

### Integration Testing
- Test end-to-end flow: Event → Aggregate → Invoice → Payment
- Test idempotency across all operations
- Test reconciliation jobs
- Test error recovery scenarios

---

## Conclusion

The platform has a solid foundation with good idempotency patterns, transaction handling, and separation of concerns. However, several critical gaps need to be addressed before production:

1. **Data Loss Prevention**: Add reconciliation jobs and alerting
2. **Double Billing Prevention**: Add unique constraints and idempotency checks
3. **Payment Reconciliation**: Add reconciliation jobs and manual reconciliation UI
4. **Security**: Fix API key storage, add proper admin auth
5. **Cost Control**: Add retention policies and monitoring

Priority should be given to P0 risks (data loss, double billing, payment reconciliation) before launch.
