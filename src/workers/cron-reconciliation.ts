/**
 * Reconciliation Cron Job
 * 
 * Runs daily to reconcile:
 * 1. D1 events vs RDS events (detect data loss)
 * 2. Razorpay payments vs our payment records (detect missing payments)
 * 
 * Schedule: Daily at 2 AM UTC
 */

import { Env } from '../types/env.js';
import { createRdsPool } from '../db/rds.js';
import {
  reconcileD1RdsEvents,
  reconcileRazorpayPayments,
  reconcileUsageAggregates,
  getReconciliationDiscrepancies,
} from '../services/reconciliation.js';
import { createLogger } from '../utils/logger.js';
import { createMetricsCollector } from '../utils/metrics.js';
import { createAlertManager } from '../utils/alerts.js';

export async function handleReconciliation(
  event: ScheduledEvent,
  env: Env
): Promise<void> {
  const logger = createLogger(env);
  const metrics = createMetricsCollector(env);
  const alerts = createAlertManager(logger, metrics);

  const startTime = Date.now();
  logger.info('Starting reconciliation job', {
    cronTime: event.scheduledTime,
  });

  try {
    const rdsPool = createRdsPool(env);

    // Reconcile D1 vs RDS events
    logger.info('Reconciling D1 vs RDS events');
    const d1RdsResults = await reconcileD1RdsEvents(
      rdsPool,
      env.EVENTS_DB
    );

    const d1RdsDiscrepancies = d1RdsResults.filter(
      (r) => r.status === 'discrepancy' || r.status === 'error'
    );
    const d1RdsErrors = d1RdsResults.filter((r) => r.status === 'error');

    logger.info('D1/RDS reconciliation complete', {
      total: d1RdsResults.length,
      discrepancies: d1RdsDiscrepancies.length,
      errors: d1RdsErrors.length,
    });

    // Alert on discrepancies
    if (d1RdsDiscrepancies.length > 0) {
      const alert = alerts.checkThreshold(
        'reconciliation.d1_rds.discrepancies',
        d1RdsDiscrepancies.length
      );
      if (alert) {
        logger.error('D1/RDS reconciliation discrepancies detected', {
          count: d1RdsDiscrepancies.length,
          discrepancies: d1RdsDiscrepancies.slice(0, 10), // Log first 10
        });
      }
    }

    // Reconcile Razorpay payments
    logger.info('Reconciling Razorpay payments');
    const paymentResults = await reconcileRazorpayPayments(
      rdsPool,
      env
    );

    const paymentDiscrepancies = paymentResults.filter(
      (r) => r.status === 'discrepancy' || r.status === 'error'
    );
    const paymentErrors = paymentResults.filter((r) => r.status === 'error');

    logger.info('Payment reconciliation complete', {
      total: paymentResults.length,
      discrepancies: paymentDiscrepancies.length,
      errors: paymentErrors.length,
    });

    // Alert on discrepancies
    if (paymentDiscrepancies.length > 0) {
      const alert = alerts.checkThreshold(
        'reconciliation.payments.discrepancies',
        paymentDiscrepancies.length
      );
      if (alert) {
        logger.error('Payment reconciliation discrepancies detected', {
          count: paymentDiscrepancies.length,
          discrepancies: paymentDiscrepancies.slice(0, 10), // Log first 10
        });
      }
    }

    // Reconcile usage aggregates
    logger.info('Reconciling usage aggregates');
    const aggregateResults = await reconcileUsageAggregates(
      rdsPool,
      env.EVENTS_DB
    );

    const aggregateDiscrepancies = aggregateResults.filter(
      (r) => r.status === 'discrepancy' || r.status === 'error'
    );
    const aggregateErrors = aggregateResults.filter((r) => r.status === 'error');

    logger.info('Usage aggregate reconciliation complete', {
      total: aggregateResults.length,
      discrepancies: aggregateDiscrepancies.length,
      errors: aggregateErrors.length,
    });

    // Alert on discrepancies
    if (aggregateDiscrepancies.length > 0) {
      const alert = alerts.checkThreshold(
        'reconciliation.aggregates.discrepancies',
        aggregateDiscrepancies.length
      );
      if (alert) {
        logger.error('Usage aggregate reconciliation discrepancies detected', {
          count: aggregateDiscrepancies.length,
          discrepancies: aggregateDiscrepancies.slice(0, 10), // Log first 10
        });
      }
    }

    // Get all discrepancies for reporting
    const allDiscrepancies = await getReconciliationDiscrepancies(rdsPool, 7);

    const duration = Date.now() - startTime;
    logger.info('Reconciliation job complete', {
      duration,
      d1RdsDiscrepancies: allDiscrepancies.d1RdsDiscrepancies.length,
      paymentDiscrepancies: allDiscrepancies.paymentDiscrepancies.length,
      aggregateDiscrepancies: aggregateDiscrepancies.length,
    });

    metrics.trackOperation('reconciliation', duration, {
      d1RdsTotal: d1RdsResults.length,
      d1RdsDiscrepancies: d1RdsDiscrepancies.length,
      paymentTotal: paymentResults.length,
      paymentDiscrepancies: paymentDiscrepancies.length,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logError(error as Error, {
      operation: 'reconciliation',
      duration,
    });

    // Alert on reconciliation failures
    const alert = alerts.checkThreshold('reconciliation.failures', 1);
    if (alert) {
      logger.error('Reconciliation job failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    metrics.trackOperation('reconciliation', duration, {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}
