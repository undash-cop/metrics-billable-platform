# Operations Guide

Daily operations, monitoring, and troubleshooting for the Undash-cop Metrics Billing Platform.

**Copyright © 2026 Undash-cop Private Limited. All rights reserved.**

## Daily Operations

### Health Checks

Check platform health:

```bash
curl https://your-worker.workers.dev/health
```

Expected response: `{"status": "ok"}`

### Monitor Logs

```bash
wrangler tail --env production
```

### Check Metrics

- Cloudflare Dashboard → Workers → Your Worker → Metrics
- Monitor: Request count, error rate, CPU time, duration

## Weekly Operations

### Review Invoices

Check for failed invoice generations:

```bash
# Query database for invoices from last week
SELECT id, invoice_number, status, created_at
FROM invoices
WHERE created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

### Review Payments

Check payment reconciliation:

```bash
# Query database for payments
SELECT id, invoice_id, status, amount, created_at
FROM payments
WHERE created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

### Review Errors

Check error logs and failed operations:

```bash
# Check dead-letter queue
# Review Cloudflare Workers logs for errors
# Check reconciliation job results
```

## Monthly Operations

### Invoice Generation

- Cron job runs automatically on 1st of each month
- Verify all active organisations have invoices
- Check for failed generations
- Review invoice totals

### Reconciliation

- Daily reconciliation job runs automatically
- Review reconciliation reports
- Investigate discrepancies

### Database Maintenance

- Review database performance
- Check index usage
- Review query performance
- Consider VACUUM if needed

## Monitoring

### Key Metrics

Monitor these metrics:

1. **Event Ingestion Rate**
   - Target: < 1000 events/second
   - Alert if: Rate drops significantly

2. **Error Rate**
   - Target: < 1% errors
   - Alert if: Error rate > 5%

3. **Payment Success Rate**
   - Target: > 95%
   - Alert if: Success rate < 90%

4. **Invoice Generation Success**
   - Target: 100% success
   - Alert if: Any failures

5. **Database Connection Pool**
   - Target: < 80% utilization
   - Alert if: Pool exhausted

### Alerting

Set up alerts for:

- High error rates
- Failed cron jobs
- Payment processing failures
- Database connection issues
- Queue backlog

## Troubleshooting

### Common Issues

See [Troubleshooting Guide](./troubleshooting) for common issues and solutions.

### Emergency Procedures

1. **Platform Down**
   - Check Cloudflare Workers status
   - Verify database connectivity
   - Review recent deployments

2. **Payment Processing Issues**
   - Check Razorpay status
   - Verify webhook configuration
   - Review payment logs

3. **Data Integrity Issues**
   - Run reconciliation jobs
   - Review audit logs
   - Check for duplicate records

## Disaster Recovery

See [Disaster Recovery Guide](./disaster-recovery) for recovery procedures.

## See Also

- [Monitoring Guide](./monitoring) - Detailed monitoring setup
- [Troubleshooting Guide](./troubleshooting) - Common issues and solutions
- [Disaster Recovery](./disaster-recovery) - Recovery procedures
