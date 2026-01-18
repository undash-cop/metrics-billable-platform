/**
 * Reconciliation Services
 * 
 * Detects discrepancies between:
 * 1. D1 events vs RDS events (data loss detection)
 * 2. Razorpay orders vs our payment records (payment reconciliation)
 */

import pg from 'pg';
import { D1Database } from '@cloudflare/workers-types';
import { queryRds, transaction } from '../db/rds.js';
import { Env } from '../types/env.js';
import { DatabaseError } from '../utils/errors.js';

export interface D1RdsReconciliationResult {
  organisationId: string;
  projectId: string;
  metricName: string;
  reconciliationDate: Date;
  d1EventCount: number;
  rdsEventCount: number;
  discrepancyCount: number;
  status: 'reconciled' | 'discrepancy' | 'error';
}

export interface PaymentReconciliationResult {
  organisationId: string;
  reconciliationDate: Date;
  razorpayOrderCount: number;
  ourPaymentCount: number;
  unreconciledCount: number;
  status: 'reconciled' | 'discrepancy' | 'error';
}

/**
 * Reconcile D1 events with RDS events
 * 
 * Compares event counts between D1 and RDS to detect data loss.
 * Should be run daily to catch migration failures early.
 */
export async function reconcileD1RdsEvents(
  pool: pg.Pool,
  d1Db: D1Database,
  organisationId?: string,
  reconciliationDate?: Date
): Promise<D1RdsReconciliationResult[]> {
  const date = reconciliationDate || new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD

  // Get event counts from D1 (grouped by org/project/metric)
  const d1Counts = await d1Db
    .prepare(
      `SELECT 
        organisation_id,
        project_id,
        metric_name,
        COUNT(*) as event_count
       FROM usage_events
       WHERE DATE(datetime(ingested_at, 'unixepoch')) = ?
         ${organisationId ? 'AND organisation_id = ?' : ''}
       GROUP BY organisation_id, project_id, metric_name`
    )
    .bind(dateStr, ...(organisationId ? [organisationId] : []))
    .all<{
      organisation_id: string;
      project_id: string;
      metric_name: string;
      event_count: number;
    }>();

  const results: D1RdsReconciliationResult[] = [];

  for (const d1Count of d1Counts.results || []) {
    try {
      // Get event count from RDS for same org/project/metric/date
      const rdsResult = await queryRds<{ event_count: string }>(
        pool,
        `SELECT COUNT(*) as event_count
         FROM usage_events
         WHERE organisation_id = $1
           AND project_id = $2
           AND metric_name = $3
           AND DATE(ingested_at) = $4`,
        [
          d1Count.organisation_id,
          d1Count.project_id,
          d1Count.metric_name,
          dateStr,
        ]
      );

      const rdsCount = parseInt(rdsResult.rows[0].event_count, 10);
      const d1CountNum = d1Count.event_count;
      const discrepancy = Math.abs(d1CountNum - rdsCount);
      const status: 'reconciled' | 'discrepancy' | 'error' =
        discrepancy === 0 ? 'reconciled' : 'discrepancy';

      // Store reconciliation result
      await queryRds(
        pool,
        `INSERT INTO d1_rds_reconciliation (
          organisation_id, project_id, metric_name, reconciliation_date,
          d1_event_count, rds_event_count, discrepancy_count, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (organisation_id, project_id, metric_name, reconciliation_date)
        DO UPDATE SET
          d1_event_count = EXCLUDED.d1_event_count,
          rds_event_count = EXCLUDED.rds_event_count,
          discrepancy_count = EXCLUDED.discrepancy_count,
          status = EXCLUDED.status,
          updated_at = NOW()`,
        [
          d1Count.organisation_id,
          d1Count.project_id,
          d1Count.metric_name,
          date,
          d1CountNum,
          rdsCount,
          discrepancy,
          status,
        ]
      );

      results.push({
        organisationId: d1Count.organisation_id,
        projectId: d1Count.project_id,
        metricName: d1Count.metric_name,
        reconciliationDate: date,
        d1EventCount: d1CountNum,
        rdsEventCount: rdsCount,
        discrepancyCount: discrepancy,
        status,
      });
    } catch (error) {
      // Log error but continue with other reconciliations
      console.error(
        `Error reconciling ${d1Count.organisation_id}/${d1Count.project_id}/${d1Count.metric_name}:`,
        error
      );

      results.push({
        organisationId: d1Count.organisation_id,
        projectId: d1Count.project_id,
        metricName: d1Count.metric_name,
        reconciliationDate: date,
        d1EventCount: d1Count.event_count,
        rdsEventCount: 0,
        discrepancyCount: d1Count.event_count,
        status: 'error',
      });
    }
  }

  return results;
}

