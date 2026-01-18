# Deployment Guide

## Pre-Deployment Checklist

### 1. Database Setup

#### RDS PostgreSQL
- [ ] RDS instance created and accessible
- [ ] Database created
- [ ] Connection credentials ready
- [ ] SSL enabled (recommended)

#### Cloudflare D1
- [ ] D1 database created
- [ ] Database ID noted
- [ ] Bindings configured in `wrangler.toml`

#### Cloudflare Queues
- [ ] Queue created: `usage-events`
- [ ] Dead-letter queue created: `usage-events-dlq` (optional)
- [ ] Bindings configured in `wrangler.toml`

---

### 2. Run Database Migrations

#### Step 1: Initial Schema
```bash
psql $DATABASE_URL -f migrations/rds/001_initial_schema.sql
```

#### Step 2: Comprehensive Schema
```bash
psql $DATABASE_URL -f migrations/rds/002_comprehensive_schema.sql
```

#### Step 3: D1 Migration SQL (for reference)
```bash
# Note: D1 migrations are run via wrangler
wrangler d1 migrations apply EVENTS_DB
```

#### Step 4: Billing Engine Tables
```bash
psql $DATABASE_URL -f migrations/rds/004_billing_engine_tables.sql
```

#### Step 5: Production Readiness Fixes
```bash
psql $DATABASE_URL -f migrations/rds/005_production_readiness_fixes.sql
```

#### Step 6: Admin Security
```bash
psql $DATABASE_URL -f migrations/rds/006_admin_security.sql
```

**Verify migrations:**
```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Should see: admin_users, admin_api_keys, admin_action_logs,
-- d1_rds_reconciliation, payment_reconciliation, etc.
```

---

### 3. D1 Migrations

```bash
# Apply D1 migrations
wrangler d1 migrations apply EVENTS_DB --remote

# Verify tables
wrangler d1 execute EVENTS_DB --command "SELECT name FROM sqlite_master WHERE type='table';"
```

---

### 4. Configure Environment Variables

Create `.dev.vars` for local development:
```bash
# Environment
ENVIRONMENT=development

# RDS Connection
RDS_HOST=your-rds-host.rds.amazonaws.com
RDS_PORT=5432
RDS_DATABASE=metrics_billing
RDS_USER=postgres
RDS_PASSWORD=your-password
RDS_SSL=true

# Razorpay
RAZORPAY_KEY_ID=your-key-id
RAZORPAY_KEY_SECRET=your-key-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret

# Application Config
TAX_RATE=0.18
DEFAULT_CURRENCY=INR

# Migration Config
MIGRATION_BATCH_SIZE=1000
MIGRATION_MAX_BATCHES=10

# Admin Authentication
ADMIN_API_KEY=your-secret-admin-api-key

# Optional: IP Whitelist
ADMIN_IP_WHITELIST=127.0.0.1,::1
```

Set in Cloudflare Dashboard for production:
- Go to Workers & Pages → Your Worker → Settings → Variables
- Add all environment variables
- Mark sensitive variables as "Encrypted"

---

### 5. Update wrangler.toml

```toml
name = "metrics-billable-platform"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[triggers]
crons = [
  "*/5 * * * *",  # D1 to RDS migration
  "0 2 * * *",    # Reconciliation
  "0 3 * * *"     # D1 cleanup
]

[[d1_databases]]
binding = "EVENTS_DB"
database_name = "metrics-billable-events"
database_id = "your-d1-database-id"  # Update this

[[queues.producers]]
queue = "usage-events"
binding = "USAGE_EVENTS_QUEUE"

[[queues.consumers]]
queue = "usage-events"
max_batch_size = 100
max_batch_timeout = 30

# Optional: Dead-letter queue
[[queues.producers]]
queue = "usage-events-dlq"
binding = "USAGE_EVENTS_DLQ"
```

---

### 6. Create Admin Users

#### Option 1: Using SQL (Recommended)

```sql
-- Create admin user
INSERT INTO admin_users (email, role, permissions, organisation_id)
VALUES (
  'admin@yourcompany.com',
  'admin',
  '["read", "write", "admin"]'::jsonb,
  NULL  -- NULL = can access all organisations
)
RETURNING id;

-- Note the user ID, then create API key
-- Hash the API key first (use your application or: echo -n "your-api-key" | sha256sum)
INSERT INTO admin_api_keys (user_id, key_hash, name, expires_at)
VALUES (
  'user-uuid-from-above',
  'hashed-api-key-here',  -- SHA-256 hash
  'Production API Key',
  NULL  -- NULL = never expires
);
```

#### Option 2: Using Environment Variable

