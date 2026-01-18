# Implementation Notes

## Assumptions Made

1. **Tax Rate**: Using 18% GST (configurable via `TAX_RATE` env var)
2. **Currency**: Default currency is INR (Indian Rupees)
3. **Invoice Due Date**: Set to first day of the month following invoice month
4. **Idempotency**: Events with same idempotency key are deduplicated
5. **Event Storage**: D1 stores events temporarily, then deletes after aggregation
6. **Payment Matching**: Razorpay payments matched to invoices via order notes

## Important Considerations

### Financial Integrity

- All monetary values stored as `NUMERIC` in Postgres (not `FLOAT`)
- All calculations use `Decimal.js` for precision
- Database constraints enforce business rules (e.g., total = subtotal + tax)
- Transactions ensure atomicity of financial operations

### Idempotency

- Usage events: Checked in D1 before insertion
- Payments: Checked in RDS via idempotency_keys table
- Invoices: Prevented via unique constraint on organisation/month/year

### Error Handling

- Explicit error types for different failure modes
- No silent failures - all errors are logged
- Webhook signature verification prevents unauthorized updates
- Database errors wrapped with context

### Security

- API keys authenticate projects
- Webhook signatures verified using HMAC SHA-256
- SQL injection prevented via parameterized queries
- Environment variables for sensitive data

## Missing Features (Future Enhancements)

1. **Invoice PDF Generation**: Currently only stores invoice data
2. **Email Notifications**: No email sending for invoices/payments
3. **Refund Handling**: Payment status includes 'refunded' but no refund logic
4. **Multi-Currency**: Currently assumes INR, needs currency conversion
5. **Invoice Templates**: No customizable invoice templates
6. **Usage Dashboards**: No API endpoints for viewing usage metrics
7. **Scheduled Invoice Generation**: No cron job implementation
8. **Payment Retry Logic**: No automatic retry for failed payments
9. **Usage Alerts**: No alerts for unusual usage patterns
10. **Billing Periods**: Currently monthly, no support for custom periods

## Database Migration Notes

### RDS Migration

Run migrations in order:
```bash
npm run db:migrate:rds
```

Requires environment variables:
- RDS_HOST
- RDS_PORT
- RDS_DATABASE
- RDS_USER
- RDS_PASSWORD
- RDS_SSL

### D1 Migration

Run via Wrangler:
```bash
npm run db:migrate:d1
```

## Testing Considerations

1. **Unit Tests**: Test decimal calculations, idempotency logic
2. **Integration Tests**: Test invoice generation, payment processing
3. **E2E Tests**: Test full flow from event ingestion to payment
4. **Load Tests**: Test high-throughput event ingestion
5. **Reconciliation Tests**: Verify payment webhook reconciliation

## Monitoring Checklist

- [ ] Set up Cloudflare Workers analytics
- [ ] Monitor RDS connection pool usage
- [ ] Track invoice generation success rate
- [ ] Monitor payment webhook processing
- [ ] Alert on failed payment reconciliations
- [ ] Track D1 storage usage
- [ ] Monitor queue processing latency

## Deployment Checklist

- [ ] Set up Cloudflare D1 database
- [ ] Set up Amazon RDS Postgres instance
- [ ] Configure RDS security groups
- [ ] Run RDS migrations
- [ ] Run D1 migrations
- [ ] Configure environment variables
- [ ] Set up Razorpay account and webhooks
- [ ] Configure Razorpay webhook URL
- [ ] Test webhook signature verification
- [ ] Deploy Cloudflare Worker
- [ ] Test event ingestion endpoint
- [ ] Test payment webhook endpoint
- [ ] Set up monitoring and alerts

## Known Limitations

1. **Event Deletion**: Events deleted from D1 after aggregation (no long-term event storage)
2. **Invoice Matching**: Payment-to-invoice matching relies on order notes (could be improved)
3. **Concurrent Aggregation**: No locking mechanism for concurrent aggregations (relies on DB constraints)
4. **Pricing Plan Lookup**: Uses current date for pricing lookup (should use invoice date)
5. **Error Recovery**: No automatic retry for failed aggregations