/**
 * Reconcile Razorpay orders with our payment records
 * 
 * Compares Razorpay orders with our payment records to detect missing payments.
 * Should be run daily to catch webhook failures early.
 * 
 * Note: This requires Razorpay API access to fetch orders.
 */
export async function reconcileRazorpayPayments(
  pool: pg.Pool,
  env: Env,
  organisationId?: string,
  reconciliationDate?: Date
): Promise<PaymentReconciliationResult[]> {
  const date = reconciliationDate || new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD

  // Get our payment records for the date
  const ourPaymentsResult = await queryRds<{
    organisation_id: string;
    payment_count: string;
  }>(
    pool,
    `SELECT 
      organisation_id,
      COUNT(*) as payment_count
     FROM payments
     WHERE DATE(created_at) = $1
       ${organisationId ? 'AND organisation_id = $2' : ''}
     GROUP BY organisation_id`,
    organisationId ? [dateStr, organisationId] : [dateStr]
  );

  const results: PaymentReconciliationResult[] = [];

  for (const ourPayment of ourPaymentsResult.rows) {
    try {
      // TODO: Fetch Razorpay orders for this organisation/date
      // This requires Razorpay API integration
      // For now, we'll use the unreconciled_payments view
      const unreconciledResult = await queryRds<{ count: string }>(
        pool,
        `SELECT COUNT(*) as count
         FROM unreconciled_payments
         WHERE organisation_id = $1
           AND DATE(created_at) = $2`,
        [ourPayment.organisation_id, dateStr]
      );

      const unreconciledCount = parseInt(unreconciledResult.rows[0].count, 10);
      const ourPaymentCount = parseInt(ourPayment.payment_count, 10);

      // For now, we'll mark as discrepancy if there are unreconciled payments
      // In production, you'd fetch actual Razorpay order count
      const status: 'reconciled' | 'discrepancy' | 'error' =
        unreconciledCount === 0 ? 'reconciled' : 'discrepancy';

      // Store reconciliation result
      await queryRds(
        pool,
        `INSERT INTO payment_reconciliation (
          organisation_id, reconciliation_date,
          razorpay_order_count, our_payment_count, unreconciled_count, status
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (organisation_id, reconciliation_date)
        DO UPDATE SET
          razorpay_order_count = EXCLUDED.razorpay_order_count,
          our_payment_count = EXCLUDED.our_payment_count,
          unreconciled_count = EXCLUDED.unreconciled_count,
          status = EXCLUDED.status,
          updated_at = NOW()`,
        [
          ourPayment.organisation_id,
          date,
          0, // TODO: Fetch from Razorpay API
          ourPaymentCount,
          unreconciledCount,
          status,
        ]
      );

      results.push({
        organisationId: ourPayment.organisation_id,
        reconciliationDate: date,
        razorpayOrderCount: 0, // TODO: Fetch from Razorpay API
        ourPaymentCount,
        unreconciledCount,
        status,
      });
    } catch (error) {
      console.error(
        `Error reconciling payments for ${ourPayment.organisation_id}:`,
        error
      );

      results.push({
        organisationId: ourPayment.organisation_id,
        reconciliationDate: date,
        razorpayOrderCount: 0,
        ourPaymentCount: parseInt(ourPayment.payment_count, 10),
        unreconciledCount: 0,
        status: 'error',
      });
    }
  }

  return results;
}

/**
 * Reconcile usage aggregates with source events
 * 
 * Compares usage aggregates with source events to detect missing aggregates.
 * Should be run daily to catch aggregation failures early.
 */
