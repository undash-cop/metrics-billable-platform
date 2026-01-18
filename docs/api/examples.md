# API Examples

Code examples for using the Metrics Billing Platform APIs.

## TypeScript/JavaScript

### Event Ingestion

```typescript
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
    timestamp: new Date().toISOString(),
    metadata: {
      user_id: 'user-123',
      endpoint: '/api/users'
    }
  })
});

const result = await response.json();
```

### Using the TypeScript Client

```typescript
import { MetricsBillingClient } from './examples/api-client';

const client = new MetricsBillingClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://your-worker.workers.dev'
});

// Ingest event
await client.ingestEvent({
  event_id: 'event-001',
  metric_name: 'api_calls',
  metric_value: 100,
  unit: 'count'
});

// Batch ingest
const events = [
  { event_id: 'event-001', metric_name: 'api_calls', metric_value: 100, unit: 'count' },
  { event_id: 'event-002', metric_name: 'api_calls', metric_value: 200, unit: 'count' }
];

await Promise.all(events.map(event => client.ingestEvent(event)));
```

## Python

### Event Ingestion

```python
import requests
import time

def ingest_event(api_key, event_id, metric_name, metric_value, unit):
    url = 'https://your-worker.workers.dev/api/v1/events'
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    data = {
        'event_id': event_id,
        'metric_name': metric_name,
        'metric_value': metric_value,
        'unit': unit,
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    }
    response = requests.post(url, json=data, headers=headers)
    return response.json()

# Usage
result = ingest_event(
    api_key='your-api-key',
    event_id='event-001',
    metric_name='api_calls',
    metric_value=100,
    unit='count'
)
```

### Admin API

```python
def get_usage_summary(admin_api_key, org_id):
    url = f'https://your-worker.workers.dev/api/v1/admin/organisations/{org_id}/usage'
    headers = {
        'Authorization': f'Bearer {admin_api_key}',
        'Content-Type': 'application/json'
    }
    response = requests.get(url, headers=headers)
    return response.json()
```

## Go

### Event Ingestion

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "time"
)

type Event struct {
    EventID     string                 `json:"event_id"`
    MetricName  string                 `json:"metric_name"`
    MetricValue float64                `json:"metric_value"`
    Unit        string                 `json:"unit"`
    Timestamp   string                 `json:"timestamp"`
    Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

func ingestEvent(apiKey, eventID, metricName string, metricValue float64, unit string) error {
    event := Event{
        EventID:     eventID,
        MetricName:  metricName,
        MetricValue: metricValue,
        Unit:        unit,
        Timestamp:   time.Now().UTC().Format(time.RFC3339),
    }

    jsonData, err := json.Marshal(event)
    if err != nil {
        return err
    }

    req, err := http.NewRequest("POST", "https://your-worker.workers.dev/api/v1/events", bytes.NewBuffer(jsonData))
    if err != nil {
        return err
    }

    req.Header.Set("Authorization", "Bearer "+apiKey)
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()

    return nil
}
```

## Ruby

### Event Ingestion

```ruby
require 'net/http'
require 'json'
require 'uri'

def ingest_event(api_key, event_id, metric_name, metric_value, unit)
  uri = URI('https://your-worker.workers.dev/api/v1/events')
  
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  
  request = Net::HTTP::Post.new(uri.path)
  request['Authorization'] = "Bearer #{api_key}"
  request['Content-Type'] = 'application/json'
  request.body = {
    event_id: event_id,
    metric_name: metric_name,
    metric_value: metric_value,
    unit: unit,
    timestamp: Time.now.utc.iso8601
  }.to_json
  
  response = http.request(request)
  JSON.parse(response.body)
end

# Usage
result = ingest_event(
  'your-api-key',
  'event-001',
  'api_calls',
  100,
  'count'
)
```

## cURL

### Event Ingestion

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

### Create Organisation

```bash
curl -X POST https://your-worker.workers.dev/api/v1/admin/organisations \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Company",
    "billingEmail": "billing@mycompany.com"
  }'
```

### Get Usage Summary

```bash
curl https://your-worker.workers.dev/api/v1/admin/organisations/ORG_ID/usage \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

## Best Practices

1. **Idempotency**: Always use unique `event_id` values
2. **Error Handling**: Implement retry logic with exponential backoff
3. **Rate Limiting**: Monitor rate limit headers and adjust request rate
4. **Batch Processing**: Submit multiple events in parallel when possible
5. **Monitoring**: Log API responses and errors for debugging

## Payment Retry Example

### Retry Failed Payment

