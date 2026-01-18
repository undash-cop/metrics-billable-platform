# Event Ingestion API

Submit usage events to the Metrics Billing Platform.

## Endpoint

```
POST /api/v1/events
POST /events
```

## Authentication

```bash
Authorization: Bearer YOUR_PROJECT_API_KEY
```

## Request Body

```json
{
  "event_id": "unique-event-id",
  "metric_name": "api_calls",
  "metric_value": 100,
  "unit": "count",
  "timestamp": "2024-01-01T00:00:00Z",
  "metadata": {
    "user_id": "user-123",
    "endpoint": "/api/users"
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | string | Yes | Unique identifier for this event (used for idempotency) |
| `metric_name` | string | Yes | Name of the metric being tracked |
| `metric_value` | number | Yes | Value of the metric |
| `unit` | string | Yes | Unit of measurement (e.g., "count", "bytes", "seconds") |
| `timestamp` | string | No | ISO 8601 timestamp (defaults to current time) |
| `metadata` | object | No | Additional metadata about the event |

## Response

### Success (202 Accepted)

```json
{
  "status": "accepted",
  "event_id": "unique-event-id"
}
```

### Error (400 Bad Request)

```json
{
  "error": "Invalid request body",
  "code": "VALIDATION_ERROR",
  "statusCode": 400,
  "details": {
    "field": "metric_value",
    "message": "must be a number"
  }
}
```

## Idempotency

Events with the same `event_id` are idempotent. If you submit the same `event_id` multiple times, only the first submission will be processed.

## Rate Limiting

- **Limit**: 1000 requests/minute per API key
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

## Examples

### cURL

```bash
curl -X POST https://your-worker.workers.dev/api/v1/events \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "event-001",
    "metric_name": "api_calls",
    "metric_value": 100,
    "unit": "count"
  }'
```

### JavaScript

```javascript
const response = await fetch('https://your-worker.workers.dev/api/v1/events', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    event_id: `event-${Date.now()}`,
    metric_name: 'api_calls',
    metric_value: 100,
    unit: 'count',
    timestamp: new Date().toISOString()
  })
});

const result = await response.json();
```

### TypeScript Client

```typescript
import { MetricsBillingClient } from './examples/api-client';

const client = new MetricsBillingClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://your-worker.workers.dev'
});

await client.ingestEvent({
  event_id: 'event-001',
  metric_name: 'api_calls',
  metric_value: 100,
  unit: 'count'
});
```

## Best Practices

1. **Use Unique Event IDs**: Generate unique `event_id` values to ensure idempotency
2. **Batch Events**: Submit multiple events in parallel for better performance
3. **Handle Retries**: Implement exponential backoff for retries
4. **Monitor Rate Limits**: Check rate limit headers and adjust request rate accordingly
5. **Include Metadata**: Add relevant metadata for better analytics

## See Also

- [Admin API](./admin) - View usage and manage resources
- [API Examples](./examples) - More code examples
- [Troubleshooting Guide](/operations/troubleshooting)
