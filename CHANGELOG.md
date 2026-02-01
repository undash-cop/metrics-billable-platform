# Changelog

All notable changes to the metrics-based billing platform.

---

## [Unreleased]

### Changed

#### D1 as Queue (No Cloudflare Queues)
- **Event processing**: Replaced Cloudflare Queues with D1-as-queue (polling). Events are stored in D1; a cron runs every 5 minutes to migrate events to RDS and update usage_aggregates, then remove them from D1.
- **Benefits**: No Cloudflare Queues product or paid Workers plan required; same flow with cron-based processing.
- **Removed**: Queue producers/consumers from `wrangler.toml`; queue publish from event ingestion; queue consumer handler.
- **Updated**: D1→RDS cron now also runs aggregation per distinct (org, project, metric, month, year) and removes aggregated events from D1.
- **Documentation**: All docs updated to describe D1-as-queue and cron migration + aggregation.

---

## [1.0.0] - 2024-01-15

### 🎉 Initial Production Release

Complete production-ready billing platform with all critical features implemented.

### Added

#### Core Features
- Multi-tenant architecture (organisations → projects)
- Usage-based event ingestion API
- Monthly invoice generation with configurable pricing
- Razorpay payment integration
- Admin dashboard API

#### Production Readiness (P0 - Critical)
- Duplicate invoice prevention (unique constraints + idempotency)
- D1 vs RDS event reconciliation
- Razorpay payment reconciliation
- Critical alerting integration

#### High Priority (P1)
- API key security (SHA-256 hashing)
- D1 retention policy and cleanup cron

#### Medium Priority (P2)
- D1 as queue; cron migration + aggregation (replaces DLQ/Queues)
- Retry logic (cron retries; aggregation errors logged)
- Invoice calculation validation
- Usage aggregate reconciliation
- Pricing rules audit trail

#### Low Priority (P3)
- Admin authentication (API keys)
- Rate limiting (30 req/min)
- Admin audit logging
- Role-based access control (RBAC)
- IP whitelisting (optional)

### Infrastructure
- Cloudflare Workers for APIs and ingestion
- Cloudflare D1 for hot event storage (D1 as queue; cron every 5 min)
- Amazon RDS PostgreSQL for financial SOT
- Razorpay for payment processing

### Database
- 6 RDS migrations (001-006)
- 3 D1 migrations
- Comprehensive schema with constraints and indexes

### Documentation
- 40+ documentation files
- Complete API references
- Deployment guides
- Testing guides
- Operations runbooks
- Troubleshooting guides

### Utilities
- Admin user creation script
- API key hashing utility
- API testing script
- Example API clients

---

## Migration Guide

### From Development to Production

1. **Run Migrations**
   ```bash
   psql $DATABASE_URL -f migrations/rds/005_production_readiness_fixes.sql
   psql $DATABASE_URL -f migrations/rds/006_admin_security.sql
   ```

2. **Create Admin Users**
   ```bash
   node scripts/hash-api-key.js "your-key"
   psql $DATABASE_URL -f scripts/create-admin-user.sql
   ```

3. **Configure Environment**
   - Set all required environment variables
   - Configure Cloudflare bindings
   - Set up Razorpay credentials

4. **Deploy**
   ```bash
   wrangler deploy --env production
   ```

5. **Verify**
   - Test all endpoints
   - Verify cron jobs are running
   - Check monitoring dashboards

---

## Breaking Changes

None - This is the initial release.

---

## Deprecations

None - This is the initial release.

---

## Security

- All API keys hashed with SHA-256
- Admin authentication with RBAC
- Rate limiting on all endpoints
- Full audit logging
- Input validation with Zod
- SQL injection prevention

---

## Performance

- Batch processing for migrations (1000 events/batch)
- Connection pooling for RDS
- D1 caching for API key validation
- Efficient database queries with indexes

---

## Known Issues

None at initial release.

---

## Upgrade Notes

N/A - Initial release.

---

## Contributors

- Initial implementation and production readiness fixes

---

For detailed implementation notes, see:
- [COMPLETE_IMPLEMENTATION_SUMMARY.md](docs/COMPLETE_IMPLEMENTATION_SUMMARY.md)
- [FINAL_IMPLEMENTATION_STATUS.md](docs/FINAL_IMPLEMENTATION_STATUS.md)
