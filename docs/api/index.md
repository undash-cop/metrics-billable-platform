# API Reference

Complete API documentation for the Undash-cop Metrics Billing Platform.

**Copyright © 2026 Undash-cop Private Limited. All rights reserved.**

## Overview

The Metrics Billing Platform provides REST APIs for:
- **Event Ingestion** - Submit usage events
- **Admin API** - Manage organisations, projects, and view data
- **Payment API** - Create payment orders

All APIs use JSON for request/response bodies.

## Authentication

### API Keys

Most endpoints require authentication via API keys:

```bash
Authorization: Bearer YOUR_API_KEY
```

### Admin API Keys

Admin endpoints require admin API keys (different from project API keys):

```bash
Authorization: Bearer YOUR_ADMIN_API_KEY
```

## Base URL

```
https://your-worker.workers.dev
```

## Rate Limiting

- **Event Ingestion**: 1000 requests/minute per API key
- **Admin API**: 30 requests/minute per admin API key

Rate limit headers:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "statusCode": 400,
  "details": {}
}
```

Common status codes:
- `200` - Success
- `201` - Created
- `202` - Accepted
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `429` - Too Many Requests
- `500` - Internal Server Error

## API Endpoints

### Event Ingestion

- [Event Ingestion API](./events) - Submit usage events

### Admin API

- [Admin API Overview](./admin) - Complete admin API reference
- Organisations - Create and manage organisations
- Projects - Create and manage projects
- API Keys - Generate project API keys
- Usage - View usage summaries
- Analytics - Usage analytics and dashboards
- Invoices - View invoices (read-only)
- Payments - View payments (read-only)

### Payment API

- [Payment API](./payments) - Create payment orders

## Examples

See [API Examples](./examples) for code examples in multiple languages.

## SDKs and Clients

### TypeScript Client

```typescript
import { MetricsBillingClient } from './examples/api-client';

const client = new MetricsBillingClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://your-worker.workers.dev'
});
```

See `examples/api-client.ts` for the full client implementation.

## Support

For API support:
- Check [Troubleshooting Guide](/operations/troubleshooting)
- Review [FAQ](/FAQ)
- Check [Operations Guide](/operations/)
