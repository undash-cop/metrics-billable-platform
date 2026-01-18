# Razorpay Payment Integration

## Overview

Complete Razorpay payment integration for invoices with secure webhook handling, atomic status updates, and idempotent processing.

## Architecture

### Components

1. **Order Creation** (`createRazorpayOrderForInvoice`)
   - Creates Razorpay order for finalized invoice
   - Stores order_id in payment record
   - Validates invoice is finalized
   - Idempotent (can be called multiple times safely)

2. **Webhook Processing** (`processRazorpayWebhook`)
   - Verifies webhook signature
   - Processes payment updates
   - Atomically updates payment and invoice status
   - Idempotent (safe to retry)

3. **Webhook Handler** (`handleRazorpayWebhook`)
   - Validates webhook signature
   - Routes to appropriate handler
   - Returns appropriate status codes

## Security Considerations

### Webhook Signature Verification

**HMAC SHA-256 Signature**:
- Razorpay signs webhook payloads with HMAC SHA-256
- Signature is sent in `X-Razorpay-Signature` header
- We verify signature before processing any webhook

**Implementation**:
```typescript
const expectedSignature = await createHmacSha256(
  env.RAZORPAY_WEBHOOK_SECRET,
  payload
);
return timingSafeEqual(signature, expectedSignature);
```

**Security Benefits**:
- Prevents unauthorized webhook processing
- Ensures webhook authenticity
- Timing-safe comparison prevents timing attacks

### API Key Security

- API keys stored in environment variables
- Never logged or exposed in responses
- Basic Auth used for Razorpay API calls
- Credentials base64 encoded for transmission

### Data Validation

- Invoice must be finalized before creating order
- Amount validation (order amount matches invoice amount)
- UUID validation for invoice IDs
- Status validation before processing

## Idempotency Strategy

### Order Creation

**Idempotency Key**: Invoice ID + operation type

**Behavior**:
- Check if payment already exists for invoice
- If exists and not failed, return existing order
- If failed, allow retry
- Prevents duplicate orders for same invoice

### Webhook Processing

**Idempotency Key**: `razorpay_payment_{payment_id}`

**Behavior**:
- Uses `withIdempotency` wrapper
- Same webhook processed multiple times safely
- Returns existing payment if already processed
- Prevents duplicate payment records

**Why This Works**:
- Razorpay payment IDs are unique
- Same payment ID = same payment event
- Database unique constraint on `razorpay_payment_id`
- Idempotency table tracks processed payments

## Atomic Status Updates

### Transaction Flow

```typescript
await transaction(pool, async (client) => {
  // 1. Create/update payment record
  const payment = await createOrUpdatePayment(client, ...);
  
  // 2. Update invoice status if payment captured
  if (payment.status === 'captured') {
    await updateInvoiceStatus(client, invoiceId, 'paid');
  }
  
  // 3. Create audit logs
  await createAuditLog(...);
});
```

**Benefits**:
- All-or-nothing: Payment and invoice updated together
- No partial state: Either both succeed or both fail
- Data consistency: Invoice and payment always in sync
- Rollback on error: Transaction ensures consistency

## Failure Handling

### Order Creation Failures

**Network Errors**:
- Razorpay API unavailable → Returns error, can retry
- Timeout → Returns error, can retry
- Invalid response → Returns error, logs details

**Validation Errors**:
- Invoice not finalized → Returns 400, cannot retry
- Invoice already paid → Returns 400, cannot retry
- Amount mismatch → Returns 400, logs error

**Retry Strategy**:
- Network errors: Retry with exponential backoff
- Validation errors: Don't retry (fix data first)
- Idempotent: Safe to retry (returns existing order)

### Webhook Processing Failures

**Signature Verification Failure**:
- Invalid signature → Returns 400, don't retry
- Missing signature → Returns 400, don't retry
- Logged as security event

**Processing Errors**:
- Invoice not found → Returns 404, Razorpay will retry
- Database error → Returns 500, Razorpay will retry
- Validation error → Returns 400, don't retry

**Retry Strategy**:
- 4xx errors: Don't retry (validation errors)
- 5xx errors: Razorpay retries automatically
- Idempotent: Safe to retry (returns existing payment)

## API Endpoints

### Create Payment Order

**Endpoint**: `POST /api/v1/payments/orders`

**Request**:
```json
{
  "invoiceId": "uuid",
  "customerId": "razorpay_customer_id" // optional
}
```

**Response**:
```json
{
  "orderId": "order_xxx",
  "paymentId": "uuid",
  "amount": 100000, // in paise
  "currency": "INR",
  "status": "created",
  "receipt": "INV-202401-..."
}
```

**Errors**:
- `400`: Invalid request (invoice not finalized, etc.)
- `404`: Invoice not found
- `500`: Razorpay API error

### Webhook Endpoint

