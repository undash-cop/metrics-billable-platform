# Security Architecture

Security features and best practices for the Metrics Billing Platform.

## Authentication

### API Key Authentication

- **Project API Keys** - For event ingestion
- **Admin API Keys** - For admin operations
- **Hashing** - All API keys stored as SHA-256 hashes
- **Validation** - Fast validation via D1 cache or RDS

### Admin Authentication

- **Role-Based Access Control (RBAC)** - admin, viewer, operator roles
- **Permissions** - Fine-grained permissions (read, write, admin)
- **IP Whitelisting** - Optional IP restrictions for admin API

## Authorization

### Organisation-Level Access Control

- All queries filtered by organisation ID
- Users can only access their organisation's data
- Enforced at database and API level

### Read-Only Financial Data

- Invoices and payments are read-only via API
- Prevents accidental modifications
- Changes only via internal processes

## Data Protection

### Encryption

- **In Transit** - TLS/SSL for all connections
- **At Rest** - Database encryption (RDS)
- **Secrets** - Stored as Cloudflare secrets

### API Key Security

- Never logged or exposed
- Stored as hashes only
- Rotated regularly

## Audit Logging

### Complete Audit Trail

- All admin actions logged
- Financial operations tracked
- User actions recorded
- IP addresses and user agents logged

### Audit Log Fields

- `organisation_id` - Which organisation
- `entity_type` - What was changed
- `entity_id` - Specific entity
- `action` - What action
- `user_id` - Who did it
- `changes` - What changed
- `ip_address` - Where from
- `user_agent` - Client info

## Rate Limiting

### Protection Against Abuse

- **Event Ingestion** - 1000 requests/minute per API key
- **Admin API** - 30 requests/minute per admin API key
- **Headers** - Rate limit information in response headers

## Webhook Security

### Razorpay Webhooks

- **Signature Verification** - All webhooks verified
- **Idempotency** - Safe to retry
- **Validation** - Request validation before processing

## Best Practices

### For Administrators

1. Use strong, unique API keys
2. Rotate API keys regularly
3. Enable IP whitelisting for admin API
4. Monitor audit logs
5. Review access permissions regularly

### For Developers

1. Never commit secrets to git
2. Use environment variables for secrets
3. Validate all inputs
4. Use parameterized queries
5. Implement proper error handling

## Compliance

### Financial Data

- Complete audit trail
- Immutable invoices
- Reconciliation processes
- Data retention policies

### Privacy

- Minimal data collection
- Secure data storage
- Access controls
- Audit logging

## See Also

- [Security Checklist](/SECURITY_CHECKLIST)
- [Architecture Overview](./index)
- [Operations Guide](/operations/)
