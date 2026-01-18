# Daily Operations

Daily operational tasks for the Metrics Billing Platform.

## Morning Checklist

### Health Check

```bash
curl https://your-worker.workers.dev/health
```

Expected: `{"status": "ok"}`

### Review Overnight Logs

```bash
wrangler tail --env production --since 8h
```

Look for:
- Errors
- Warnings
- Failed operations

### Check Cron Jobs

Verify cron jobs ran successfully:
- D1 to RDS migration (every 5 minutes)
- Reconciliation (daily at 2 AM UTC)
- D1 cleanup (daily at 3 AM UTC)
- Invoice generation (1st of month at 2 AM UTC)
- Payment retry (every 6 hours)
- Alert evaluation (every hour)
- Exchange rate sync (daily at 1 AM UTC)
- Payment reminders (daily at 9 AM UTC)

**Note**: Invoice templates are evaluated when PDFs are generated (on-demand or after invoice finalization). Email notifications are sent automatically when invoices are generated or payments are received.

## During the Day

### Monitor Metrics

- Event ingestion rate
- Error rate
- Payment success rate
- Payment retry rate
- Database performance

### Respond to Alerts

- Investigate errors
- Resolve issues
- Update status pages if needed

### Review Operations

- Check for failed operations
- Review payment processing
- Verify data integrity

## End of Day

### Review Daily Summary

- Events ingested
- Payments processed
- Errors encountered
- Performance metrics

### Document Issues

- Log any issues encountered
- Document resolutions
- Update runbooks if needed

## Weekly Tasks

- Review invoice generation results
- Check payment reconciliation
- Review payment retry success rate
- Review error trends
- Optimize performance
- Check for payments that reached max retries

## See Also

- [Operations Guide](./index) - Overview
- [Monitoring Guide](./monitoring) - Monitoring setup
- [Troubleshooting Guide](./troubleshooting) - Common issues
