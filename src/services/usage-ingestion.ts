import { UsageEvent, UsageEventSchema } from '../types/domain.js';
import { storeUsageEvent, checkUsageEventIdempotency } from '../repositories/usage-event.js';
import { getProjectByApiKey } from '../repositories/project.js';
import { createRdsPool } from '../db/rds.js';
import { Env } from '../types/env.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { randomUUID } from '../utils/crypto.js';

/**
 * Usage event ingestion service
 * Handles ingestion of usage events into D1
 */

export interface IngestUsageEventRequest {
  metricName: string;
  metricValue: number;
  unit: string;
  timestamp?: string; // ISO 8601 string
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Ingest a usage event
 * Returns the ingested event ID
 */
export async function ingestUsageEvent(
  env: Env,
  db: D1Database,
  apiKey: string,
  request: IngestUsageEventRequest
): Promise<{ eventId: string }> {
  // Validate request
  const validationResult = UsageEventSchema.safeParse({
    id: randomUUID(),
    projectId: '', // Will be set after project lookup
    organisationId: '', // Will be set after project lookup
    metricName: request.metricName,
    metricValue: request.metricValue,
    unit: request.unit,
    timestamp: request.timestamp ? new Date(request.timestamp) : new Date(),
    metadata: request.metadata,
    idempotencyKey: request.idempotencyKey || randomUUID(),
    ingestedAt: new Date(),
  });

  if (!validationResult.success) {
    throw new ValidationError('Invalid usage event', {
      errors: validationResult.error.errors,
    });
  }

  // Get project from API key
  const rdsPool = createRdsPool(env);
  const project = await getProjectByApiKey(rdsPool, apiKey);
  if (!project) {
    throw new NotFoundError('Project not found or inactive');
  }

  if (!project.isActive) {
    throw new ValidationError('Project is not active');
  }

  // Generate idempotency key if not provided
  const idempotencyKey = request.idempotencyKey || randomUUID();

  // Check idempotency in D1
  const exists = await checkUsageEventIdempotency(db, idempotencyKey);
  if (exists) {
    // Idempotent retry - return success without creating duplicate
    // Note: In production, you might want to return the existing event ID
    return { eventId: 'duplicate' };
  }

  // Create usage event
  const event: UsageEvent = {
    id: randomUUID(),
    projectId: project.id,
    organisationId: project.organisationId,
    metricName: request.metricName,
    metricValue: request.metricValue,
    unit: request.unit,
    timestamp: request.timestamp ? new Date(request.timestamp) : new Date(),
    metadata: request.metadata,
    idempotencyKey,
    ingestedAt: new Date(),
  };

  // Store in D1
  await storeUsageEvent(db, event);

  return { eventId: event.id };
}
