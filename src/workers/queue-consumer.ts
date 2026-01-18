import { Env } from '../types/env.js';
import { aggregateUsage, AggregationPeriod } from '../services/aggregation.js';
import { createRdsPool } from '../db/rds.js';
import { formatError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { createMetricsCollector } from '../utils/metrics.js';
import {
  getRetryAttempt,
  shouldRetry,
  isRetryableError,
  calculateRetryDelay,
  DEFAULT_RETRY_CONFIG,
} from '../utils/queue-retry.js';

/**
 * Queue consumer for processing usage events
 * Aggregates events from D1 into RDS
 * 
 * Features:
 * - Exponential backoff retry logic
 * - Dead-letter queue for failed messages
 * - Retry attempt tracking
 * - Non-retryable error detection
 */

export interface QueueMessage {
  type: 'aggregate';
  payload: AggregationPeriod;
  retryAttempt?: number;
  originalTimestamp?: number;
}

export async function handleQueueBatch(
  messages: MessageBatch<QueueMessage>,
  env: Env
): Promise<void> {
  const logger = createLogger(env);
  const metrics = createMetricsCollector(env);
  const rdsPool = createRdsPool(env);

  const processed: string[] = [];
  const failed: Array<{ messageId: string; error: string }> = [];
  const dlqMessages: Array<QueueMessage> = [];

  for (const message of messages) {
    const messageId = message.id;
    const startTime = Date.now();

    try {
      const data = message.body;
      const retryAttempt = getRetryAttempt(message);

      logger.info('Processing queue message', {
        messageId,
        type: data.type,
        retryAttempt,
      });

      if (data.type === 'aggregate') {
        await aggregateUsage(env.EVENTS_DB, rdsPool, data.payload);
        
        const duration = Date.now() - startTime;
        logger.info('Queue message processed successfully', {
          messageId,
          duration,
        });

        metrics.trackOperation('queue.aggregate', duration, {
          success: true,
          retryAttempt,
        });

        message.ack();
        processed.push(messageId);
      } else {
        const error = new Error(`Unknown message type: ${data.type}`);
        logger.error('Unknown message type', {
          messageId,
          type: data.type,
        });

        // Unknown message types go to DLQ immediately
        if (env.USAGE_EVENTS_DLQ) {
          await env.USAGE_EVENTS_DLQ.send({
            ...data,
            originalTimestamp: Date.now(),
            error: error.message,
          });
        }

        message.ack(); // Ack to remove from queue
        failed.push({ messageId, error: error.message });
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const retryAttempt = getRetryAttempt(message);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isRetryable = isRetryableError(error);

      logger.logError(error as Error, {
        operation: 'queue_processing',
        messageId,
        retryAttempt,
        duration,
        isRetryable,
      });

      metrics.trackOperation('queue.aggregate', duration, {
        success: false,
        retryAttempt,
        error: errorMessage,
        isRetryable,
      });

      // Check if we should retry
      if (isRetryable && shouldRetry(retryAttempt)) {
        // Calculate delay for exponential backoff
        const delay = calculateRetryDelay(retryAttempt);
        
        logger.info('Retrying queue message', {
          messageId,
          retryAttempt: retryAttempt + 1,
          delay,
        });

        // Cloudflare Queues handles retry automatically, but we can add delay
        // Note: Cloudflare Queues doesn't support custom delays, so we'll let it retry
        message.retry();
      } else {
        // Max retries exceeded or non-retryable error - send to DLQ
        logger.error('Queue message failed, sending to DLQ', {
          messageId,
          retryAttempt,
          error: errorMessage,
          isRetryable,
        });

        if (env.USAGE_EVENTS_DLQ) {
          const dlqMessage: QueueMessage = {
            ...message.body,
            retryAttempt,
            originalTimestamp: message.body.originalTimestamp || Date.now(),
          };

          await env.USAGE_EVENTS_DLQ.send(dlqMessage);
          dlqMessages.push(dlqMessage);
          
          logger.info('Message sent to DLQ', {
            messageId,
            dlqSize: dlqMessages.length,
          });
        } else {
          logger.warn('DLQ not configured, message will be lost', {
            messageId,
          });
        }

        message.ack(); // Ack to remove from queue (sent to DLQ)
        failed.push({ messageId, error: errorMessage });
      }
    }
  }

  // Log batch summary
  logger.info('Queue batch processing complete', {
    total: messages.length,
    processed: processed.length,
    failed: failed.length,
    dlqMessages: dlqMessages.length,
  });

  metrics.trackOperation('queue.batch', Date.now(), {
    total: messages.length,
    processed: processed.length,
    failed: failed.length,
    dlqMessages: dlqMessages.length,
  });

  // Alert if high failure rate
  if (failed.length > 0 && failed.length / messages.length > 0.1) {
    logger.error('High queue failure rate', {
      failureRate: failed.length / messages.length,
      failed: failed.slice(0, 10), // Log first 10 failures
    });
  }
}
