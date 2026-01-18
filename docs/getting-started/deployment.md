# Deployment

Deploy the Metrics Billing Platform to production.

## Prerequisites

- Cloudflare account with Workers enabled
- Amazon RDS PostgreSQL instance
- Razorpay account (for payments)
- Email provider account (SendGrid/Resend/AWS SES) - optional

## Step 1: Database Setup

### Create RDS PostgreSQL Instance

1. Create a PostgreSQL instance on AWS RDS
2. Note the endpoint, port, database name, username, and password
3. Ensure the instance is accessible from Cloudflare Workers (public IP or VPC)

### Run Migrations

Apply all database migrations:

```bash
# Set database connection variables
export RDS_HOST=your-rds-endpoint.aws.com
export RDS_PORT=5432
export RDS_DATABASE=your_database_name
export RDS_USER=your_username
export RDS_PASSWORD=your_password
export RDS_SSL=true

# Run migrations
npm run db:migrate:rds
```

### Verify Schema

Connect to your database and verify tables were created:

```sql
\dt  -- List all tables
SELECT COUNT(*) FROM organisations;
```

## Step 2: Cloudflare Setup

### Create D1 Database

```bash
wrangler d1 create metrics-billable-events-prod
```

Note the `database_id` and update `wrangler.toml`:

```toml
[env.production.d1_databases]
binding = "EVENTS_DB"
database_name = "metrics-billable-events-prod"
database_id = "your-d1-database-id"
```

### Run D1 Migrations

```bash
npm run db:migrate:d1:remote -- --env production
```

### Create Queues

```bash
wrangler queue create usage-events --env production
wrangler queue create usage-events-dlq --env production
```

## Step 3: Configure Secrets

Set all required secrets in Cloudflare:

```bash
# Database
wrangler secret put RDS_HOST --env production
wrangler secret put RDS_PORT --env production
wrangler secret put RDS_DATABASE --env production
wrangler secret put RDS_USER --env production
wrangler secret put RDS_PASSWORD --env production
wrangler secret put RDS_SSL --env production

# Razorpay
wrangler secret put RAZORPAY_KEY_ID --env production
wrangler secret put RAZORPAY_KEY_SECRET --env production
wrangler secret put RAZORPAY_WEBHOOK_SECRET --env production

# Application
wrangler secret put ENVIRONMENT --env production
wrangler secret put TAX_RATE --env production
wrangler secret put DEFAULT_CURRENCY --env production

# Admin API (optional)
wrangler secret put ADMIN_API_KEY --env production
wrangler secret put ADMIN_IP_WHITELIST --env production

# Email (optional)
wrangler secret put SENDGRID_API_KEY --env production
wrangler secret put EMAIL_FROM --env production
wrangler secret put EMAIL_FROM_NAME --env production

# Payment retry (optional)
wrangler secret put PAYMENT_RETRY_ENABLED --env production
wrangler secret put PAYMENT_RETRY_MAX_RETRIES --env production
wrangler secret put PAYMENT_RETRY_BASE_INTERVAL_HOURS --env production
```

## Step 4: Deploy Workers

Deploy to production:

```bash
npm run deploy:prod
```

Or manually:

```bash
wrangler deploy --env production
```

## Step 5: Configure Razorpay Webhook

1. Go to Razorpay Dashboard → Settings → Webhooks
2. Add webhook URL: `https://your-worker.workers.dev/webhooks/razorpay`
3. Select events:
   - `payment.captured` - Payment successful
   - `payment.failed` - Payment failed
   - `refund.processed` - Refund processed (for refund handling)
   - `refund.failed` - Refund failed (for refund handling)
4. Copy the webhook secret and set it as `RAZORPAY_WEBHOOK_SECRET`

## Step 6: Create Admin User

Create your first admin user in the database:

```sql
-- Insert admin user
INSERT INTO admin_users (email, role, permissions)
VALUES ('admin@yourcompany.com', 'admin', '["read", "write", "admin"]'::jsonb)
RETURNING id;

-- Generate API key hash
-- Use: npm run hash-key "your-secret-api-key"

-- Insert API key
INSERT INTO admin_api_keys (user_id, key_hash, name)
VALUES ('<user-id-from-above>', '<hashed-key>', 'Initial Admin Key');
```

## Step 7: Verify Deployment

### Health Check

```bash
curl https://your-worker.workers.dev/health
```

Expected response:
```json
{"status": "ok"}
```

### Test Admin API

```bash
curl https://your-worker.workers.dev/api/v1/admin/organisations \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

### Test Event Ingestion

```bash
curl -X POST https://your-worker.workers.dev/api/v1/events \
  -H "Authorization: Bearer YOUR_PROJECT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-001",
    "metric_name": "test_metric",
    "metric_value": 1,
    "unit": "count"
  }'
```

## Step 8: Monitor Deployment

### Check Logs

```bash
wrangler tail --env production
```

### Monitor Metrics

- Cloudflare Dashboard → Workers → Your Worker → Metrics
- Check request count, error rate, CPU time

### Set Up Alerts

Configure alerts for:
- High error rates
- Failed cron jobs
- Payment processing failures
- Database connection issues

## Post-Deployment Checklist

- [ ] Database migrations applied
- [ ] D1 database created and migrated
- [ ] Queues created
- [ ] All secrets configured
- [ ] Workers deployed
- [ ] Razorpay webhook configured
- [ ] Admin user created
- [ ] Health check passing
- [ ] Test event ingested successfully
- [ ] Monitoring configured
- [ ] Alerts configured

## Rollback Plan

If deployment fails:

1. **Rollback Workers**:
   ```bash
   wrangler rollback --env production
   ```

2. **Check Logs**:
   ```bash
   wrangler tail --env production
   ```

3. **Verify Database**:
   - Check connection settings
   - Verify migrations
   - Check table existence

4. **Revert Secrets**:
   - Update secrets via Cloudflare Dashboard
   - Redeploy if needed

## Production Best Practices

### Security

- Use strong, unique API keys
- Enable IP whitelisting for admin API
- Rotate secrets regularly
- Monitor for suspicious activity

### Performance

- Monitor request latency
- Set up rate limiting
- Optimize database queries
- Use connection pooling

### Reliability

- Set up monitoring and alerting
- Regular database backups
- Test disaster recovery procedures
- Document runbooks

### Cost Optimization

- Monitor Cloudflare Workers usage
- Optimize database queries
- Clean up old D1 data regularly
- Review pricing plans

## Troubleshooting

See the [Operations Guide](/operations/) for:
- Daily operations
- Monitoring setup
- Troubleshooting common issues
- Disaster recovery

## Next Steps

- [First Steps](./first-steps) - Create your first organisation and project
- [Operations Guide](/operations/) - Daily operations and monitoring
- [API Reference](/api/) - Complete API documentation
