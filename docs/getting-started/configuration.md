# Configuration

Configure your environment variables and settings for the Metrics Billing Platform.

## Environment Variables

### Required Variables

#### Database Configuration

```bash
# RDS PostgreSQL Connection
RDS_HOST=your-rds-endpoint.aws.com
RDS_PORT=5432
RDS_DATABASE=your_database_name
RDS_USER=your_username
RDS_PASSWORD=your_password
RDS_SSL=true  # Set to 'false' if not using SSL (not recommended for production)
```

#### Razorpay Configuration

```bash
# Razorpay credentials
RAZORPAY_KEY_ID=rzp_test_yourkeyid
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

#### Application Configuration

```bash
# Environment
ENVIRONMENT=production  # or 'development' or 'staging'

# Tax and Currency
TAX_RATE=0.18  # e.g., '0.18' for 18% GST
DEFAULT_CURRENCY=INR
```

### Optional Variables

#### Cloudflare D1 (for local development)

```bash
# D1 Database ID (set automatically by Wrangler)
D1_DATABASE_ID=your-d1-database-id
```

#### Migration Configuration

```bash
# Optional migration settings (with defaults)
MIGRATION_BATCH_SIZE=1000  # Events per batch (default: 1000)
MIGRATION_MAX_BATCHES=10   # Max batches per run (default: 10)
D1_RETENTION_DAYS=7        # Days to retain processed events in D1 (default: 7)
```

#### Admin API Security

```bash
# Admin authentication (optional, for simple deployments)
ADMIN_API_KEY=super-secret-admin-key  # Master API key for admin access
ADMIN_IP_WHITELIST=127.0.0.1,::1  # Comma-separated list of allowed IPs
```

#### Email Configuration

```bash
# Email Provider (choose one)
SENDGRID_API_KEY=your-sendgrid-key
# OR
RESEND_API_KEY=your-resend-key
# OR
AWS_SES_REGION=us-east-1

# Email Settings
EMAIL_FROM=noreply@example.com
EMAIL_FROM_NAME="Metrics Billing Platform"
DOCS_SITE_URL=https://your-docs-site.com  # Optional: for email links
```

#### PDF Generation Configuration (Optional)

```bash
# PDF Generation Service (optional)
PDF_GENERATION_API_KEY=your-pdf-service-key  # e.g., PDFShift API key
PDF_GENERATION_API_URL=https://api.pdfshift.io/v3/convert  # Optional, defaults to PDFShift

# Base URL for PDF download links
BASE_URL=https://your-worker.workers.dev
```

**Note**: PDF generation requires R2 bucket configuration in `wrangler.toml`. See [Cloudflare Configuration](#cloudflare-configuration) below.

#### Refund Configuration

No additional environment variables required. Refunds use existing Razorpay credentials:
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

**Note**: Ensure Razorpay webhook is configured to receive `refund.*` events.

#### Payment Retry Configuration (Optional)

```bash
# Payment retry settings
PAYMENT_RETRY_ENABLED=true  # Enable/disable automatic retry (default: true)
PAYMENT_RETRY_MAX_RETRIES=3  # Maximum retry attempts (default: 3)
PAYMENT_RETRY_BASE_INTERVAL_HOURS=24  # Base interval for exponential backoff in hours (default: 24)
```

**Retry Schedule**:
- Retry 1: After 24 hours
- Retry 2: After 48 hours (24 * 2^1)
- Retry 3: After 96 hours (24 * 2^2)

**Note**: Payment retry cron runs every 6 hours to check for eligible payments.

## Cloudflare Configuration

### Wrangler Configuration

The `wrangler.toml` file contains your Cloudflare Workers configuration:

```toml
name = "metrics-billable-platform"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# Cron triggers
[triggers]
crons = [
  "*/5 * * * *",  # D1 to RDS migration - every 5 minutes
  "0 2 * * *",    # Reconciliation - daily at 2 AM UTC
  "0 3 * * *",    # D1 cleanup - daily at 3 AM UTC
  "0 2 1 * *"     # Invoice generation - 1st of each month at 2 AM UTC
]

# D1 Database binding
[[d1_databases]]
binding = "EVENTS_DB"
database_name = "metrics-billable-events"
database_id = "your-d1-database-id"

# Queue bindings
[[queues.producers]]
queue = "usage-events"
binding = "USAGE_EVENTS_QUEUE"

[[queues.consumers]]
queue = "usage-events"
max_batch_size = 100
max_batch_timeout = 30

# R2 bucket for invoice PDFs
[[r2_buckets]]
binding = "INVOICE_PDFS_R2"
bucket_name = "invoice-pdfs"
```

### Setting Secrets in Cloudflare

For production, set secrets using Wrangler CLI:

```bash
# Database credentials
wrangler secret put RDS_HOST
wrangler secret put RDS_PASSWORD

# Razorpay credentials
wrangler secret put RAZORPAY_KEY_ID
wrangler secret put RAZORPAY_KEY_SECRET
wrangler secret put RAZORPAY_WEBHOOK_SECRET

# Admin API key
wrangler secret put ADMIN_API_KEY

# Email provider
wrangler secret put SENDGRID_API_KEY

# PDF generation (optional)
wrangler secret put PDF_GENERATION_API_KEY
wrangler secret put BASE_URL
```

Or use the Cloudflare Dashboard:
1. Go to Workers & Pages → Your Worker → Settings → Variables
2. Add secrets under "Environment Variables"

## Local Development

For local development, create a `.dev.vars` file in the project root:

```bash
# .dev.vars
RDS_HOST=localhost
RDS_PORT=5432
RDS_DATABASE=metrics_billing
RDS_USER=postgres
RDS_PASSWORD=postgres
RDS_SSL=false

RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

ENVIRONMENT=development
TAX_RATE=0.18
DEFAULT_CURRENCY=INR

ADMIN_API_KEY=dev-admin-key
```

**Note**: `.dev.vars` is automatically ignored by git. Never commit secrets!

## Environment-Specific Configuration

### Development

```bash
ENVIRONMENT=development
RDS_SSL=false
ADMIN_IP_WHITELIST=127.0.0.1,::1
```

### Staging

```bash
ENVIRONMENT=staging
RDS_SSL=true
ADMIN_IP_WHITELIST=your-staging-ip
```

### Production

```bash
ENVIRONMENT=production
RDS_SSL=true
ADMIN_IP_WHITELIST=your-production-ips
# Use strong, unique secrets
# Enable all monitoring and alerting
```

## Verification

After configuration, verify your setup:

```bash
# Check health endpoint
curl https://your-worker.workers.dev/health

# Test admin API (if configured)
curl -H "Authorization: Bearer $ADMIN_API_KEY" \
  https://your-worker.workers.dev/api/v1/admin/organisations
```

## Next Steps

- [First Steps](./first-steps) - Create your first organisation and project
- [Deployment](./deployment) - Deploy to production
