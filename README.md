# Undash-cop Metrics Billing Platform

**Copyright © 2026 Undash-cop Private Limited. All rights reserved.**

<div align="center">
  <img src="docs/assets/logo.svg" alt="Undash-cop Metrics Billing Platform Logo" width="300" />
</div>

A production-ready, multi-tenant, usage-based billing platform built by Undash-cop. Designed for India-first payments using Razorpay, with Cloudflare Workers for ingestion and APIs, Cloudflare D1 for hot event storage (D1 acts as queue; cron polls every 5 min), and Amazon RDS (Postgres) as the financial source of truth.

---

## 🎯 Features

### Core Platform
- **Multi-Tenant Architecture** - Support for multiple organisations and projects
- **Usage-Based Billing** - Track and bill based on usage metrics
- **Monthly Invoice Generation** - Automated invoice generation with configurable pricing
- **Razorpay Integration** - India-first payment processing with webhook reconciliation
- **Event Ingestion** - High-throughput, idempotent event ingestion

### Business Features
- **Invoice PDF Generation** - Professional PDF invoices with branding
- **Email Notifications** - Invoice, payment, and reminder emails
- **Refund Handling** - Full and partial refunds via Razorpay
- **Usage Dashboards** - Real-time metrics and analytics APIs
- **Multi-Currency Support** - Currency conversion and multi-currency invoices
- **Invoice Templates** - Customizable HTML/CSS templates
- **Payment Retry** - Automatic retry with exponential backoff
- **Usage Alerts** - Threshold, spike, and cost alerts

### Production Features
- **Data Integrity** - Comprehensive reconciliation and validation
- **Security** - Enterprise-grade authentication, authorization, and audit logging
- **Observability** - Structured logging, metrics, and alerting
- **Cost-Effective** - Cloud-native design with automatic cleanup

---

## 🏗️ Architecture

```
┌─────────────┐
│   Clients   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│     Cloudflare Workers              │
│  ┌──────────────┐  ┌──────────────┐ │
│  │  /events     │  │  Admin API   │ │
│  │  (Ingestion) │  │  (Dashboard) │ │
│  └──────┬───────┘  └──────┬───────┘ │
│         │                  │         │
│         ▼                  │         │
│  ┌──────────────┐          │         │
│  │  Cloudflare  │          │         │
│  │     D1       │          │         │
│  │ (Hot Storage)│          │         │
│  └──────┬───────┘          │         │
│         │                  │         │
│         ▼                  │         │
│  ┌──────────────┐          │         │
│  │ Cron (5 min) │          │         │
│  │ D1→RDS+agg   │          │         │
│  └──────┬───────┘          │         │
│         │                  │         │
└─────────┼──────────────────┼─────────┘
          │                  │
          ▼                  ▼
┌─────────────────┐  ┌─────────────────┐
│  Amazon RDS     │  │    Razorpay     │
│  (PostgreSQL)   │  │   (Payments)    │
│  Financial SOT  │  │                 │
└─────────────────┘  └─────────────────┘
```

### Data Flow

1. **Event Ingestion**: Clients → `/events` → D1 (return 202). D1 acts as queue.
2. **Migration + Aggregation**: Cron (every 5 min) polls D1 → copies to RDS usage_events → updates usage_aggregates → removes from D1.
3. **Invoice Generation**: Cron/API → Calculate → Generate Invoice → RDS
4. **Payment Processing**: Razorpay → Webhook → Update Payment → RDS

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL (RDS)
- Cloudflare account
- Razorpay account

### Installation

```bash
# Clone repository
git clone <repository-url>
cd metrics-billable-platform

# Install dependencies
npm install

# Configure environment
cp .env.example .dev.vars
# Edit .dev.vars with your credentials
```

### Database Setup

```bash
# Run migrations
psql $DATABASE_URL -f migrations/rds/001_initial_schema.sql
psql $DATABASE_URL -f migrations/rds/002_comprehensive_schema.sql
psql $DATABASE_URL -f migrations/rds/004_billing_engine_tables.sql
psql $DATABASE_URL -f migrations/rds/005_production_readiness_fixes.sql
psql $DATABASE_URL -f migrations/rds/006_admin_security.sql

# Apply D1 migrations
wrangler d1 migrations apply EVENTS_DB
```

### Create Admin User

```bash
# Hash API key
node scripts/hash-api-key.js "your-secret-api-key"

# Create admin user (use hash from above)
psql $DATABASE_URL -f scripts/create-admin-user.sql
```

### Deploy

```bash
# Deploy to Cloudflare
wrangler deploy

# Or deploy to production
wrangler deploy --env production
```

---

## 📖 Documentation

### 🌐 Documentation Website

**👉 [View Full Documentation Site](docs-site/)** - Complete documentation website with navigation, search, and status dashboard

To run locally:
```bash
npm run docs:dev
```