**Endpoint**: `POST /api/v1/webhooks/razorpay`

**Headers**:
- `X-Razorpay-Signature`: HMAC SHA-256 signature

**Response**:
```json
{
  "message": "Webhook processed successfully",
  "paymentId": "uuid",
  "status": "captured"
}
```

**Status Codes**:
- `200`: Success (or unhandled event type)
- `400`: Validation error (invalid signature, etc.)
- `404`: Invoice not found
- `500`: Processing error

## Payment Status Flow

```
pending → authorized → captured → (paid invoice)
         ↓
       failed
         ↓
      refunded
```

**Status Mapping**:
- `authorized`: Payment authorized but not captured
- `captured`: Payment captured successfully
- `failed`: Payment failed
- `refunded`: Payment refunded

**Invoice Status Updates**:
- Payment `captured` → Invoice `paid`
- Only updates if invoice not already paid
- Atomic transaction ensures consistency

## Database Schema

### Payments Table

```sql
CREATE TABLE payments (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL,
    invoice_id UUID NOT NULL,
    payment_number VARCHAR(50) UNIQUE,
    razorpay_order_id VARCHAR(255),
    razorpay_payment_id VARCHAR(255) UNIQUE,
    amount NUMERIC(20, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    status VARCHAR(20) NOT NULL,
    payment_method VARCHAR(100),
    paid_at TIMESTAMP WITH TIME ZONE,
    reconciled_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    ...
);
```

**Key Fields**:
- `razorpay_order_id`: Razorpay order ID (set when order created)
- `razorpay_payment_id`: Razorpay payment ID (set when webhook received)
- `status`: Payment status (pending, authorized, captured, failed, refunded)
- `reconciled_at`: When webhook verified payment

## Example Flow

### 1. Create Order

```typescript
const { order, payment } = await createRazorpayOrderForInvoice(
  pool,
  env,
  invoiceId,
  customerId
);

// Returns:
// - order.id: Razorpay order ID
// - payment.id: Our payment record ID
// - payment.razorpayOrderId: Stored in database
```

### 2. Customer Pays

Customer completes payment on Razorpay checkout.

### 3. Webhook Received

```typescript
// Webhook payload:
{
  "event": "payment.captured",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_xxx", // payment_id
        "order_id": "order_xxx", // order_id
        "status": "captured",
        "amount": 100000, // in paise
        ...
      }
    }
  }
}
```

### 4. Process Webhook

```typescript
// 1. Verify signature
const isValid = await verifyRazorpayWebhook(env, payload, signature);

// 2. Process payment
const payment = await processRazorpayWebhook(pool, env, webhook);

// 3. Atomically:
//    - Create/update payment record
//    - Update invoice status to 'paid'
//    - Create audit logs
```

## Testing

### Unit Tests

- Signature verification
- Status mapping
- Amount conversion (paise ↔ rupees)
- Idempotency logic

### Integration Tests

- Order creation end-to-end
- Webhook processing end-to-end
- Atomic transaction behavior
- Error handling

### Security Tests

- Invalid signature rejection
- Timing attack prevention
- SQL injection prevention
- XSS prevention

## Monitoring

### Key Metrics

- Order creation success rate
- Webhook processing success rate
- Payment reconciliation rate
- Average payment processing time
- Failed payment rate

### Alerts

- Webhook signature verification failures
- Payment processing errors
- Invoice/payment status mismatches
- Unreconciled payments

## Configuration

### Environment Variables

- `RAZORPAY_KEY_ID`: Razorpay API key ID
- `RAZORPAY_KEY_SECRET`: Razorpay API key secret
- `RAZORPAY_WEBHOOK_SECRET`: Webhook signature secret

### Razorpay Dashboard

1. Configure webhook URL: `https://your-domain.com/api/v1/webhooks/razorpay`
2. Select events: `payment.authorized`, `payment.captured`, `payment.failed`
3. Copy webhook secret to environment variables

## Best Practices

1. **Always verify signatures**: Never process webhooks without verification
2. **Use transactions**: Ensure atomic updates
3. **Idempotent operations**: Safe to retry
4. **Comprehensive logging**: Log all payment operations
5. **Monitor webhooks**: Track processing success/failure
6. **Handle failures gracefully**: Return appropriate status codes
7. **Validate data**: Check amounts, statuses, etc.
8. **Audit trail**: Log all payment changes

## Troubleshooting

### Order Creation Fails

1. Check invoice is finalized
2. Verify Razorpay API credentials
3. Check network connectivity
4. Review error logs

### Webhook Not Processed

1. Verify webhook signature
2. Check webhook URL configuration
3. Review webhook logs
4. Verify invoice exists

### Payment Not Updating Invoice

1. Check payment status is 'captured'
2. Verify invoice not already paid
3. Check transaction logs
4. Review audit logs
