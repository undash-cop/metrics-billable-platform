# Frequently Asked Questions (FAQ)

## General Questions

### What is this platform?

The Undash-cop Metrics Billing Platform is a production-ready, multi-tenant, usage-based billing platform. It handles event ingestion, usage aggregation, invoice generation, and payment processing.

### What technologies does it use?

- **Cloudflare Workers** - APIs and event ingestion
- **Cloudflare D1** - Hot event storage
- **Cloudflare Queues** - Reliable event processing
- **Amazon RDS PostgreSQL** - Financial source of truth
- **Razorpay** - Payment processing (India-first)

### Is it production-ready?

Yes! All production readiness fixes have been implemented:
- ✅ 17/17 production fixes completed
- ✅ Security (auth, RBAC, rate limiting)
- ✅ Reliability (retry, DLQ, error handling)
- ✅ Observability (logging, metrics, alerting)
- ✅ Data integrity (validation, reconciliation)

---

## Event Ingestion

### How do I ingest events?

```bash
curl -X POST https://api.example.com/events \
  -H "Authorization: Bearer sk_your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "unique-event-id",
    "metric_name": "api_calls",
    "metric_value": 1,
    "unit": "count"
  }'
```

See [API Examples](/api/examples) for more examples.

### What happens if I send the same event twice?

The platform is idempotent. If you send the same `event_id` twice, the second request will return `202 Accepted` with `status: "duplicate"` and the event won't be processed again.

### How fast can I ingest events?

The platform is designed for high throughput:
- Events are stored in D1 immediately (fast)
- Processing happens asynchronously via queues
- Rate limiting: 30 requests/minute for admin, higher for events

### What happens if ingestion fails?

- Events are stored in D1 first (fast write)
- If D1 write fails, you get an error response
- If processing fails, events are retried with exponential backoff
- After max retries, events go to dead-letter queue

---

## Invoice Generation

### How are invoices generated?

Invoices are generated monthly:
1. Usage events are aggregated by metric
2. Pricing rules are applied
3. Line items are created
4. Tax and discounts are calculated
5. Invoice is validated and persisted

### Can I generate invoices manually?

Yes, use the admin API:
```bash
curl -X POST https://api.example.com/api/v1/admin/invoices/generate \
  -H "Authorization: Bearer admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "organisationId": "org-uuid",
    "month": 1,
    "year": 2024
  }'
```

### What if I generate the same invoice twice?

Invoice generation is idempotent. If you try to generate an invoice for the same organisation/month/year twice, you'll get the existing invoice back (no duplicate).

### How are pricing rules applied?

Pricing rules are configured per metric:
- Price per unit
- Currency
- Effective dates
- Active/inactive status

See [Billing Engine Guide](/BILLING_ENGINE) for details.

---

## Payments

### How do payments work?

1. Invoice is finalized
2. Razorpay order is created
3. Customer pays via Razorpay
4. Webhook notifies us of payment
5. Payment status is updated atomically

### What if a webhook fails?