The documentation site includes:
- Getting Started guides
- Complete API reference
- Architecture documentation
- Operations guides
- Project status dashboard
- Implementation details

### Quick Links
- **[Documentation Site](./docs/INDEX.md)** - Complete documentation website
- **[Getting Started](./docs/getting-started/index.md)** - Installation and setup
- **[API Reference](./docs/api/index.md)** - Complete API documentation
- **[Architecture](./docs/architecture/index.md)** - System architecture
- **[Operations](./docs/operations/index.md)** - Operations and troubleshooting

### Reference Documentation
- **[Deployment Guide](./docs/getting-started/deployment.md)** - Step-by-step deployment
- **[Admin API](./docs/api/admin.md)** - Admin dashboard APIs
- **[Events API](./docs/api/events.md)** - Event ingestion API
- **[Quick Reference](./docs/QUICK_REFERENCE.md)** - Common operations
- **[FAQ](./docs/FAQ.md)** - Frequently asked questions
- **[Troubleshooting](./docs/operations/troubleshooting.md)** - Common issues and solutions

---

## 🔑 Key Concepts

### Idempotency
All critical operations are idempotent:
- Event ingestion uses `event_id` as idempotency key
- Invoice generation uses `invoice_{orgId}_{year}_{month}`
- Payment processing uses `razorpay_payment_{payment_id}`

### Data Flow
1. **Hot Storage (D1)**: Fast event ingestion
2. **D1 as queue**: Cron polls D1 every 5 min for migration + aggregation (no Cloudflare Queues required)
3. **Cold Storage (RDS)**: Financial source of truth
4. **Reconciliation**: Daily checks for data integrity

### Security
- API keys hashed with SHA-256
- Role-based access control (admin/viewer/operator)
- Rate limiting (30 req/min for admin)
- IP whitelisting (optional)
- Full audit trail

---

## 📊 Monitoring

### Key Metrics
- Event ingestion rate
- Invoice generation rate
- Payment success rate
- Migration success rate
- Reconciliation discrepancies

### Alert Thresholds
- Migration failures: >10 per run
- Reconciliation discrepancies: >0
- Migration cron failures: >10% failure rate
- API errors: >100/minute

---

## 🛠️ Development

### Local Development

```bash
# Start local dev server
wrangler dev

# Run migrations locally
wrangler d1 migrations apply EVENTS_DB --local

# Test endpoints
./scripts/test-admin-api.sh $ADMIN_API_KEY http://localhost:8787
```

### Testing

```bash
# Run tests
npm test

# Run linter
npm run lint

# Type check
npm run type-check
```

---

## 📁 Project Structure

```
metrics-billable-platform/
├── src/
│   ├── db/              # Database utilities
│   ├── middleware/      # Auth, rate limiting, observability
│   ├── repositories/    # Data access layer
│   ├── services/        # Business logic
│   ├── types/           # TypeScript types
│   ├── utils/           # Utilities (crypto, errors, etc.)
│   └── workers/         # Cloudflare Workers
│       ├── admin/       # Admin API handlers
│       └── cron-*.ts    # Cron jobs
├── migrations/
│   ├── d1/              # D1 migrations
│   └── rds/             # RDS migrations
├── scripts/             # Utility scripts
├── docs/                # Documentation
└── wrangler.toml        # Cloudflare configuration
```

---

## 🔒 Security

- ✅ API keys hashed with SHA-256
- ✅ Admin authentication with RBAC
- ✅ Rate limiting on all endpoints
- ✅ IP whitelisting (optional)
- ✅ Full audit logging
- ✅ Input validation with Zod
- ✅ SQL injection prevention (parameterized queries)

---

## 📈 Production Readiness

All production readiness fixes have been implemented:

- ✅ **P0 - Critical**: Duplicate prevention, reconciliation, alerting
- ✅ **P1 - High Priority**: API key security, cost control
- ✅ **P2 - Medium Priority**: Migration reliability, validation, audit trail
- ✅ **P3 - Low Priority**: Admin security, RBAC, rate limiting

See [Production Readiness Review](docs/PRODUCTION_READINESS_REVIEW.md) for details.

---

## 🤝 Contributing

1. Follow TypeScript best practices
2. Add tests for new features
3. Update documentation
4. Run linter and type checker
5. Follow security best practices

---

## 📝 License

[License](./LICENSE)
[@COPYRIGHT](./COPYRIGHT)

---

## 🆘 Support

- **Documentation**: See [Documentation Site](./docs/INDEX.md)
- **Troubleshooting**: See [Troubleshooting Guide](./docs/operations/troubleshooting.md)
- **Quick Reference**: See [Quick Reference](./docs/QUICK_REFERENCE.md)

---

## 🎉 Status

**✅ Production Ready**

The platform is fully implemented with:
- Enterprise-grade security
- Robust error handling
- Comprehensive observability
- Full auditability
- Cost-effective operations

Ready for production deployment! 🚀