```typescript
// Manually retry a failed payment
const retryResponse = await fetch(
  `https://your-worker.workers.dev/api/v1/admin/payments/${paymentId}/retry`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      maxRetries: 5,  // Optional: override max retries
      baseIntervalHours: 24,  // Optional: override base interval
    }),
  }
);

const result = await retryResponse.json();
if (result.success) {
  console.log('New Razorpay order created:', result.newOrderId);
} else {
  console.error('Retry failed:', result.error);
}
```

### Get Retry Status

```typescript
const statusResponse = await fetch(
  `https://your-worker.workers.dev/api/v1/admin/payments/${paymentId}/retry-status`,
  {
    headers: {
      'Authorization': `Bearer ${adminApiKey}`,
    },
  }
);

const status = await statusResponse.json();
console.log(`Retry ${status.retryCount}/${status.maxRetries}`);
console.log('Next retry:', status.nextRetryAt);
console.log('Retry history:', status.retryHistory);
```

## Usage Alerts Example

### Create Usage Threshold Alert

```typescript
// Create an alert for high API usage
const alertResponse = await fetch(
  `https://your-worker.workers.dev/api/v1/admin/organisations/${organisationId}/alert-rules`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'High API Usage Alert',
      description: 'Alert when API calls exceed 10,000 per day',
      alertType: 'usage_threshold',
      metricName: 'api_calls',
      unit: 'count',
      thresholdValue: '10000',
      thresholdOperator: 'gte',
      comparisonPeriod: 'day',
      isActive: true,
      notificationChannels: ['email', 'webhook'],
      webhookUrl: 'https://your-webhook.com/alerts',
      cooldownMinutes: 60,
    }),
  }
);

const alert = await alertResponse.json();
console.log('Alert rule created:', alert.id);
```

### Create Usage Spike Alert

```typescript
// Create an alert for usage spikes
const spikeAlertResponse = await fetch(
  `https://your-worker.workers.dev/api/v1/admin/organisations/${organisationId}/alert-rules`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Usage Spike Alert',
      description: 'Alert when usage increases by 50% compared to previous week',
      alertType: 'usage_spike',
      metricName: 'api_calls',
      unit: 'count',
      thresholdValue: '0', // Not used for spike alerts
      thresholdOperator: 'gte',
      comparisonPeriod: 'week',
      spikeThresholdPercent: 50.0,
      spikeComparisonPeriod: 'week',
      isActive: true,
      notificationChannels: ['email'],
      cooldownMinutes: 120,
    }),
  }
);
```

### Get Alert History

```typescript
const historyResponse = await fetch(
  `https://your-worker.workers.dev/api/v1/admin/organisations/${organisationId}/alert-history?status=sent&limit=10`,
  {
    headers: {
      'Authorization': `Bearer ${adminApiKey}`,
    },
  }
);

const history = await historyResponse.json();
console.log('Recent alerts:', history.alerts);
```

## Invoice Templates Example

### Create Custom Template

```typescript
// Create a custom invoice template for an organisation
const templateResponse = await fetch(
  `https://your-worker.workers.dev/api/v1/admin/organisations/${organisationId}/invoice-templates`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Branded Invoice Template',
      description: 'Template with company logo and branding',
      templateType: 'html',
      isDefault: true,
      htmlContent: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>{{css_content}}</style>
        </head>
        <body>
          <div class="invoice">
            <h1>{{organisation_name}}</h1>
            <h2>Invoice {{invoice_number}}</h2>
            <p>Total: {{currency}} {{total}}</p>
            {{#each line_items}}
            <div class="line-item">
              <span>{{description}}</span>
              <span>{{total}}</span>
            </div>
            {{/each}}
          </div>
        </body>
        </html>
      `,
      cssContent: `
        body { font-family: Arial, sans-serif; }
        .invoice { max-width: 800px; margin: 0 auto; }
        .line-item { display: flex; justify-content: space-between; }
      `,
      variables: {
        invoice_number: 'Invoice number',
        organisation_name: 'Organisation name',
        total: 'Total amount',
        currency: 'Currency code',
      },
    }),
  }
);

const template = await templateResponse.json();
console.log('Template created:', template.id);
```

### Preview Template

```typescript
// Preview template with sample data
const previewResponse = await fetch(
  `https://your-worker.workers.dev/api/v1/admin/invoice-templates/${templateId}/preview`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      previewData: {
        invoice_number: 'INV-2024-001',
        organisation_name: 'Sample Company',
        total: '1000.00',
        currency: 'INR',
        line_items: [
          { description: 'API Calls', total: '1000.00', currency: 'INR' },
        ],
      },
    }),
  }
);

const html = await previewResponse.text();
console.log('Preview HTML:', html);
```

## See Also

- [Event Ingestion API](./events)
- [Admin API](./admin)
- [Payment API](./payments)