export async function reconcileUsageAggregates(
  pool: pg.Pool,
  d1Db: D1Database,
  organisationId?: string,
  month?: number,
  year?: number
): Promise<Array<{
  organisationId: string;
  projectId: string;
  metricName: string;
  month: number;
  year: number;
  eventCount: number;
  aggregateCount: number;
  discrepancy: number;
  status: 'reconciled' | 'discrepancy' | 'error';
}>> {
  const targetMonth = month || new Date().getMonth() + 1;
  const targetYear = year || new Date().getFullYear();

  // Get event counts from RDS (grouped by org/project/metric/month/year)
  const eventCountsResult = await queryRds<{
    organisation_id: string;
    project_id: string;
    metric_name: string;
    month: number;
    year: number;
    event_count: string;
  }>(
    pool,
    `SELECT 
      organisation_id,
      project_id,
      metric_name,
      month,
      year,
      COUNT(*) as event_count
     FROM usage_events
     WHERE month = $1
       AND year = $2
       ${organisationId ? 'AND organisation_id = $3' : ''}
     GROUP BY organisation_id, project_id, metric_name, month, year`,
    organisationId ? [targetMonth, targetYear, organisationId] : [targetMonth, targetYear]
  );

  const results: Array<{
    organisationId: string;
    projectId: string;
    metricName: string;
    month: number;
    year: number;
    eventCount: number;
    aggregateCount: number;
    discrepancy: number;
    status: 'reconciled' | 'discrepancy' | 'error';
  }> = [];

  for (const eventCount of eventCountsResult.rows) {
    try {
      // Get aggregate for same org/project/metric/month/year
      const aggregateResult = await queryRds<{
        event_count: number;
      }>(
        pool,
        `SELECT event_count
         FROM usage_aggregates
         WHERE organisation_id = $1
           AND project_id = $2
           AND metric_name = $3
           AND month = $4
           AND year = $5`,
        [
          eventCount.organisation_id,
          eventCount.project_id,
          eventCount.metric_name,
          eventCount.month,
          eventCount.year,
        ]
      );

      const eventCountNum = parseInt(eventCount.event_count, 10);
      const aggregateCount = aggregateResult.rows.length > 0
        ? aggregateResult.rows[0].event_count
        : 0;
      const discrepancy = Math.abs(eventCountNum - aggregateCount);
      const status: 'reconciled' | 'discrepancy' | 'error' =
        discrepancy === 0 ? 'reconciled' : 'discrepancy';

      // Log discrepancies
      if (status === 'discrepancy') {
        console.warn('Usage aggregate discrepancy detected', {
          organisationId: eventCount.organisation_id,
          projectId: eventCount.project_id,
          metricName: eventCount.metric_name,
          month: eventCount.month,
          year: eventCount.year,
          eventCount: eventCountNum,
          aggregateCount,
          discrepancy,
        });
      }

      results.push({
        organisationId: eventCount.organisation_id,
        projectId: eventCount.project_id,
        metricName: eventCount.metric_name,
        month: eventCount.month,
        year: eventCount.year,
        eventCount: eventCountNum,
        aggregateCount,
        discrepancy,
        status,
      });
    } catch (error) {
      console.error(
        `Error reconciling aggregates for ${eventCount.organisation_id}/${eventCount.project_id}/${eventCount.metric_name}:`,
        error
      );

      results.push({
        organisationId: eventCount.organisation_id,
        projectId: eventCount.project_id,
        metricName: eventCount.metric_name,
        month: eventCount.month,
        year: eventCount.year,
        eventCount: parseInt(eventCount.event_count, 10),
        aggregateCount: 0,
        discrepancy: parseInt(eventCount.event_count, 10),
        status: 'error',
      });
    }
  }

  return results;
}

/**
 * Get reconciliation discrepancies that need attention
 */
export async function getReconciliationDiscrepancies(
  pool: pg.Pool,
  days: number = 7
): Promise<{
  d1RdsDiscrepancies: D1RdsReconciliationResult[];
  paymentDiscrepancies: PaymentReconciliationResult[];
}> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Get D1/RDS discrepancies
  const d1RdsResult = await queryRds<D1RdsReconciliationResult>(
    pool,
    `SELECT 
      organisation_id as "organisationId",
      project_id as "projectId",
      metric_name as "metricName",
      reconciliation_date as "reconciliationDate",
      d1_event_count as "d1EventCount",
      rds_event_count as "rdsEventCount",
      discrepancy_count as "discrepancyCount",
      status
     FROM d1_rds_reconciliation
     WHERE status IN ('discrepancy', 'error')
       AND reconciliation_date >= $1
     ORDER BY reconciliation_date DESC, discrepancy_count DESC`,
    [cutoffDate]
  );

  // Get payment discrepancies
  const paymentResult = await queryRds<PaymentReconciliationResult>(
    pool,
    `SELECT 
      organisation_id as "organisationId",
      reconciliation_date as "reconciliationDate",
      razorpay_order_count as "razorpayOrderCount",
      our_payment_count as "ourPaymentCount",
      unreconciled_count as "unreconciledCount",
      status
     FROM payment_reconciliation
     WHERE status IN ('discrepancy', 'error')
       AND reconciliation_date >= $1
     ORDER BY reconciliation_date DESC, unreconciled_count DESC`,
    [cutoffDate]
  );

  return {
    d1RdsDiscrepancies: d1RdsResult.rows,
    paymentDiscrepancies: paymentResult.rows,
  };
}
