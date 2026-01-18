import { Env } from '../types/env.js';

/**
 * Metrics Collection Utility
 * 
 * Collects metrics for:
 * - Ingestion rate (events per second)
 * - Billing failures (invoice generation failures)
 * - Payment failures (payment processing failures)
 * - System health (latency, errors, etc.)
 * 
 * Metrics are sent to external service (e.g., Datadog, Cloudflare Analytics)
 * or stored for analysis.
 */

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
}

export interface Metric {
  name: string;
  type: MetricType;
  value: number;
  tags: Record<string, string>;
  timestamp: number;
}

export interface MetricContext {
  organisationId?: string;
  projectId?: string;
  invoiceId?: string;
  paymentId?: string;
  errorCode?: string;
  statusCode?: number;
  [key: string]: string | number | undefined;
}

/**
 * Metrics Collector
 * 
 * Collects and emits metrics for observability.
 */
export class MetricsCollector {
  private environment: string;
  private service: string;
  private metrics: Metric[] = [];
  private batchSize: number = 100;
  private flushInterval: number = 60000; // 1 minute

  constructor(env: Env) {
    this.environment = env.ENVIRONMENT || 'development';
    this.service = 'metrics-billable-platform';

    // Auto-flush metrics periodically
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.flush(), this.flushInterval);
    }
  }

  /**
   * Create metric with standard tags
   */
  private createMetric(
    name: string,
    type: MetricType,
    value: number,
    context: MetricContext = {}
  ): Metric {
    return {
      name: `${this.service}.${name}`,
      type,
      value,
      tags: {
        environment: this.environment,
        service: this.service,
        ...Object.fromEntries(
          Object.entries(context).map(([k, v]) => [k, String(v)])
        ),
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Increment counter metric
   */
  increment(name: string, context: MetricContext = {}): void {
    const metric = this.createMetric(name, MetricType.COUNTER, 1, context);
    this.recordMetric(metric);
  }

  /**
   * Set gauge metric
   */
  gauge(name: string, value: number, context: MetricContext = {}): void {
    const metric = this.createMetric(name, MetricType.GAUGE, value, context);
    this.recordMetric(metric);
  }

  /**
   * Record histogram metric (for latency, sizes, etc.)
   */
  histogram(name: string, value: number, context: MetricContext = {}): void {
    const metric = this.createMetric(name, MetricType.HISTOGRAM, value, context);
    this.recordMetric(metric);
  }

  /**
   * Record metric (adds to buffer)
   */
  private recordMetric(metric: Metric): void {
    this.metrics.push(metric);

    // Flush if batch size reached
    if (this.metrics.length >= this.batchSize) {
      this.flush();
    }
  }

  /**
   * Flush metrics to external service
   * 
   * In production, this would send to:
   * - Datadog
   * - Cloudflare Analytics
   * - Prometheus
   * - Custom metrics service
   */
  flush(): void {
    if (this.metrics.length === 0) {
      return;
    }

    const metricsToFlush = [...this.metrics];
    this.metrics = [];

    // In production, send to metrics service
    // For now, log metrics (can be sent to external service)
    console.log(JSON.stringify({
      type: 'metrics_batch',
      count: metricsToFlush.length,
      metrics: metricsToFlush,
    }));

    // Example: Send to external service
    // await fetch('https://metrics.example.com/api/metrics', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ metrics: metricsToFlush }),
    // });
  }

  // ============================================================================
  // Specific Metrics
  // ============================================================================

  /**
   * Track event ingestion
   */
  trackEventIngestion(
    success: boolean,
    duration: number,
    context: MetricContext = {}
  ): void {
    if (success) {
      this.increment('events.ingested', context);
      this.histogram('events.ingestion.duration', duration, context);
    } else {
      this.increment('events.ingestion.failed', context);
    }
  }

  /**
   * Track billing operations
   */
  trackBillingOperation(
    operation: 'invoice_generated' | 'invoice_finalized' | 'invoice_failed',
    duration: number,
    context: MetricContext = {}
  ): void {
    this.increment(`billing.${operation}`, context);
    this.histogram(`billing.${operation}.duration`, duration, context);

    if (operation === 'invoice_failed') {
      this.increment('billing.failures', context);
    }
  }

  /**
   * Track payment operations
   */
  trackPaymentOperation(
    operation: 'order_created' | 'payment_captured' | 'payment_failed' | 'webhook_processed',
    duration: number,
    context: MetricContext = {}
  ): void {
    this.increment(`payments.${operation}`, context);
    this.histogram(`payments.${operation}.duration`, duration, context);

    if (operation === 'payment_failed') {
      this.increment('payments.failures', context);
    }
  }

  /**
   * Track API requests
   */
  trackApiRequest(
    endpoint: string,
    method: string,
    statusCode: number,
    duration: number,
    context: MetricContext = {}
  ): void {
    this.increment('api.requests', {
      ...context,
      endpoint,
      method,
      statusCode: String(statusCode),
    });

    this.histogram('api.request.duration', duration, {
      ...context,
      endpoint,
      method,
    });

    if (statusCode >= 400) {
      this.increment('api.errors', {
        ...context,
        endpoint,
        method,
        statusCode: String(statusCode),
      });
    }
  }

  /**
   * Track database operations
   */
  trackDatabaseOperation(
    operation: string,
    duration: number,
    success: boolean,
    context: MetricContext = {}
  ): void {
    this.histogram('database.operation.duration', duration, {
      ...context,
      operation,
    });

    if (success) {
      this.increment('database.operations.success', { ...context, operation });
    } else {
      this.increment('database.operations.failed', { ...context, operation });
    }
  }

  /**
   * Track queue operations
   */
  trackQueueOperation(
    operation: 'message_sent' | 'message_processed' | 'message_failed',
    duration: number,
    context: MetricContext = {}
  ): void {
    this.increment(`queue.${operation}`, context);
    this.histogram(`queue.${operation}.duration`, duration, context);
  }
}

/**
 * Create metrics collector instance
 */
export function createMetricsCollector(env: Env): MetricsCollector {
  return new MetricsCollector(env);
}