For simple deployments, set `ADMIN_API_KEY` environment variable:
```bash
export ADMIN_API_KEY=your-secret-admin-api-key
```

This creates a default admin user with full access.

---

### 7. Deploy Workers

#### Development
```bash
# Deploy to development
wrangler deploy

# Test locally
wrangler dev
```

#### Production
```bash
# Deploy to production
wrangler deploy --env production

# Verify deployment
wrangler tail --env production
```

---

### 8. Verify Deployment

#### Check Cron Jobs
```bash
# View cron triggers
wrangler cron list

# Check cron execution logs
wrangler tail --env production | grep "cron"
```

#### Test Endpoints

**Health Check:**
```bash
curl https://your-worker.workers.dev/health
```

**Admin API (with authentication):**
```bash
curl -X GET https://your-worker.workers.dev/api/v1/admin/organisations \
  -H "Authorization: Bearer your-admin-api-key"
```

**Event Ingestion:**
```bash
curl -X POST https://your-worker.workers.dev/events \
  -H "Authorization: Bearer your-project-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-123",
    "metric_name": "api_calls",
    "metric_value": 1,
    "unit": "count"
  }'
```

---

### 9. Set Up Monitoring

#### Cloudflare Analytics
- Go to Workers & Pages → Your Worker → Analytics
- Monitor: Requests, Errors, CPU Time, Duration

#### Custom Metrics
- Set up external monitoring (Datadog, New Relic, etc.)
- Configure alerting for:
  - Migration failures
  - Reconciliation discrepancies
  - High error rates
  - Queue depth

#### Log Aggregation
- Use Cloudflare Logs or external service
- Set up log queries for:
  - Admin actions
  - Payment webhooks
  - Invoice generation
  - Reconciliation results

---

### 10. Post-Deployment Verification

#### Database Checks
```sql
-- Check admin users
SELECT id, email, role, is_active FROM admin_users;

-- Check reconciliation tables
SELECT COUNT(*) FROM d1_rds_reconciliation;
SELECT COUNT(*) FROM payment_reconciliation;

-- Check recent invoices
SELECT id, invoice_number, status, total, created_at 
FROM invoices 
ORDER BY created_at DESC 
LIMIT 10;
```

#### Cron Job Verification
- Check logs for migration cron (should run every 5 minutes)
- Check logs for reconciliation cron (should run daily at 2 AM UTC)
- Check logs for cleanup cron (should run daily at 3 AM UTC)

#### API Verification
- Test all admin endpoints
- Test event ingestion
- Test webhook processing
- Verify rate limiting works

---

## Troubleshooting

### Migration Failures

**Issue**: Migration cron fails
**Check**:
- RDS connection credentials
- Network connectivity
- D1 database access
- Batch size configuration

**Solution**:
```bash
# Check logs
wrangler tail --env production | grep "migration"

# Reduce batch size if needed
MIGRATION_BATCH_SIZE=500
```

### Authentication Failures

**Issue**: Admin API returns 401
**Check**:
- API key is correct
- API key is hashed correctly (if using database)
- User is active
- Key hasn't expired

**Solution**:
```sql
-- Check admin user
SELECT * FROM admin_users WHERE email = 'admin@example.com';

-- Check API key
SELECT * FROM admin_api_keys WHERE user_id = 'user-uuid';
```

### Rate Limiting Issues

**Issue**: Getting 429 responses
**Check**:
- Request rate (should be <30/min for admin)
- Rate limit configuration

**Solution**:
- Wait for rate limit window to reset
- Adjust rate limit config if needed

---

## Rollback Plan

If deployment fails:

1. **Revert Workers**
   ```bash
   wrangler rollback --env production
   ```

2. **Revert Database** (if needed)
   ```sql
   -- Drop new tables (be careful!)
   DROP TABLE IF EXISTS admin_action_logs;
   DROP TABLE IF EXISTS admin_api_keys;
   DROP TABLE IF EXISTS admin_users;
   -- etc.
   ```

3. **Restore Environment Variables**
   - Revert to previous values in Cloudflare Dashboard

---

## Production Checklist

- [ ] All migrations applied successfully
- [ ] Admin users created
- [ ] Environment variables configured
- [ ] Workers deployed
- [ ] Cron jobs running
- [ ] Endpoints tested
- [ ] Monitoring configured
- [ ] Alerting set up
- [ ] Documentation reviewed
- [ ] Team trained on operations

---

## Support

For issues or questions:
1. Check logs: `wrangler tail --env production`
2. Review documentation in `docs/` directory
3. Check reconciliation tables for discrepancies
4. Review audit logs for admin actions
