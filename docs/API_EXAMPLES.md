# API Usage Examples

## Event Ingestion Examples

### Basic Event Ingestion

```bash
curl -X POST https://api.example.com/events \
  -H "Authorization: Bearer sk_your-project-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "event-123",
    "metric_name": "api_calls",
    "metric_value": 1,
    "unit": "count"
  }'
```

### Batch Event Ingestion

```bash
# Using the example script
node examples/ingest-events.js sk_your-api-key 100

# Or manually
for i in {1..100}; do
  curl -X POST https://api.example.com/events \
    -H "Authorization: Bearer sk_your-api-key" \
    -H "Content-Type: application/json" \
    -d "{
      \"event_id\": \"event-$(date +%s)-$i\",
      \"metric_name\": \"api_calls\",
      \"metric_value\": 1,
      \"unit\": \"count\"
    }" &
done
wait
```

### Idempotent Retry

```bash
# Same event_id can be sent multiple times safely
curl -X POST https://api.example.com/events \
  -H "Authorization: Bearer sk_your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "event-123",  # Same ID
    "metric_name": "api_calls",
    "metric_value": 1,
    "unit": "count"
  }'

# Returns 202 with status: "duplicate" if already processed
```

---

## Admin API Examples

### Create Organisation

```bash
curl -X POST https://api.example.com/api/v1/admin/organisations \
  -H "Authorization: Bearer your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corp",
    "billingEmail": "billing@acme.com",
    "taxId": "GST123456789"
  }'
```

### Create Project

```bash
curl -X POST https://api.example.com/api/v1/admin/organisations/{org-id}/projects \
  -H "Authorization: Bearer your-admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Project",
    "description": "Project description"
  }'

# Response includes apiKey - save this!
```

### Generate API Key

```bash
curl -X POST https://api.example.com/api/v1/admin/projects/{project-id}/api-keys \
  -H "Authorization: Bearer your-admin-api-key" \
  -H "Content-Type: application/json"

# Response: { "projectId": "...", "apiKey": "sk_...", "message": "..." }
```

### Get Usage Summary

```bash
curl -X GET "https://api.example.com/api/v1/admin/organisations/{org-id}/usage?startMonth=1&startYear=2024&endMonth=3&endYear=2024" \
  -H "Authorization: Bearer your-admin-api-key"
```

### List Invoices

```bash
curl -X GET "https://api.example.com/api/v1/admin/organisations/{org-id}/invoices?status=paid&limit=10" \
  -H "Authorization: Bearer your-admin-api-key"
```

### Get Invoice Details

```bash
curl -X GET https://api.example.com/api/v1/admin/invoices/{invoice-id} \
  -H "Authorization: Bearer your-admin-api-key"
```

### List Payments

```bash
curl -X GET "https://api.example.com/api/v1/admin/organisations/{org-id}/payments?status=captured&limit=10" \
  -H "Authorization: Bearer your-admin-api-key"
```

---

## TypeScript Client Example

```typescript
import { BillingPlatformClient } from './examples/api-client.js';

const client = new BillingPlatformClient({
  baseUrl: 'https://api.example.com',
  adminApiKey: process.env.ADMIN_API_KEY,
});

// Create organisation
const org = await client.createOrganisation({
  name: 'Acme Corp',
  billingEmail: 'billing@acme.com',
});

// Create project
const project = await client.createProject({
  organisationId: org.id,
  name: 'My Project',
});

// Switch to project API key
const eventClient = new BillingPlatformClient({
  baseUrl: 'https://api.example.com',
  projectApiKey: project.apiKey,
});

// Ingest events
for (let i = 0; i < 100; i++) {
  await eventClient.ingestEvent({
    eventId: `event-${Date.now()}-${i}`,
    metricName: 'api_calls',
    metricValue: 1,
    unit: 'count',
  });
}

// Get usage summary
const usage = await client.getUsageSummary({
  organisationId: org.id,
  startMonth: 1,
  startYear: 2024,
});

console.log('Usage:', usage);
```

---

## Python Client Example

