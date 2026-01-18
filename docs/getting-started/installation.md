# Installation

## Prerequisites

- Node.js 18+ installed
- PostgreSQL database (RDS or local)
- Cloudflare account
- Razorpay account

## Step 1: Clone Repository

```bash
git clone <repository-url>
cd metrics-billable-platform
```

## Step 2: Install Dependencies

```bash
npm install
```

## Step 3: Database Setup

### Create PostgreSQL Database

```bash
createdb metrics_billing
```

### Run Migrations

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/metrics_billing"

# Run migrations in order
psql $DATABASE_URL -f migrations/rds/001_initial_schema.sql
psql $DATABASE_URL -f migrations/rds/002_comprehensive_schema.sql
psql $DATABASE_URL -f migrations/rds/004_billing_engine_tables.sql
psql $DATABASE_URL -f migrations/rds/005_production_readiness_fixes.sql
psql $DATABASE_URL -f migrations/rds/006_admin_security.sql
```

## Step 4: Cloudflare Setup

### Create D1 Database

```bash
wrangler d1 create metrics-billable-events
```

### Update wrangler.toml

Update the `database_id` in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "EVENTS_DB"
database_name = "metrics-billable-events"
database_id = "your-database-id-here"
```

### Run D1 Migrations

```bash
wrangler d1 migrations apply EVENTS_DB
```

### Create Queues

1. Go to Cloudflare Dashboard → Workers → Queues
2. Create queue: `usage-events`
3. Create queue: `usage-events-dlq` (optional)

## Step 5: Configure Environment

Create `.dev.vars`:

```bash
ENVIRONMENT=development
RDS_HOST=localhost
RDS_PORT=5432
RDS_DATABASE=metrics_billing
RDS_USER=postgres
RDS_PASSWORD=your-password
RDS_SSL=false
RAZORPAY_KEY_ID=your-key-id
RAZORPAY_KEY_SECRET=your-key-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret
TAX_RATE=0.18
DEFAULT_CURRENCY=INR
ADMIN_API_KEY=your-secret-admin-api-key
```

## Step 6: Create Admin User

```bash
# Hash API key
node scripts/hash-api-key.js "your-secret-api-key"

# Create admin user
psql $DATABASE_URL -f scripts/create-admin-user.sql
```

## Step 7: Test Installation

```bash
# Start dev server
npm run dev

# Test health endpoint
curl http://localhost:8787/health
```

## Next Steps

- [Configuration Guide](/getting-started/configuration)
- [First Steps](/getting-started/first-steps)