- Webhooks are idempotent (same payment ID won't be processed twice)
- Failed webhooks are retried by Razorpay
- Payment reconciliation job detects missing payments

### How do I reconcile payments?

Payment reconciliation runs daily at 2 AM UTC:
- Compares our records with Razorpay
- Detects missing payments
- Creates alerts for discrepancies

See [Operations Guide](/operations/) for details.

---

## Admin API

### How do I authenticate?

Use an admin API key:
```bash
curl -X GET https://api.example.com/api/v1/admin/organisations \
  -H "Authorization: Bearer your-admin-api-key"
```

### How do I create an admin user?

```bash
# 1. Hash API key
node scripts/hash-api-key.js "your-secret-key"

# 2. Create user in database
psql $DATABASE_URL -f scripts/create-admin-user.sql

# 3. Insert API key (use hash from step 1)
```

See [Deployment Guide](/getting-started/deployment) for details.

### What are the rate limits?

- Admin API: 30 requests/minute
- Event ingestion: Higher limits (check configuration)
- Authentication endpoints: 5 requests/15 minutes

### Can I use IP whitelisting?

Yes, set `ADMIN_IP_WHITELIST` environment variable:
```bash
ADMIN_IP_WHITELIST=192.168.1.1,10.0.0.1
```

---

## Data & Storage

### Where are events stored?

- **D1**: Hot storage for fast ingestion
- **RDS**: Cold storage (financial SOT)
- Events are migrated from D1 to RDS every 5 minutes

### How long are events kept in D1?

Processed events are kept in D1 for 7 days (configurable via `D1_RETENTION_DAYS`), then automatically deleted.

### Can I query events directly?

Yes, events are in RDS PostgreSQL:
```sql
SELECT * FROM usage_events 
WHERE organisation_id = 'org-uuid'
ORDER BY ingested_at DESC;
```

### How is data reconciled?

Reconciliation runs daily:
- D1 vs RDS event counts
- Payment reconciliation
- Usage aggregate validation

See [Operations Guide](/operations/) for details.

---

## Troubleshooting

### Events aren't appearing in RDS

1. Check migration cron is running: `wrangler tail | grep migration`
2. Check D1 events: `wrangler d1 execute EVENTS_DB --command "SELECT COUNT(*) FROM usage_events WHERE processed_at IS NULL;"`
3. Check RDS connection: `psql $DATABASE_URL -c "SELECT 1;"`
4. See [Troubleshooting Guide](/operations/troubleshooting) for more

### Invoice generation fails

1. Check usage aggregates exist for the period
2. Check pricing rules are configured
3. Check validation errors in logs
4. See [Troubleshooting Guide](/operations/troubleshooting) for more

### Payment webhook not received

1. Check Razorpay webhook configuration
2. Check webhook signature verification
3. Check webhook logs: `wrangler tail | grep webhook`
4. See [Troubleshooting Guide](/operations/troubleshooting) for more

---

## Performance

### How many events can I ingest per second?

The platform is designed for high throughput:
- D1 writes are fast (milliseconds)
- Processing is asynchronous
- Rate limits are configurable

### How long does invoice generation take?

- Small invoices (<100 line items): <1 second
- Medium invoices (100-1000 line items): 1-5 seconds
- Large invoices (>1000 line items): 5-10 seconds

### How do I optimize performance?

1. Use batch ingestion (send multiple events)
2. Ensure database indexes exist
3. Monitor connection pool usage
4. See [Operations Guide](/operations/) for tuning

---

## Security

### How are API keys secured?

- API keys are hashed with SHA-256 before storage
- Keys are never logged or exposed in error messages
- Keys can be rotated without downtime

### What security features are included?

- ✅ API key authentication
- ✅ Role-based access control (RBAC)
- ✅ Rate limiting
- ✅ IP whitelisting (optional)
- ✅ Full audit logging
- ✅ Input validation
- ✅ SQL injection prevention

See [Security Checklist](/SECURITY_CHECKLIST) for details.

---

## Deployment

### How do I deploy?

1. Run database migrations
2. Create admin users
3. Configure environment variables
4. Deploy workers: `wrangler deploy --env production`

See [Deployment Guide](/getting-started/deployment) for step-by-step instructions.

### What environment variables are required?

- RDS connection (host, port, database, user, password)
- Razorpay credentials (key ID, secret, webhook secret)
- Admin API key (or use database authentication)
- Application config (tax rate, currency)

See [Deployment Guide](/getting-started/deployment) for complete list.

### How do I monitor the platform?

- Cloudflare Analytics (requests, errors, duration)
- Custom metrics (ingestion rate, invoice generation, payments)
- Reconciliation tables (discrepancies)
- Alert history

See [Monitoring Guide](/operations/monitoring) for details.

---

## Support

### Where can I find more documentation?

- [Documentation Index](/INDEX) - Complete documentation index
- [Quick Reference](/QUICK_REFERENCE) - Quick reference
- [Troubleshooting Guide](/operations/troubleshooting) - Common issues

### How do I report issues?

1. Check [Troubleshooting Guide](/operations/troubleshooting) first
2. Review logs: `wrangler tail --env production`
3. Check reconciliation tables for discrepancies
4. Contact support team

### Where can I find code examples?

- [API Examples](/api/examples) - API usage examples
- `examples/api-client.ts` - TypeScript client
- `examples/ingest-events.js` - Event ingestion script

---

## Best Practices

### Event Ingestion

- Use unique `event_id` for each event
- Batch events when possible
- Handle rate limits gracefully
- Implement retry logic with exponential backoff

### Invoice Generation

- Generate invoices monthly (automated)
- Validate invoices before finalizing
- Keep pricing rules up to date
- Monitor invoice generation for errors

### Payments

- Finalize invoices before creating payment orders
- Verify webhook signatures
- Reconcile payments daily
- Monitor payment reconciliation for discrepancies

---

## Payment Retry

### How does payment retry work?

Failed payments are automatically retried with exponential backoff:
- **Retry 1**: After 24 hours
- **Retry 2**: After 48 hours
- **Retry 3**: After 96 hours

The retry cron job runs every 6 hours and processes eligible failed payments.

### Can I manually retry a payment?

Yes, use the retry API endpoint: `POST /api/v1/admin/payments/:paymentId/retry`. This creates a new Razorpay order immediately.

### What happens after max retries?

After max retries (default: 3), the payment is marked as final failure. The platform logs the failure and updates payment metadata. Email notification can be integrated (TODO).

### Can I configure retry settings?

Yes, configure via environment variables:
- `PAYMENT_RETRY_ENABLED` - Enable/disable retry
- `PAYMENT_RETRY_MAX_RETRIES` - Max retry attempts
- `PAYMENT_RETRY_BASE_INTERVAL_HOURS` - Base interval for backoff

You can also update retry config per payment via API: `PATCH /api/v1/admin/payments/:paymentId/retry-config`

## Usage Alerts

### What types of alerts are supported?

The platform supports four types of alerts:
- **Usage Threshold**: Alert when usage exceeds or falls below a threshold
- **Usage Spike**: Alert when usage increases by a percentage (e.g., 50% increase)
- **Cost Threshold**: Alert when cost exceeds or falls below a threshold
- **Unusual Pattern**: Alert on unusual usage patterns (e.g., sudden drop to zero)

### How do I create an alert rule?

Use the API endpoint: `POST /api/v1/admin/organisations/:orgId/alert-rules`. You'll need to specify:
- Alert type
- Metric name and unit (for usage alerts)
- Threshold value and operator
- Comparison period (hour, day, week, month)
- Notification channels (email, webhook)

### How often are alerts evaluated?

Alerts are evaluated every hour by a cron job. You can also configure cooldown periods to prevent alert spam.

### Can I set alerts at the project level?

Yes, alert rules can be set at both organisation and project levels. Set the `projectId` when creating the alert rule.

### What notification channels are supported?

Currently supported:
- **Email**: Requires organisation billing email
- **Webhook**: Requires webhook URL
- **SMS**: Placeholder (not yet implemented)

### How do I view alert history?

Use the API endpoint: `GET /api/v1/admin/organisations/:orgId/alert-history`. You can filter by status, project, or alert rule.

## Invoice Templates

### How do I create a custom invoice template?

Use the API endpoint: `POST /api/v1/admin/organisations/:orgId/invoice-templates`. Provide HTML content, CSS styles, and mark it as default if desired.

### What template variables are available?

Common variables include:
- `{{invoice_number}}`, `{{organisation_name}}`, `{{total}}`, `{{currency}}`
- `{{invoice_date}}`, `{{due_date}}`, `{{billing_period_start}}`, `{{billing_period_end}}`
- `{{line_items}}` (array for looping)

See the API documentation for the complete list.

### Can I preview a template before using it?

Yes, use the preview endpoint: `GET /api/v1/admin/invoice-templates/:templateId/preview?invoiceId={invoiceId}` or `POST /api/v1/admin/invoice-templates/:templateId/preview` with preview data.

### Can I have multiple templates per organisation?

Yes, but only one can be marked as default. The default template is used when generating invoices unless a specific template is assigned to an invoice.

### How do templates work with PDF generation?

Templates are rendered as HTML first, then converted to PDF using the configured PDF generation service (e.g., PDFShift).

## Multi-Currency Support

### How do I set an organisation's currency?

When creating an organisation, include the `currency` field (e.g., `"currency": "USD"`). You can also update it later via the organisation update endpoint.

### How does currency conversion work?

The platform automatically converts pricing rules to the organisation's preferred currency when generating invoices. Exchange rates are stored in the database and can be updated manually or synced from an external API.

### What currencies are supported?

Any ISO 4217 currency code (e.g., INR, USD, EUR, GBP, JPY). Exchange rates must be configured for currency pairs you want to use.

### How do I update exchange rates?

Use the exchange rate API endpoints:
- `POST /api/v1/admin/exchange-rates` - Update a specific rate manually
- `POST /api/v1/admin/exchange-rates/sync` - Sync rates from external API

Exchange rates are also automatically synced daily via a cron job (if configured).

### How does Razorpay work with multiple currencies?

Razorpay primarily supports INR. If an invoice is in a different currency, the platform automatically converts it to INR using the current exchange rate before creating a Razorpay order. The original currency and amount are stored in the order notes for reference.

### What happens if an exchange rate is not found?

If an exchange rate is not found for a currency conversion:
- Invoice generation will fail with an error
- Razorpay order creation will fail with an error

You should ensure exchange rates are configured for all currency pairs you use.

## Email Notifications

### How do email notifications work?

The platform automatically sends emails for:
- **Invoice generation**: When an invoice is created and finalized
- **Payment confirmation**: When a payment is successfully processed
- **Payment reminders**: For overdue invoices (sent daily at 9 AM UTC)

### What email providers are supported?

The platform supports:
- **SendGrid**: Configure `SENDGRID_API_KEY`
- **Resend**: Configure `RESEND_API_KEY`
- **AWS SES**: Configure `AWS_SES_REGION` (implementation pending)

### How do I configure email notifications?

Set environment variables:
- `EMAIL_PROVIDER` - Choose provider: 'sendgrid', 'resend', or 'ses'
- `EMAIL_FROM` - Default from email address
- `EMAIL_FROM_NAME` - Default from name
- Provider-specific API keys (e.g., `SENDGRID_API_KEY`)

### Can I disable email notifications for an organisation?

Yes, set `email_notifications_enabled = false` for the organisation. You can also disable specific types:
- `invoice_email_enabled` - Disable invoice emails
- `payment_email_enabled` - Disable payment confirmation emails

### How often are payment reminders sent?

Payment reminders are sent:
- Day 1 (1 day overdue)
- Day 7, 14, 21, 30 (milestones)
- Weekly after 30 days (every 7 days)

Only one reminder is sent per day maximum to prevent spam.

### Can I view email notification history?

Yes, use the email notifications API:
- `GET /api/v1/admin/organisations/:orgId/email-notifications` - View all emails for an organisation
- `GET /api/v1/admin/invoices/:invoiceId/email-notifications` - View emails for a specific invoice
- `GET /api/v1/admin/email-notifications/:notificationId` - View details of a specific email

## Additional Resources

- **Architecture**: [Architecture Overview](/architecture/)
- **API Reference**: [Admin API](/api/admin), [Events API](/api/events)
- **Operations**: [Operations Guide](/operations/)
- **Testing**: [Testing Guide](/TESTING_GUIDE)
- **Security**: [Security Checklist](/SECURITY_CHECKLIST)

---

For more questions, see the documentation index: [Documentation Index](/INDEX)
