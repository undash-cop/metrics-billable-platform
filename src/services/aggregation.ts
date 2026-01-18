import pg from 'pg';
import { getUsageEventsForAggregation, deleteUsageEvents } from '../repositories/usage-event.js';
import { queryRds, transaction } from '../db/rds.js';
import { UsageAggregate } from '../types/domain.js';
import { DatabaseError } from '../utils/errors.js';

/**
 * Usage aggregation service
 * Aggregates usage events from D1 into monthly aggregates in RDS
 */

export interface AggregationPeriod {
  organisationId: string;
  projectId: string;
  metricName: string;
  month: number;
  year: number;
}

/**
 * Aggregate usage events for a specific period
 */
export async function aggregateUsage(
  db: D1Database,
  rdsPool: pg.Pool,
  period: AggregationPeriod
): Promise<UsageAggregate> {
  // Calculate timestamp range for the month
  const startDate = new Date(period.year, period.month - 1, 1);
  const endDate = new Date(period.year, period.month, 1);
  const startTimestamp = Math.floor(startDate.getTime() / 1000);
  const endTimestamp = Math.floor(endDate.getTime() / 1000);

  // Fetch events from D1
  const events = await getUsageEventsForAggregation(
    db,
    period.organisationId,
    period.projectId,
    period.metricName,
    startTimestamp,
    endTimestamp
  );

  if (events.length === 0) {
    throw new Error('No events found for aggregation period');
  }

  // Calculate total value
  const totalValue = events.reduce((sum, event) => sum + event.metricValue, 0);
  const unit = events[0].unit; // All events should have the same unit

  // Store aggregate in RDS (upsert)
  return await transaction(rdsPool, async (client) => {
    // Check if aggregate already exists
    const existing = await client.query<UsageAggregate>(
      `SELECT id FROM usage_aggregates
       WHERE organisation_id = $1
         AND project_id = $2
         AND metric_name = $3
         AND month = $4
         AND year = $5`,
      [
        period.organisationId,
        period.projectId,
        period.metricName,
        period.month,
        period.year,
      ]
    );

    let aggregate: UsageAggregate;

    if (existing.rows.length > 0) {
      // Update existing aggregate
      const result = await client.query<UsageAggregate>(
        `UPDATE usage_aggregates
         SET total_value = $1, updated_at = NOW()
         WHERE organisation_id = $2
           AND project_id = $3
           AND metric_name = $4
           AND month = $5
           AND year = $6
         RETURNING id, organisation_id, project_id, metric_name, unit,
                   total_value, month, year, created_at, updated_at`,
        [
          totalValue,
          period.organisationId,
          period.projectId,
          period.metricName,
          period.month,
          period.year,
        ]
      );

      aggregate = {
        id: result.rows[0].id,
        organisationId: result.rows[0].organisation_id,
        projectId: result.rows[0].project_id,
        metricName: result.rows[0].metric_name,
        unit: result.rows[0].unit,
        totalValue: Number(result.rows[0].total_value),
        month: result.rows[0].month,
        year: result.rows[0].year,
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at,
      };
    } else {
      // Create new aggregate
      const result = await client.query<UsageAggregate>(
        `INSERT INTO usage_aggregates (
          organisation_id, project_id, metric_name, unit,
          total_value, month, year
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, organisation_id, project_id, metric_name, unit,
                  total_value, month, year, created_at, updated_at`,
        [
          period.organisationId,
          period.projectId,
          period.metricName,
          unit,
          totalValue,
          period.month,
          period.year,
        ]
      );

      aggregate = {
        id: result.rows[0].id,
        organisationId: result.rows[0].organisation_id,
        projectId: result.rows[0].project_id,
        metricName: result.rows[0].metric_name,
        unit: result.rows[0].unit,
        totalValue: Number(result.rows[0].total_value),
        month: result.rows[0].month,
        year: result.rows[0].year,
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at,
      };
    }

    // Delete processed events from D1
    const eventIds = events.map((e) => e.id);
    await deleteUsageEvents(db, eventIds);

    return aggregate;
  });
}
