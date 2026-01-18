import { Env } from '../types/env.js';
import {
  processRazorpayWebhook,
  verifyRazorpayWebhook,
  RazorpayPaymentWebhook,
} from '../services/razorpay-payments.js';
import { processRazorpayRefundWebhook } from '../services/refund-service.js';
import { sendPaymentConfirmationEmail } from '../services/payment-email.js';
import { createRdsPool } from '../db/rds.js';
import { formatError, ValidationError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

/**
 * Razorpay webhook handler
 * 
 * Security:
 * - Verifies webhook signature before processing
 * - Idempotent processing (safe to retry)
 * - Comprehensive error logging
 * 
 * Failure Handling:
 * - Returns 200 for unhandled events (prevents Razorpay retries)
 * - Returns 400 for validation errors
 * - Returns 500 for processing errors (Razorpay will retry)
 */

export async function handleRazorpayWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Get webhook signature
    const signature = request.headers.get('X-Razorpay-Signature');
    if (!signature) {
      throw new ValidationError('Missing X-Razorpay-Signature header');
    }

    // Get raw body for signature verification
    // Important: Must read as text before parsing JSON
    const rawBody = await request.text();

    // Verify signature FIRST (before any processing)
    const isValid = await verifyRazorpayWebhook(env, rawBody, signature);
    if (!isValid) {
      // Log security event
      console.error('Invalid webhook signature', {
        signature: signature.substring(0, 10) + '...', // Log partial for debugging
        bodyLength: rawBody.length,
      });
      throw new ValidationError('Invalid webhook signature');
    }

    // Parse webhook payload
    let webhook: RazorpayPaymentWebhook;
    try {
      webhook = JSON.parse(rawBody);
    } catch (error) {
      throw new ValidationError('Invalid JSON in webhook payload');
    }

    const rdsPool = createRdsPool(env);

    // Handle refund webhooks
    if (webhook.event && webhook.event.startsWith('refund.')) {
      try {
        const refund = await processRazorpayRefundWebhook(rdsPool, env, webhook as any);
        return new Response(
          JSON.stringify({
            message: 'Refund webhook processed successfully',
            refundId: refund.id,
            refundNumber: refund.refundNumber,
            status: refund.status,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        const formattedError = formatError(error);
        return new Response(JSON.stringify(formattedError), {
          status: formattedError.statusCode,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Handle payment webhooks
    if (webhook.event && webhook.event.startsWith('payment.')) {
      const paymentResult = await processRazorpayWebhook(rdsPool, env, webhook);
      const payment = paymentResult.result;

      // Send payment confirmation email (non-blocking)
      // Only send for successful payments
      if (payment.status === 'captured' || payment.status === 'paid') {
        try {
          await sendPaymentConfirmationEmail(env, rdsPool, payment);
        } catch (emailError) {
          // Log but don't fail webhook processing if email fails
          const logger = createLogger(env);
          logger.error('Failed to send payment confirmation email', {
            paymentId: payment.id,
            error: emailError instanceof Error ? emailError.message : String(emailError),
          });
        }
      }

      return new Response(
        JSON.stringify({
          message: 'Webhook processed successfully',
          paymentId: payment.id,
          status: payment.status,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Return 200 for unhandled events (prevents Razorpay from retrying)
    return new Response(
      JSON.stringify({ message: 'Event type not handled', event: webhook.event }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const formattedError = formatError(error);

    // Log error for monitoring
    console.error('Razorpay webhook processing error:', {
      error: formattedError.error,
      code: formattedError.code,
      statusCode: formattedError.statusCode,
      details: formattedError.details,
    });

    // Return appropriate status code
    // 4xx errors: Don't retry (validation errors)
    // 5xx errors: Razorpay will retry (processing errors)
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
