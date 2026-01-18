# Monitoring Guide

What to monitor and why for the Metrics Billing Platform.

## Key Metrics

### Event Ingestion

**Metrics:**
- Events ingested per second
- Event ingestion success rate
- Event ingestion latency

**Why Monitor:**
- Ensure platform can handle load
- Detect ingestion issues early
- Optimize performance

**Alert Thresholds:**
- Success rate < 95%
- Latency > 1 second
- Rate drops > 50%

### Invoice Generation

**Metrics:**
- Invoices generated per month
- Invoice generation success rate
- Invoice generation duration

**Why Monitor:**
- Ensure all customers are billed
- Detect generation failures
- Track billing cycle completion

**Alert Thresholds:**
- Success rate < 100%
- Duration > 5 minutes
- Any generation failures

### Payment Processing

**Metrics:**
- Payment success rate
- Payment processing latency
- Webhook processing success rate

**Why Monitor:**
- Ensure payments are processed
- Detect payment issues
- Track revenue collection

**Alert Thresholds:**
- Success rate < 90%
- Latency > 5 seconds
- Webhook failures

### Database Performance

**Metrics:**
- Database connection pool usage
- Query execution time
- Database CPU/memory usage

**Why Monitor:**
- Prevent connection exhaustion
- Optimize queries
- Ensure database health

**Alert Thresholds:**
- Pool usage > 80%
- Query time > 1 second
- CPU usage > 80%

## Logging

### Structured Logs

All logs are structured JSON:

```json
{
  "level": "info",
  "message": "Event ingested",
  "event_id": "event-001",
  "organisation_id": "org-uuid",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Log Levels

- **FATAL** - Critical errors requiring immediate attention
- **ERROR** - Errors that need investigation
- **WARN** - Warnings that may indicate issues
- **INFO** - Informational messages
- **DEBUG** - Debug information (development only)

## Alerting

### Critical Alerts

Set up alerts for:

1. **Platform Down**
   - Health check failures
   - High error rate

2. **Payment Failures**
   - Payment processing failures
   - Webhook failures

3. **Invoice Generation Failures**
   - Failed invoice generations
   - Missing invoices

4. **Database Issues**
   - Connection failures
   - High query latency

### Alert Channels

Configure alerts via:
- Cloudflare Workers alerts
- Database monitoring (CloudWatch/RDS)
- Custom alerting system

## Dashboards

### Recommended Dashboards

1. **Overview Dashboard**
   - Request rate
   - Error rate
   - Success rate

2. **Financial Dashboard**
   - Invoices generated
   - Payments processed
   - Revenue collected

3. **Performance Dashboard**
   - Response times
   - Database performance
   - Queue processing

## See Also

- [Operations Guide](./index) - Daily operations
- [Troubleshooting Guide](./troubleshooting) - Common issues
- [Disaster Recovery](./disaster-recovery) - Recovery procedures
