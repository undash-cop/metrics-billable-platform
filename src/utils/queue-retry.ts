/**
 * Queue Retry Utilities
 * 
 * Implements exponential backoff retry logic for queue message processing.
 * Messages that fail after max retries are sent to dead-letter queue.
 */

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000, // 1 second
  maxDelayMs: 60000, // 60 seconds
  backoffMultiplier: 2,
};

/**
 * Calculate delay for retry attempt using exponential backoff
 */
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const delay = Math.min(
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelayMs
  );
  
  // Add jitter to prevent thundering herd
  const jitter = Math.random() * 0.3 * delay; // Up to 30% jitter
  return Math.floor(delay + jitter);
}

/**
 * Check if message should be retried based on attempt count
 */
export function shouldRetry(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): boolean {
  return attempt < config.maxRetries;
}

/**
 * Get retry attempt count from message metadata
 */
export function getRetryAttempt(message: Message): number {
  // Cloudflare Queues tracks retry count in message.attempts
  return message.attempts || 0;
}

/**
 * Check if error is retryable
 * Some errors should not be retried (e.g., validation errors)
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Don't retry validation errors or authentication errors
    const nonRetryablePatterns = [
      /validation/i,
      /invalid/i,
      /unauthorized/i,
      /forbidden/i,
      /not found/i,
      /duplicate/i,
    ];

    const errorMessage = error.message.toLowerCase();
    return !nonRetryablePatterns.some((pattern) => pattern.test(errorMessage));
  }

  // Unknown errors are retryable
  return true;
}
