import { MetricsCollector } from './metrics.js';
import { Logger, LogLevel } from './logger.js';

/**
 * Alerting System
 * 
 * Monitors metrics and triggers alerts when thresholds are exceeded.
 * 
 * Alert Types:
 * - Critical: Immediate action required
 * - Warning: Attention needed, but not critical
 * - Info: Informational alerts
 */

export enum AlertSeverity {
  CRITICAL = 'critical',
  WARNING = 'warning',
  INFO = 'info',
}

export interface AlertThreshold {
  metric: string;
  threshold: number;
  severity: AlertSeverity;
  condition: 'above' | 'below' | 'equals';
  window: number; // Time window in seconds
  description: string;
}

export interface Alert {
  id: string;
  severity: AlertSeverity;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: Date;
  context: Record<string, unknown>;
}

/**
 * Alert Manager
 * 
 * Monitors metrics and triggers alerts based on thresholds.
 */
export class AlertManager {
  private thresholds: AlertThreshold[] = [];
  private logger: Logger;
  private metrics: MetricsCollector;

  constructor(logger: Logger, metrics: MetricsCollector) {
    this.logger = logger;
    this.metrics = metrics;
    this.initializeThresholds();
  }

  /**
   * Initialize alert thresholds
   */
  private initializeThresholds(): void {
    this.thresholds = [
      // Ingestion rate alerts
      {
        metric: 'events.ingestion.failed',
        threshold: 10, // 10 failures per minute
        severity: AlertSeverity.WARNING,
        condition: 'above',
        window: 60,
        description: 'High event ingestion failure rate',
      },
      {
        metric: 'events.ingestion.failed',
        threshold: 50, // 50 failures per minute
        severity: AlertSeverity.CRITICAL,
        condition: 'above',
        window: 60,
        description: 'Critical event ingestion failure rate',
      },

      // Billing failure alerts
      {
        metric: 'billing.failures',
        threshold: 5, // 5 failures per hour
        severity: AlertSeverity.WARNING,
        condition: 'above',
        window: 3600,
        description: 'High billing failure rate',
      },
      {
        metric: 'billing.failures',
        threshold: 20, // 20 failures per hour
        severity: AlertSeverity.CRITICAL,
        condition: 'above',
        window: 3600,
        description: 'Critical billing failure rate',
      },

      // Payment failure alerts
      {
        metric: 'payments.failures',
        threshold: 3, // 3 failures per hour
        severity: AlertSeverity.WARNING,
        condition: 'above',
        window: 3600,
        description: 'High payment failure rate',
      },
      {
        metric: 'payments.failures',
        threshold: 10, // 10 failures per hour
        severity: AlertSeverity.CRITICAL,
        condition: 'above',
        window: 3600,
        description: 'Critical payment failure rate',
      },

      // API error rate alerts
      {
        metric: 'api.errors',
        threshold: 100, // 100 errors per minute
        severity: AlertSeverity.WARNING,
        condition: 'above',
        window: 60,
        description: 'High API error rate',
      },
      {
        metric: 'api.errors',
        threshold: 500, // 500 errors per minute
        severity: AlertSeverity.CRITICAL,
        condition: 'above',
        window: 60,
        description: 'Critical API error rate',
      },

      // Database failure alerts
      {
        metric: 'database.operations.failed',
        threshold: 10, // 10 failures per minute
        severity: AlertSeverity.WARNING,
        condition: 'above',
        window: 60,
        description: 'High database failure rate',
      },
      {
        metric: 'database.operations.failed',
        threshold: 50, // 50 failures per minute
        severity: AlertSeverity.CRITICAL,
        condition: 'above',
        window: 60,
        description: 'Critical database failure rate',
      },

      // Latency alerts
      {
        metric: 'api.request.duration',
        threshold: 5000, // 5 seconds
        severity: AlertSeverity.WARNING,
        condition: 'above',
        window: 300,
        description: 'High API latency (P95)',
      },
      {
        metric: 'api.request.duration',
        threshold: 10000, // 10 seconds
        severity: AlertSeverity.CRITICAL,
        condition: 'above',
        window: 300,
        description: 'Critical API latency (P95)',
      },
    ];
  }

  /**
   * Check if metric exceeds threshold
   * 
   * In production, this would query metrics service for current values.
   */
  checkThreshold(metric: string, value: number): Alert | null {
    const threshold = this.thresholds.find((t) => t.metric === metric);
    if (!threshold) {
      return null;
    }

    let triggered = false;
    switch (threshold.condition) {
      case 'above':
        triggered = value > threshold.threshold;
        break;
      case 'below':
        triggered = value < threshold.threshold;
        break;
      case 'equals':
        triggered = value === threshold.threshold;
        break;
    }

    if (triggered) {
      return this.createAlert(threshold, value);
    }

    return null;
  }

  /**
   * Create alert
   */
  private createAlert(threshold: AlertThreshold, value: number): Alert {
    const alert: Alert = {
      id: `${threshold.metric}_${Date.now()}`,
      severity: threshold.severity,
      metric: threshold.metric,
      value,
      threshold: threshold.threshold,
      message: `${threshold.description}: ${value} ${threshold.condition} ${threshold.threshold}`,
      timestamp: new Date(),
      context: {
        condition: threshold.condition,
        window: threshold.window,
      },
    };

    // Log alert
    const logLevel =
      threshold.severity === AlertSeverity.CRITICAL
        ? LogLevel.ERROR
        : threshold.severity === AlertSeverity.WARNING
        ? LogLevel.WARN
        : LogLevel.INFO;

    this.logger[logLevel](alert.message, {
      alertId: alert.id,
      metric: alert.metric,
      value: alert.value,
      threshold: alert.threshold,
      severity: alert.severity,
    });

    // In production, send to alerting service (PagerDuty, Slack, etc.)
    // await sendAlert(alert);

    return alert;
  }

  /**
   * Get all thresholds
   */
  getThresholds(): AlertThreshold[] {
    return [...this.thresholds];
  }
}

/**
 * Create alert manager instance
 */
export function createAlertManager(
  logger: Logger,
  metrics: MetricsCollector
): AlertManager {
  return new AlertManager(logger, metrics);
}
