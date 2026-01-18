```md
# Admin API

Complete reference for the Admin API endpoints.

## Base URL

```
https://your-worker.workers.dev/api/v1/admin
```

## Authentication

```bash
Authorization: Bearer YOUR_ADMIN_API_KEY
```

## Endpoints

### Organisations

#### Create Organisation

```http
POST /organisations
```

**Request:**
```json
{
  "name": "My Company",
  "billingEmail": "billing@mycompany.com"
}
```

**Response:**
```json
{
  "id": "org-uuid",
  "name": "My Company",
  "billingEmail": "billing@mycompany.com",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00Z"
}
```

### Projects

#### Create Project

```http
POST /organisations/{orgId}/projects
```

**Request:**
```json
{
  "name": "My Project",
  "description": "Project description"
}
```

**Response:**
```json
{
  "id": "project-uuid",
  "organisationId": "org-uuid",
  "name": "My Project",
  "description": "Project description",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00Z"
}
```

#### List Projects

```http
GET /organisations/{orgId}/projects
```

**Response:**
```json
{
  "projects": [
    {
      "id": "project-uuid",
      "name": "My Project",
      "isActive": true
    }
  ]
}
```

### API Keys

#### Generate API Key

```http
POST /projects/{projectId}/api-keys
```

**Request:**
```json
{
  "name": "Production API Key"
}
```

**Response:**
```json
{
  "apiKey": "sk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "projectId": "project-uuid",
  "name": "Production API Key",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**⚠️ Important**: The API key is only shown once. Save it securely!

### Usage

#### Get Usage Summary

```http
GET /organisations/{orgId}/usage
```

**Query Parameters:**
- `startMonth` (optional) - Start month (1-12)
- `startYear` (optional) - Start year
- `endMonth` (optional) - End month (1-12)
- `endYear` (optional) - End year
- `projectId` (optional) - Filter by project
- `metricName` (optional) - Filter by metric

**Response:**
```json
{
  "organisationId": "org-uuid",
  "organisationName": "My Company",
  "period": {
    "start": { "month": 1, "year": 2024 },
    "end": { "month": 12, "year": 2024 }
  },
  "metrics": [
    {
      "metricName": "api_calls",
      "unit": "count",
      "totalValue": 10000,
      "eventCount": 1000,
      "projects": [...]
    }
  ],
  "totalProjects": 5,
  "totalMetrics": 3
}
```

### Analytics

#### Usage Summary

```http
GET /organisations/{orgId}/analytics/summary
```

**Query Parameters:**
- `startMonth`, `startYear`, `endMonth`, `endYear` - Date range
- `projectId` - Filter by project
- `metricName` - Filter by metric

**Response:**
```json
{
  "organisationId": "org-uuid",
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-12-31T23:59:59Z",
  "totalUsage": 10000,
  "totalEvents": 1000,
  "totalCost": "1000.00",
  "currency": "INR",
  "metrics": [...]
}
```

#### Usage Trends

```http
GET /organisations/{orgId}/analytics/trends
```

**Query Parameters:**
- `groupBy` - `day`, `week`, or `month` (default: `month`)
- Date range and filter parameters

**Response:**
```json
{
  "trends": [
    {
      "date": "2024-01-01",
      "totalUsage": 1000,
      "totalEvents": 100,
      "totalCost": "100.00",
      "metrics": {
        "api_calls": 1000
      }
    }
  ]
}
```

#### Cost Breakdown

```http
GET /organisations/{orgId}/analytics/cost-breakdown
```

**Response:**
```json
{
  "breakdown": [
    {
      "metricName": "api_calls",
      "unit": "count",
      "totalUsage": 10000,
      "totalCost": "500.00",
      "percentage": 50.0
    }
  ]
}
```

#### Real-Time Usage

```http
GET /organisations/{orgId}/analytics/realtime
```

**Response:**
```json
{
  "last24Hours": {
    "totalUsage": 1000,
    "totalEvents": 100,
    "metrics": [...]
  },
  "lastHour": {
    "totalEvents": 10,
    "totalUsage": 100
  }
}
```

### Invoices

#### List Invoices

```http
GET /organisations/{orgId}/invoices
```

**Response:**
```json
{
  "invoices": [
    {
      "id": "invoice-uuid",
      "invoiceNumber": "INV-2024-01-ORG",
      "total": "1000.00",
      "currency": "INR",
      "status": "finalized",
      "month": 1,
      "year": 2024,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### Get Invoice Details

```http
GET /invoices/{invoiceId}
```

**Response:**
```json
{
  "id": "invoice-uuid",
  "invoiceNumber": "INV-2024-01-ORG",
  "organisationId": "org-uuid",
  "total": "1000.00",
  "currency": "INR",
  "status": "finalized",
  "pdfUrl": "/api/v1/admin/invoices/invoice-uuid/pdf",
  "lineItems": [
    {
      "id": "line-item-uuid",
      "lineNumber": 1,
      "metricName": "api_calls",
      "quantity": "1000",
      "unit": "requests",
      "unitPrice": "0.10",
      "total": "100.00"
    }
  ],
  "createdAt": "2024-01-01T00:00:00Z"
}
```

#### Download Invoice PDF

```http
GET /invoices/{invoiceId}/pdf
```

**Response:**
- Returns PDF file with `Content-Type: application/pdf`
- Returns `404` if PDF not yet generated
- PDF is automatically generated when invoice is finalized

### Payments

#### List Payments

```http
GET /organisations/{orgId}/payments
```

**Response:**
```json
{
  "payments": [
    {
      "id": "payment-uuid",
      "invoiceId": "invoice-uuid",
      "amount": "1000.00",
      "currency": "INR",
      "status": "captured",
      "paidAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

## Permissions

Admin API keys have different permission levels:
- `read` - Read-only access
- `write` - Can create resources
- `admin` - Full access

## Rate Limiting

- **Limit**: 30 requests/minute per admin API key
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Payment Retry

#### Retry Failed Payment

```http
POST /payments/{paymentId}/retry
```

**Request Body (Optional):**
```json
{
  "maxRetries": 5,
  "baseIntervalHours": 24
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "newOrderId": "order_xxxxxxxxxxxxx",
  "message": "Payment retry initiated successfully"
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "Payment retry failed: ...",
  "message": "Payment retry failed: ..."
}
```

#### Get Retry Status

```http
GET /payments/{paymentId}/retry-status
```

**Response:**
```json
{
  "retryCount": 1,
  "maxRetries": 3,
  "nextRetryAt": "2024-01-21T14:00:00Z",
  "lastRetryAt": "2024-01-20T14:00:00Z",
  "eligible": true,
  "retryHistory": [
    {
      "attemptNumber": 1,
      "attemptedAt": "2024-01-20T14:00:00Z",
      "success": false,
      "error": "Razorpay API error",
      "razorpayOrderId": null
    }
  ]
}
```

#### Update Retry Configuration

```http
PATCH /payments/{paymentId}/retry-config
```

**Request:**
```json
{
  "maxRetries": 5,
  "nextRetryAt": "2024-01-21T14:00:00Z"
}
```

**Response:**
```json
{
  "message": "Retry configuration updated successfully"
}
```

### Alert Rules

#### Create Alert Rule

```http
POST /organisations/{organisationId}/alert-rules
```

**Request:**
```json
{
  "name": "High API Usage Alert",
  "description": "Alert when API calls exceed threshold",
  "alertType": "usage_threshold",
  "metricName": "api_calls",
  "unit": "count",
  "thresholdValue": "10000",
  "thresholdOperator": "gte",
  "comparisonPeriod": "day",
  "isActive": true,
  "notificationChannels": ["email", "webhook"],
  "webhookUrl": "https://your-webhook.com/alerts",
  "cooldownMinutes": 60,
  "projectId": "optional-project-id"
}
```

**Response (201 Created):**
```json
{
  "id": "alert-rule-uuid",
  "organisationId": "org-uuid",
  "name": "High API Usage Alert",
  "alertType": "usage_threshold",
  "metricName": "api_calls",
  "unit": "count",
  "thresholdValue": "10000",
  "thresholdOperator": "gte",
  "comparisonPeriod": "day",
  "isActive": true,
  "notificationChannels": ["email", "webhook"],
  "cooldownMinutes": 60,
  "createdAt": "2024-01-15T10:00:00Z"
}
```

#### List Alert Rules

```http
GET /organisations/{organisationId}/alert-rules?isActive=true&projectId={projectId}
```

**Response:**
```json
{
  "rules": [
    {
      "id": "alert-rule-uuid",
      "name": "High API Usage Alert",
      "alertType": "usage_threshold",
      "isActive": true
      // additional fields omitted for brevity
    }
  ],
  "total": 1
}
```

#### Get Alert Rule

```http
GET /alert-rules/{ruleId}
```

#### Update Alert Rule

```http
PATCH /alert-rules/{ruleId}
```

**Request:**
```json
{
  "isActive": false,
  "thresholdValue": "15000"
}
```

#### Delete Alert Rule

```http
DELETE /alert-rules/{ruleId}
```

#### Get Alert History

```http
GET /organisations/{organisationId}/alert-history?status=sent&limit=50&offset=0
```

**Response:**
```json
{
  "alerts": [
    {
      "id": "alert-uuid",
      "alertRuleId": "rule-uuid",
      "alertType": "usage_threshold",
      "actualValue": "12000",
      "thresholdValue": "10000",
      "status": "sent",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

### Alert Types

- **usage_threshold**: Alert when usage exceeds/falls below a threshold
- **usage_spike**: Alert when usage increases by a percentage
- **cost_threshold**: Alert when cost exceeds/falls below a threshold
- **unusual_pattern**: Alert on unusual usage patterns (e.g., sudden drop to zero)

### Alert Operators

- `gt` - Greater than
- `gte` - Greater than or equal to
- `lt` - Less than
- `lte` - Less than or equal to
- `eq` - Equal to

### Notification Channels

- `email` - Send email notification (requires billing email)
- `webhook` - Send webhook notification (requires webhook URL)
- `sms` - SMS notification (placeholder, not yet implemented)

### Invoice Templates

#### Create Template

```http
POST /organisations/{organisationId}/invoice-templates
POST /invoice-templates (system template, admin only)
```

**Request:**
```json
{
  "name": "Custom Branded Template",
  "description": "Template with company branding",
  "templateType": "html",
  "isDefault": true,
  "isActive": true,
  "htmlContent": "<!DOCTYPE html>...",
  "cssContent": "body { font-family: Arial; }",
  "variables": {
    "invoice_number": "Invoice number",
    "organisation_name": "Organisation name"
  },
  "previewData": {
    "invoice_number": "INV-2024-001",
    "organisation_name": "Sample Company"
  }
}
```

**Response (201 Created):**
```json
{
  "id": "template-uuid",
  "organisationId": "org-uuid",
  "name": "Custom Branded Template",
  "templateType": "html",
  "isDefault": true,
  "isActive": true,
  "variables": {},
  "createdAt": "2024-01-15T10:00:00Z"
}
```

#### List Templates

```http
GET /organisations/{organisationId}/invoice-templates?includeSystem=true&isActive=true
GET /invoice-templates (system templates)
```

**Response:**
```json
{
  "templates": [
    {
      "id": "template-uuid",
      "name": "Custom Branded Template",
      "isDefault": true,
      "isActive": true,
      ...
    }
  ],
  "total": 1
}
```

#### Get Template

```http
GET /invoice-templates/{templateId}
```

**Response:**
```json
{
  "id": "template-uuid",
  "name": "Custom Branded Template",
  "htmlContent": "<!DOCTYPE html>...",
  "cssContent": "body { ... }",
  "variables": {},
  ...
}
```

#### Update Template

```http
PATCH /invoice-templates/{templateId}
```

#### Delete Template

```http
DELETE /invoice-templates/{templateId}
```

#### Preview Template

```http
GET /invoice-templates/{templateId}/preview?invoiceId={invoiceId}
POST /invoice-templates/{templateId}/preview
```

**Request (POST):**
```json
{
  "previewData": {
    "invoice_number": "INV-2024-001",
    "organisation_name": "Sample Company",
    "total": "1000.00",
    "currency": "INR",
    ...
  }
}
```

**Response:** HTML rendered template

### Template Variables

Available template variables:

```handlebars
{{invoice_number}}       - Invoice number
{{organisation_name}}    - Organisation name
{{billing_email}}        - Billing email (optional)
{{invoice_date}}         - Invoice issue date
{{due_date}}             - Invoice due date
{{billing_period_start}} - Billing period start
{{billing_period_end}}   - Billing period end
{{status}}               - Invoice status
{{currency}}             - Currency code
{{subtotal}}             - Subtotal amount
{{tax}}                  - Tax amount
{{tax_rate}}             - Tax rate percentage
{{total}}                - Total amount
{{line_items}}           - Array of line items
```

### Template Syntax

```handlebars
{{variable_name}}

{{#if variable}}
  ...
{{/if}}

{{#each array}}
  ...
{{/each}}
```

### Exchange Rates

#### List Active Exchange Rates

```http
GET /exchange-rates?baseCurrency=INR
```

**Response:**
```json
{
  "exchangeRates": [
    {
      "id": "rate-uuid",
      "baseCurrency": "INR",
      "targetCurrency": "USD",
      "rate": "0.012",
      "effectiveFrom": "2024-01-01T00:00:00Z",
      "effectiveTo": null,
      "source": "api",
      "metadata": {},
      "updatedAt": "2024-01-15T10:00:00Z"
    }
  ],
  "total": 1
}
```

#### Get Exchange Rate

```http
GET /exchange-rates/INR/USD?atDate=2024-01-15T00:00:00Z
```

**Response:**
```json
{
  "baseCurrency": "INR",
  "targetCurrency": "USD",
  "rate": "0.012",
  "atDate": "2024-01-15T00:00:00Z"
}
```

#### Update Exchange Rate

```http
POST /exchange-rates
```

**Request:**
```json
{
  "baseCurrency": "INR",
  "targetCurrency": "USD",
  "rate": "0.012",
  "source": "manual",
  "metadata": {
    "note": "Updated manually"
  }
}
```

**Response:**
```json
{
  "id": "rate-uuid",
  "baseCurrency": "INR",
  "targetCurrency": "USD",
  "rate": "0.012",
  "source": "manual",
  "message": "Exchange rate updated successfully"
}
```

#### Sync Exchange Rates from API

```http
POST /exchange-rates/sync?baseCurrency=INR
```

**Response:**
```json
{
  "baseCurrency": "INR",
  "updated": 8,
  "failed": 0,
  "message": "Synced 8 exchange rates, 0 failed"
}
```

### Email Notifications

#### List Email Notifications

```http
GET /organisations/{organisationId}/email-notifications?status=sent&limit=50&offset=0
GET /invoices/{invoiceId}/email-notifications
GET /payments/{paymentId}/email-notifications
```

**Response:**
```json
{
  "emailNotifications": [
    {
      "id": "notification-uuid",
      "organisationId": "org-uuid",
      "invoiceId": "invoice-uuid",
      "paymentId": null,
      "recipientEmail": "billing@example.com",
      "subject": "Invoice INV-2024-001 - 1000.00 INR",
      "messageId": "provider-message-id",
      "status": "sent",
      "errorMessage": null,
      "provider": "sendgrid",
      "metadata": {},
      "createdAt": "2024-01-15T10:00:00Z",
      "sentAt": "2024-01-15T10:00:01Z",
      "deliveredAt": null,
      "openedAt": null,
      "clickedAt": null
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

#### Get Email Notification

```http
GET /email-notifications/{notificationId}
```

**Response:** (Same structure as individual notification in list response)

## See Also

- [Event Ingestion API](./events)
- [Payment API](./payments)
- [API Examples](./examples)
