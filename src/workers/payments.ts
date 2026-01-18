import { Env } from '../types/env.js';
import { createRazorpayOrderForInvoice } from '../services/razorpay-payments.js';
import { createRdsPool } from '../db/rds.js';
import { formatError, ValidationError, NotFoundError } from '../utils/errors.js';

/**
 * Payment API endpoints
 * 
 * POST /api/v1/payments/orders
 * Creates Razorpay order for a finalized invoice
 */

export async function handleCreatePaymentOrder(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      throw new ValidationError('Invalid JSON in request body');
    }

    // Validate request
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Request body must be an object');
    }

    const { invoiceId, customerId } = body as {
      invoiceId?: string;
      customerId?: string;
    };

    if (!invoiceId || typeof invoiceId !== 'string') {
      throw new ValidationError('invoiceId is required and must be a string');
    }

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(invoiceId)) {
      throw new ValidationError('invoiceId must be a valid UUID');
    }

    // Create Razorpay order
    const rdsPool = createRdsPool(env);
    const { order, payment } = await createRazorpayOrderForInvoice(
      rdsPool,
      env,
      invoiceId,
      customerId
    );

    return new Response(
      JSON.stringify({
        orderId: order.id,
        paymentId: payment.id,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        receipt: order.receipt,
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);

    // Log error
    console.error('Create payment order error:', {
      error: formattedError.error,
      code: formattedError.code,
      details: formattedError.details,
    });

    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
