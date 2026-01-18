# Troubleshooting Guide

Common issues and solutions for the Metrics Billing Platform.

## Event Ingestion Issues

### Events Not Being Accepted

**Symptoms:**
- 401 Unauthorized errors
- Events not appearing in usage aggregates

**Solutions:**
1. Verify API key is correct
2. Check API key is active
3. Verify project is active
4. Check rate limits

### Duplicate Events

**Symptoms:**
- Same event processed multiple times

**Solutions:**
1. Ensure `event_id` is unique
2. Check idempotency is working
3. Review event ingestion logs

## Payment Issues

### Payment Not Processing

**Symptoms:**
- Payment order created but not captured
- Webhook not received

**Solutions:**
1. Check Razorpay webhook configuration
2. Verify webhook secret is correct
3. Check webhook logs
4. Verify invoice is finalized

### Payment Status Not Updating

**Symptoms:**
- Payment completed but status not updated

**Solutions:**
1. Check webhook processing logs
2. Verify webhook signature verification
3. Check database for payment record
4. Manually trigger reconciliation

## Invoice Issues

### Invoice Not Generated

**Symptoms:**
- Cron job ran but no invoice created

**Solutions:**
1. Check cron job logs
2. Verify organisation is active
3. Check for usage aggregates
4. Review error logs

### Invoice Calculation Errors

**Symptoms:**
- Invoice total doesn't match expected

**Solutions:**
1. Review pricing rules
2. Check usage aggregates
3. Verify tax calculation
4. Review invoice line items

## Database Issues

### Connection Errors

**Symptoms:**
- Database connection failures
- Timeout errors

**Solutions:**
1. Check RDS instance status
2. Verify connection string
3. Check security groups
4. Review connection pool settings

### Performance Issues

**Symptoms:**
- Slow queries
- Timeout errors

**Solutions:**
1. Review query performance
2. Check index usage
3. Optimize slow queries
4. Consider connection pooling

## Email Issues

### Emails Not Sending

**Symptoms:**
- Invoice emails not received
- Payment emails not received

**Solutions:**
1. Check email provider configuration
2. Verify email provider API key
3. Check email tracking table
4. Review email service logs

### Email Delivery Failures

**Symptoms:**
- Emails marked as failed

**Solutions:**
1. Check recipient email address
2. Verify email provider status
3. Check email provider logs
4. Review error messages

## API Issues

### Authentication Errors

**Symptoms:**
- 401 Unauthorized errors

**Solutions:**
1. Verify API key format
2. Check API key is active
3. Verify organisation access
4. Check permissions

### Rate Limit Errors

**Symptoms:**
- 429 Too Many Requests

**Solutions:**
1. Reduce request rate
2. Implement exponential backoff
3. Check rate limit headers
4. Consider request batching

## Monitoring Issues

### Metrics Not Appearing

**Symptoms:**
- Metrics not showing in dashboard

**Solutions:**
1. Check metrics collection
2. Verify metric names
3. Check time range
4. Review aggregation logic

## Getting Help

If you're unable to resolve an issue:

1. Check logs: `wrangler tail --env production`
2. Review error messages
3. Check database for data issues
4. Review audit logs
5. Contact support with:
   - Error messages
   - Log excerpts
   - Steps to reproduce
   - Timestamps

## Payment Retry Issues

### Payment Not Retrying

**Symptoms**: Failed payment not being retried automatically

**Possible Causes**:
1. Payment retry disabled
2. Max retries reached
3. Next retry time not reached
4. Cron job not running

**Solutions**:
1. Check `PAYMENT_RETRY_ENABLED` environment variable
2. Check payment retry status via API
3. Verify cron job is running (`0 */6 * * *`)
4. Check cron job logs

### Retry Creating Duplicate Orders

**Symptoms**: Multiple Razorpay orders created for same invoice

**Possible Causes**:
1. Race condition in retry logic
2. Manual retry while automatic retry pending

**Solutions**:
1. Check retry history for duplicate attempts
2. Verify idempotency in order creation
3. Use manual retry only when needed

## Alert Issues

### Alerts Not Triggering

**Symptoms**: Alert rules configured but no alerts received

**Possible Causes**:
1. Alert rule is inactive
2. Cooldown period not expired
3. Threshold not met
4. Cron job not running

**Solutions**:
1. Check alert rule `isActive` status
2. Check alert history for last trigger time
3. Verify threshold values and operators
4. Check cron job logs (`0 * * * *`)

### Too Many Alerts

**Symptoms**: Receiving too many alert notifications

**Possible Causes**:
1. Cooldown period too short
2. Threshold too sensitive
3. Multiple alert rules for same metric

**Solutions**:
1. Increase `cooldownMinutes` in alert rule
2. Adjust threshold values
3. Review and consolidate duplicate alert rules

### Alert Notifications Not Sending

**Symptoms**: Alerts triggered but notifications not received

**Possible Causes**:
1. Email not configured
2. Webhook URL invalid
3. Notification service error

**Solutions**:
1. Check organisation billing email
2. Verify webhook URL is accessible
3. Check alert history for error messages
4. Review notification service logs

## See Also

- [Operations Guide](./index) - Daily operations
- [Monitoring Guide](./monitoring) - Monitoring setup
- [Disaster Recovery](./disaster-recovery) - Recovery procedures
