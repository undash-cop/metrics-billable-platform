# Disaster Recovery

Recovery procedures for the Metrics Billing Platform.

## Backup Strategy

### Database Backups

- **Automated Backups**: RDS automated backups (daily)
- **Retention**: 7 days of daily backups
- **Point-in-Time Recovery**: Available for last 7 days

### Data Exports

Regular exports of critical data:
- Organisations and projects
- API keys (hashed)
- Pricing rules
- Invoice templates

## Recovery Procedures

### Database Recovery

1. **Identify Point in Time**
   - Determine last known good state
   - Check audit logs for corruption point

2. **Restore Database**
   ```bash
   # Restore from RDS snapshot
   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier new-instance \
     --db-snapshot-identifier snapshot-name
   ```

3. **Verify Data**
   - Check critical tables
   - Verify data integrity
   - Run reconciliation

4. **Update Connection Strings**
   - Update RDS_HOST in Cloudflare
   - Redeploy workers if needed

### Worker Recovery

1. **Redeploy Workers**
   ```bash
   wrangler deploy --env production
   ```

2. **Verify Deployment**
   - Check health endpoint
   - Test API endpoints
   - Verify cron jobs

### Queue Recovery

1. **Check Queue Status**
   - Review queue backlog
   - Check dead-letter queue

2. **Reprocess Messages**
   - Process DLQ messages
   - Verify processing

## Disaster Scenarios

### Complete Platform Failure

1. Restore database from backup
2. Redeploy workers
3. Verify all services
4. Run reconciliation jobs
5. Notify customers if needed

### Data Corruption

1. Identify corruption point
2. Restore from backup
3. Replay events if needed
4. Verify data integrity
5. Run reconciliation

### Payment Processing Failure

1. Check Razorpay status
2. Verify webhook configuration
3. Manually process payments if needed
4. Update payment statuses
5. Send payment confirmations

## Testing Recovery

### Regular Testing

- Test database restore monthly
- Test worker redeployment
- Verify backup integrity
- Document recovery procedures

### Recovery Time Objectives

- **RTO**: 4 hours (target recovery time)
- **RPO**: 1 hour (maximum data loss)

## Prevention

### Best Practices

1. Regular backups
2. Monitor system health
3. Test recovery procedures
4. Document procedures
5. Train team members

## See Also

- [Operations Guide](./index) - Daily operations
- [Monitoring Guide](./monitoring) - Monitoring setup
- [Troubleshooting Guide](./troubleshooting) - Common issues
