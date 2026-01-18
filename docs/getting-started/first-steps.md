# First Steps

Create your first organisation and project to start using the Metrics Billing Platform.

## Prerequisites

- Platform deployed and configured (see [Installation](./installation) and [Configuration](./configuration))
- Admin API key configured
- Database migrations applied

## Step 1: Create an Organisation

Create your first organisation using the Admin API:

```bash
curl -X POST https://your-worker.workers.dev/api/v1/admin/organisations \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Company",
    "billingEmail": "billing@mycompany.com"
  }'
```

**Response:**
```json
{
  "id": "org-uuid-here",
  "name": "My Company",
  "billingEmail": "billing@mycompany.com",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**Save the organisation ID** - you'll need it for the next steps.

## Step 2: Create a Project

Create a project under your organisation:

```bash
curl -X POST https://your-worker.workers.dev/api/v1/admin/organisations/ORG_ID/projects \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Project",
    "description": "Initial project for testing"
  }'
```

**Response:**
```json
{
  "id": "project-uuid-here",
  "organisationId": "org-uuid-here",
  "name": "My First Project",
  "description": "Initial project for testing",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**Save the project ID** - you'll need it to generate an API key.

## Step 3: Generate an API Key

Generate an API key for your project to start ingesting events:

```bash
curl -X POST https://your-worker.workers.dev/api/v1/admin/projects/PROJECT_ID/api-keys \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production API Key"
  }'
```

**Response:**
```json
{
  "apiKey": "sk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "projectId": "project-uuid-here",
  "name": "Production API Key",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**⚠️ Important**: Save this API key securely! It will only be shown once.

## Step 4: Ingest Your First Event

Test event ingestion with your new API key:

```bash
curl -X POST https://your-worker.workers.dev/api/v1/events \
  -H "Authorization: Bearer sk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "event-001",
    "metric_name": "api_calls",
    "metric_value": 100,
    "unit": "count",
    "timestamp": "2024-01-01T00:00:00Z"
  }'
```

**Response:**
```json
{
  "status": "accepted",
  "event_id": "event-001"
}
```

## Step 5: Verify Event Ingestion

Check that your event was ingested:

```bash
curl https://your-worker.workers.dev/api/v1/admin/organisations/ORG_ID/usage \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

## Step 6: View Analytics

View usage analytics for your organisation:

```bash
# Usage summary
curl https://your-worker.workers.dev/api/v1/admin/organisations/ORG_ID/analytics/summary \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"

# Usage trends
curl https://your-worker.workers.dev/api/v1/admin/organisations/ORG_ID/analytics/trends?groupBy=day \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"

# Cost breakdown
curl https://your-worker.workers.dev/api/v1/admin/organisations/ORG_ID/analytics/cost-breakdown \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

## Using the TypeScript Client

You can also use the provided TypeScript client:

```typescript
import { MetricsBillingClient } from './examples/api-client';

const client = new MetricsBillingClient({
  apiKey: 'sk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  baseUrl: 'https://your-worker.workers.dev'
});

// Ingest an event
await client.ingestEvent({
  event_id: 'event-001',
  metric_name: 'api_calls',
  metric_value: 100,
  unit: 'count',
  timestamp: new Date().toISOString()
});
```

## Next Steps

- [Deployment](./deployment) - Deploy to production
- [API Reference](/api/) - Complete API documentation
- [Operations Guide](/operations/) - Daily operations and monitoring

## Common Tasks

### List All Projects

```bash
curl https://your-worker.workers.dev/api/v1/admin/organisations/ORG_ID/projects \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

### View Invoices

```bash
curl https://your-worker.workers.dev/api/v1/admin/organisations/ORG_ID/invoices \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

### View Payments

```bash
curl https://your-worker.workers.dev/api/v1/admin/organisations/ORG_ID/payments \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

## Troubleshooting

### Authentication Errors

- Verify your API key is correct
- Check that the API key is active
- Ensure you're using the correct endpoint

### Event Ingestion Errors

- Verify the event format matches the schema
- Check that `event_id` is unique
- Ensure the project is active

### Database Errors

- Verify database connection settings
- Check that migrations have been applied
- Ensure database user has proper permissions

For more help, see the [Troubleshooting Guide](/operations/troubleshooting).
