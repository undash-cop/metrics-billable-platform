import { UsageEvent } from '../types/domain.js';

/**
 * Usage event repository for D1 (hot storage)
 */

export interface UsageEventRow {
  id: string;
  project_id: string;
  organisation_id: string;
  metric_name: string;
  metric_value: number;
  unit: string;
  timestamp: number;
  metadata: string | null;
  idempotency_key: string;
  ingested_at: number;
}

/**
 * Store a usage event in D1
 */
export async function storeUsageEvent(
  db: D1Database,
  event: UsageEvent
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO usage_events (
        id, project_id, organisation_id, metric_name, metric_value,
        unit, timestamp, metadata, idempotency_key, ingested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      event.id,
      event.projectId,
      event.organisationId,
      event.metricName,
      event.metricValue,
      event.unit,
      Math.floor(event.timestamp.getTime() / 1000),
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.idempotencyKey,
      Math.floor(event.ingestedAt.getTime() / 1000)
    )
    .run();
}

/**
 * Check if an idempotency key already exists
 */
export async function checkUsageEventIdempotency(
  db: D1Database,
  idempotencyKey: string
): Promise<boolean> {
  const result = await db
    .prepare(`SELECT id FROM usage_events WHERE idempotency_key = ?`)
    .bind(idempotencyKey)
    .first<{ id: string }>();

  return result !== null;
}

/**
 * Get usage events for aggregation
 */
export async function getUsageEventsForAggregation(
  db: D1Database,
  organisationId: string,
  projectId: string,
  metricName: string,
  startTimestamp: number,
  endTimestamp: number,
  limit: number = 10000
): Promise<UsageEvent[]> {
  const result = await db
    .prepare(
      `SELECT 
        id, project_id, organisation_id, metric_name, metric_value,
        unit, timestamp, metadata, idempotency_key, ingested_at
      FROM usage_events
      WHERE organisation_id = ? 
        AND project_id = ?
        AND metric_name = ?
        AND timestamp >= ?
        AND timestamp < ?
      ORDER BY timestamp ASC
      LIMIT ?`
    )
    .bind(organisationId, projectId, metricName, startTimestamp, endTimestamp, limit)
    .all<UsageEventRow>();

  return result.results.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    organisationId: row.organisation_id,
    metricName: row.metric_name,
    metricValue: row.metric_value,
    unit: row.unit,
    timestamp: new Date(row.timestamp * 1000),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    idempotencyKey: row.idempotency_key,
    ingestedAt: new Date(row.ingested_at * 1000),
  }));
}

/**
 * Delete processed usage events (after aggregation)
 */
export async function deleteUsageEvents(
  db: D1Database,
  eventIds: string[]
): Promise<void> {
  if (eventIds.length === 0) {
    return;
  }

  // D1 has a limit on IN clause size, so batch delete
  const batchSize = 100;
  for (let i = 0; i < eventIds.length; i += batchSize) {
    const batch = eventIds.slice(i, i + batchSize);
    const placeholders = batch.map(() => '?').join(',');
    await db
      .prepare(`DELETE FROM usage_events WHERE id IN (${placeholders})`)
      .bind(...batch)
      .run();
  }
}