```python
import requests
import time

class BillingPlatformClient:
    def __init__(self, base_url, admin_api_key=None, project_api_key=None):
        self.base_url = base_url.rstrip('/')
        self.admin_api_key = admin_api_key
        self.project_api_key = project_api_key
    
    def ingest_event(self, event_id, metric_name, metric_value, unit):
        if not self.project_api_key:
            raise ValueError("Project API key required")
        
        response = requests.post(
            f"{self.base_url}/events",
            headers={
                "Authorization": f"Bearer {self.project_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "event_id": event_id,
                "metric_name": metric_name,
                "metric_value": metric_value,
                "unit": unit,
            },
        )
        response.raise_for_status()
        return response.json()
    
    def create_organisation(self, name, billing_email=None):
        if not self.admin_api_key:
            raise ValueError("Admin API key required")
        
        response = requests.post(
            f"{self.base_url}/api/v1/admin/organisations",
            headers={
                "Authorization": f"Bearer {self.admin_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "name": name,
                "billingEmail": billing_email,
            },
        )
        response.raise_for_status()
        return response.json()

# Usage
client = BillingPlatformClient(
    base_url="https://api.example.com",
    admin_api_key="your-admin-key"
)

org = client.create_organisation("Acme Corp", "billing@acme.com")

event_client = BillingPlatformClient(
    base_url="https://api.example.com",
    project_api_key="sk_project-key"
)

for i in range(100):
    event_client.ingest_event(
        event_id=f"event-{int(time.time())}-{i}",
        metric_name="api_calls",
        metric_value=1,
        unit="count"
    )
```

---

## Error Handling Examples

### Handle Rate Limiting

```typescript
async function ingestWithRetry(client: BillingPlatformClient, event: Event) {
  const maxRetries = 3;
  let retryAfter = 60; // Default 60 seconds

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await client.ingestEvent(event);
    } catch (error) {
      if (error.statusCode === 429) {
        // Rate limited
        const retryAfterHeader = error.headers?.['retry-after'];
        if (retryAfterHeader) {
          retryAfter = parseInt(retryAfterHeader, 10);
        }
        
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      throw error;
    }
  }
  
  throw new Error('Max retries exceeded');
}
```

### Handle Idempotency Errors

```typescript
async function createInvoiceSafely(client: BillingPlatformClient, params: InvoiceParams) {
  try {
    return await client.generateInvoice(params);
  } catch (error) {
    if (error.code === 'IDEMPOTENCY_ERROR') {
      // Invoice already exists, fetch it
      const existingInvoice = await client.getInvoice(error.details.invoiceId);
      return existingInvoice;
    }
    throw error;
  }
}
```

---

## Best Practices

### 1. Always Use Unique Event IDs

```typescript
// Good: Unique event ID
const eventId = `${projectId}-${Date.now()}-${Math.random()}`;

// Bad: Reusing same ID
const eventId = 'event-123'; // Will cause duplicates
```

### 2. Handle Rate Limits

```typescript
// Implement exponential backoff
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.statusCode === 429 && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

### 3. Batch Events Efficiently

```typescript
// Batch events to reduce API calls
const events: Event[] = [];
const BATCH_SIZE = 100;

for (const event of eventsToIngest) {
  events.push(event);
  
  if (events.length >= BATCH_SIZE) {
    await Promise.all(events.map(e => client.ingestEvent(e)));
    events.length = 0;
  }
}

// Process remaining events
if (events.length > 0) {
  await Promise.all(events.map(e => client.ingestEvent(e)));
}
```

### 4. Store API Keys Securely

```typescript
// Good: Use environment variables
const apiKey = process.env.PROJECT_API_KEY;

// Bad: Hardcode in source
const apiKey = 'sk_abc123'; // Never do this!
```

---

## Common Patterns

### Event Ingestion Loop

```typescript
async function ingestEventsContinuously(client: BillingPlatformClient) {
  while (true) {
    const events = await getEventsFromQueue(); // Your event source
    
    for (const event of events) {
      try {
        await client.ingestEvent({
          eventId: event.id,
          metricName: event.metric,
          metricValue: event.value,
          unit: event.unit,
        });
      } catch (error) {
        console.error('Failed to ingest event:', error);
        // Log to dead-letter queue or retry later
      }
    }
    
    await sleep(1000); // Wait 1 second between batches
  }
}
```

### Invoice Generation Workflow

```typescript
async function generateMonthlyInvoices(client: BillingPlatformClient) {
  const organisations = await getAllOrganisations();
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  
  for (const org of organisations) {
    try {
      const invoice = await client.generateInvoice({
        organisationId: org.id,
        month: lastMonth.getMonth() + 1,
        year: lastMonth.getFullYear(),
      });
      
      console.log(`Generated invoice ${invoice.invoiceNumber} for ${org.name}`);
    } catch (error) {
      if (error.code === 'IDEMPOTENCY_ERROR') {
        console.log(`Invoice already exists for ${org.name}`);
      } else {
        console.error(`Failed to generate invoice for ${org.name}:`, error);
      }
    }
  }
}
```

---

For more examples, see:
- `examples/api-client.ts` - TypeScript client
- `examples/ingest-events.js` - Event ingestion script
- [Admin API](/api/admin) - Full API reference
