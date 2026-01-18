import { Env } from '../types/env.js';
import { Logger, createLogger } from '../utils/logger.js';
import { MetricsCollector, createMetricsCollector } from '../utils/metrics.js';
import { AlertManager, createAlertManager } from '../utils/alerts.js';

/**
 * Observability Middleware
 * 
 * Provides logging, metrics, and alerting for all operations.
 * Should be initialized once per request/operation.
 */

export interface ObservabilityContext {
  logger: Logger;
  metrics: MetricsCollector;
  alerts: AlertManager;
  requestId: string;
}

/**
 * Create observability context for a request/operation
 */
export function createObservabilityContext(env: Env, requestId?: string): ObservabilityContext {
  const logger = createLogger(env);
  const metrics = createMetricsCollector(env);
  const alerts = createAlertManager(logger, metrics);
  const id = requestId || `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  return {
    logger,
    metrics,
    alerts,
    requestId: id,
  };
}

/**
 * Track operation with observability
 * 
 * Wraps an operation with logging, metrics, and error tracking.
 */
export async function trackOperation<T>(
  context: ObservabilityContext,
  operation: string,
  operationContext: Record<string, unknown> = {},
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();

  context.logger.logOperationStart(operation, {
    requestId: context.requestId,
    ...operationContext,
  });

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    context.logger.logOperationComplete(operation, duration, {
      requestId: context.requestId,
      ...operationContext,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    context.logger.logOperationFailure(operation, error, duration, {
      requestId: context.requestId,
      ...operationContext,
    });

    throw error;
  }
}
