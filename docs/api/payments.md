# Payment API

Create payment orders for invoices using Razorpay.

## Endpoint

```
POST /api/v1/payments/orders
```

## Authentication

```bash
Authorization: Bearer YOUR_ADMIN_API_KEY
```

## Request Body

```json
{
  "invoice_id": "invoice-uuid"
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `invoice_id` | string | Yes | UUID of the invoice to create payment order for |

## Response

### Success (201 Created)

```json
{
  "order": {
    "id": "order_xxxxxxxxxxxxx",
    "entity": "order",
    "amount": 100000,
    "amount_paid": 0,
    "amount_due": 100000,
    "currency": "INR",
    "receipt": null,
    "status": "created",
    "created_at": 1640995200
  },
  "payment": {
    "id": "payment-uuid",
    "invoiceId": "invoice-uuid",
    "razorpayOrderId": "order_xxxxxxxxxxxxx",
    "amount": "1000.00",
    "currency": "INR",
    "status": "pending"
  }
}
```

### Error (400 Bad Request)

```json
{
  "error": "Invoice not found",
  "code": "NOT_FOUND",
  "statusCode": 404
}
```

## Payment Flow

1. **Create Payment Order**: Use this API to create a Razorpay order
2. **Redirect to Razorpay**: Use the `order.id` to redirect user to Razorpay checkout
3. **Webhook Processing**: Razorpay sends webhook when payment is completed
4. **Verify Payment**: Check payment status via Admin API

## Razorpay Integration

### Redirect to Razorpay Checkout

```javascript
// Using Razorpay Checkout
const options = {
  key: 'rzp_test_xxxxxxxxxxxxx', // Your Razorpay key
  amount: order.amount,
  currency: order.currency,
  order_id: order.id,
  name: 'Your Company',
  description: 'Invoice Payment',
  handler: function(response) {
    // Payment successful
    console.log(response);
  }
};

const rzp = new Razorpay(options);
rzp.open();
```

### Verify Payment

After payment, verify via webhook or by checking payment status:

```bash
curl https://your-worker.workers.dev/api/v1/admin/organisations/{orgId}/payments \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

## Webhooks

Razorpay sends webhooks to:
```
POST /webhooks/razorpay
```

The platform automatically processes:
- `payment.captured` - Payment successful
- `payment.failed` - Payment failed

Webhook signature is verified automatically.

## Examples

### cURL

```bash
curl -X POST https://your-worker.workers.dev/api/v1/payments/orders \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": "invoice-uuid"
  }'
```

### JavaScript

```javascript
const response = await fetch('https://your-worker.workers.dev/api/v1/payments/orders', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminApiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    invoice_id: invoiceId
  })
});

const { order, payment } = await response.json();

// Redirect to Razorpay
const rzp = new Razorpay({
  key: 'rzp_test_xxxxxxxxxxxxx',
  amount: order.amount,
  currency: order.currency,
  order_id: order.id,
  handler: function(response) {
    // Payment successful
  }
});
rzp.open();
```

## Error Codes

- `NOT_FOUND` - Invoice not found
- `VALIDATION_ERROR` - Invalid request body
- `INVOICE_NOT_FINALIZED` - Invoice must be finalized before payment
- `PAYMENT_ALREADY_EXISTS` - Payment order already exists for this invoice

## Refunds

The platform supports full and partial refunds for captured payments.

### Create Refund

```http
POST /api/v1/admin/payments/{paymentId}/refunds
```

**Request:**
```json
{
  "amount": "500.00",  // Optional: for partial refund. Omit for full refund
  "reason": "Customer request"
}
```

**Response:**
```json
{
  "id": "refund-uuid",
  "refundNumber": "REF-INV-2024-001-1234567890",
  "paymentId": "payment-uuid",
  "amount": "500.00",
  "status": "processed",
  "refundType": "partial",
  "razorpayRefundId": "rfnd_xxxxxxxxxxxxx"
}
```

### Refund Status

Refunds can have the following statuses:
- `pending` - Refund initiated, awaiting processing
- `processed` - Refund successfully processed
- `failed` - Refund processing failed
- `cancelled` - Refund cancelled

### Refund Webhooks

Razorpay sends webhooks for refund events:
- `refund.processed` - Refund successfully processed
- `refund.failed` - Refund processing failed

The platform automatically updates refund status from webhooks.

### Automatic Status Updates

When a refund is processed:
- Payment status is updated to `refunded` or `partially_refunded`
- Invoice status is updated to `refunded` if payment is fully refunded

## Payment Retry

Failed payments are automatically retried with exponential backoff.

### Automatic Retry

- **Schedule**: Every 6 hours
- **Max Retries**: 3 attempts (configurable)
- **Backoff**: 24h, 48h, 96h between retries
- **Process**: Creates new Razorpay order for retry

### Retry Eligibility

A payment is eligible for retry if:
- Status is `failed`
- Retry count < max retries
- Next retry time has passed (or null)

### Manual Retry

You can manually retry a payment via API:

```bash
POST /api/v1/admin/payments/{paymentId}/retry
```

### Retry Status

Check retry status and history:

```bash
GET /api/v1/admin/payments/{paymentId}/retry-status
```

## See Also

- [Admin API](./admin) - View invoices, payments, refunds, and retry status
- [Razorpay Integration Guide](/RAZORPAY_INTEGRATION) - Complete integration guide
