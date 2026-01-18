/**
 * Custom error types for explicit error handling
 */

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

export class ValidationError extends BillingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends BillingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', 404, details);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends BillingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, details);
    this.name = 'ConflictError';
  }
}

export class IdempotencyError extends ConflictError {
  constructor(message: string, public readonly existingEntityId: string) {
    super(message, { existingEntityId });
    this.name = 'IdempotencyError';
  }
}

export class DatabaseError extends BillingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DATABASE_ERROR', 500, details);
    this.name = 'DatabaseError';
  }
}

export class PaymentError extends BillingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PAYMENT_ERROR', 500, details);
    this.name = 'PaymentError';
  }
}

/**
 * Format error for API response
 */
export function formatError(error: unknown): {
  error: string;
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;
} {
  if (error instanceof BillingError) {
    return {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      error: error.message,
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    };
  }

  return {
    error: 'Unknown error occurred',
    code: 'UNKNOWN_ERROR',
    statusCode: 500,
  };
}
