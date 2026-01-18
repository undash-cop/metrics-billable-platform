import { Env } from '../types/env.js';
import { ValidationError, ConflictError, formatError } from '../utils/errors.js';
import { validateApiKey } from '../services/api-key-validation.js';
import { randomUUID } from '../utils/crypto.js';
import { z } from 'zod';

/**
 * Cloudflare Worker for Usage Event Ingestion
 * 
 * Endpoint: POST /events
 * 
 * Design Decisions:
 * 1. Idempotency: Check D1 first before any processing to handle retries safely
 * 2. API Key Validation: Query RDS to get project and organisation IDs
 * 3. Async Processing: Write to D1 and Queue, return 202 immediately
 * 4. Error Handling: Explicit error types for different failure modes
 * 5. Retry Safety: Idempotency check happens first, so retries are safe
 */

// Request validation schema
const EventRequestSchema = z.object({
  event_id: z.string().min(1).max(255), // Client-provided idempotency key
  metric_name: z.string().min(1).max(100),
  metric_value: z.number().nonnegative(), // Must be >= 0
  unit: z.string().min(1).max(50),
  timestamp: z.string().datetime().optional(), // ISO 8601 datetime string
  metadata: z.record(z.unknown()).optional(), // Flexible key-value pairs
});

type EventRequest = z.infer<typeof EventRequestSchema>;

// Response types
interface EventResponse {
  event_id: string;
  status: 'accepted' | 'duplicate';
  message: string;
}

/**
 * Validate and extract API key from Authorization header
 * 
 * Expected format: "Bearer <api_key>"
 */
function extractApiKey(request: Request): string {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader) {
    throw new ValidationError('Missing Authorization header');
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new ValidationError('Authorization header must use Bearer scheme');
  }

  const apiKey = authHeader.substring(7).trim();
  
  if (apiKey.length === 0) {
    throw new ValidationError('API key cannot be empty');
  }

  return apiKey;
}


/**
 * Check if event_id already exists in D1 (idempotency check)
 * 
 * This check happens FIRST to ensure retries are safe.
 * If event exists, we return immediately without processing.
 */
async function checkEventIdempotency(
  db: D1Database,
  eventId: string
): Promise<boolean> {
  try {
    const result = await db
      .prepare('SELECT id FROM usage_events WHERE idempotency_key = ? LIMIT 1')
      .bind(eventId)
      .first<{ id: string }>();

    return result !== null;
  } catch (error) {
    // If query fails, log but don't fail the request
    // We'll let the INSERT fail with unique constraint violation instead
    console.error('Error checking idempotency:', error);
    return false;
  }
}

/**
 * Store usage event in D1
 * 
 * Uses idempotency_key (event_id) as unique constraint.
 * If duplicate, D1 will throw error which we handle gracefully.
 */
async function storeEventInD1(
  db: D1Database,
  event: {
    id: string;
    projectId: string;
    organisationId: string;
    metricName: string;
    metricValue: number;
    unit: string;
    timestamp: Date;
    metadata?: Record<string, unknown>;
    eventId: string; // idempotency key
  }
): Promise<void> {
  const timestamp = Math.floor(event.timestamp.getTime() / 1000);
  const ingestedAt = Math.floor(Date.now() / 1000);
  const metadataJson = event.metadata ? JSON.stringify(event.metadata) : null;

  try {
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
        timestamp,
        metadataJson,
        event.eventId, // idempotency_key
        ingestedAt
      )
      .run();
  } catch (error: unknown) {
    // Handle unique constraint violation (duplicate idempotency_key)
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      throw new ConflictError(`Event with idempotency key already exists: ${event.eventId}`);
    }
    throw error;
  }
}

/**
 * Publish event to Cloudflare Queue for async processing
 * 
 * Queue consumer will handle aggregation and downstream processing.
 * This is fire-and-forget - we don't wait for queue processing.
 */
async function publishToQueue(
  queue: Queue,
  event: {
    eventId: string;
    projectId: string;
    organisationId: string;
    metricName: string;
  }
): Promise<void> {
  try {
    await queue.send({
      type: 'usage_event',
      event_id: event.eventId,
      project_id: event.projectId,
      organisation_id: event.organisationId,
      metric_name: event.metricName,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Log but don't fail - event is already in D1
    // Queue retries will handle this
    console.error('Failed to publish to queue:', error);
    // In production, you might want to retry or use a dead-letter queue
  }
}

/**
 * Main handler for POST /events endpoint
 * 
 * Flow:
 * 1. Validate request method and headers
 * 2. Parse and validate request body
 * 3. Extract and validate API key
 * 4. Check idempotency (early return if duplicate)
 * 5. Validate API key and get project/org IDs
 * 6. Store event in D1
 * 7. Publish to queue
 * 8. Return 202 Accepted
 */
export async function handleEvents(request: Request, env: Env): Promise<Response> {
  // Only allow POST method
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed. Use POST.' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      throw new ValidationError('Invalid JSON in request body');
    }

    // Validate request schema
    const validationResult = EventRequestSchema.safeParse(body);
    if (!validationResult.success) {
      throw new ValidationError('Invalid request body', {
        errors: validationResult.error.errors,
      });
    }

    const eventRequest = validationResult.data;

    // Extract API key from Authorization header
    const apiKey = extractApiKey(request);

    // Check idempotency FIRST (before any processing)
    // This ensures retries are safe and idempotent
    const isDuplicate = await checkEventIdempotency(env.EVENTS_DB, eventRequest.event_id);
    
    if (isDuplicate) {
      // Event already processed - return success (idempotent retry)
      const response: EventResponse = {
        event_id: eventRequest.event_id,
        status: 'duplicate',
        message: 'Event already processed',
      };
      
      return new Response(JSON.stringify(response), {
        status: 202, // Accepted (already processed)
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate API key and get project/organisation IDs
    // Uses D1 cache first (fast), falls back to RDS if needed
    const projectInfo = await validateApiKey(env, apiKey);
    const { projectId, organisationId } = projectInfo;

    // Parse timestamp or use current time
    const timestamp = eventRequest.timestamp 
      ? new Date(eventRequest.timestamp)
      : new Date();

    // Validate timestamp is not in the future (with small tolerance for clock skew)
    const now = Date.now();
    const eventTime = timestamp.getTime();
    const maxFutureSkew = 5 * 60 * 1000; // 5 minutes tolerance
    if (eventTime > now + maxFutureSkew) {
      throw new ValidationError('Event timestamp cannot be in the future');
    }

    // Generate event ID (different from idempotency key)
    const eventId = randomUUID();

    // Store event in D1
    // This will fail if idempotency_key already exists (race condition protection)
    try {
      await storeEventInD1(env.EVENTS_DB, {
        id: eventId,
        projectId,
        organisationId,
        metricName: eventRequest.metric_name,
        metricValue: eventRequest.metric_value,
        unit: eventRequest.unit,
        timestamp,
        metadata: eventRequest.metadata,
        eventId: eventRequest.event_id, // idempotency key
      });
    } catch (error) {
      // Handle race condition: another request processed same event_id
      if (error instanceof ConflictError) {
        const response: EventResponse = {
          event_id: eventRequest.event_id,
          status: 'duplicate',
          message: 'Event already processed',
        };
        
        return new Response(JSON.stringify(response), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw error;
    }

    // Publish to queue for async processing
    // Don't await - fire and forget
    // Queue will handle retries if this fails
    publishToQueue(env.USAGE_EVENTS_QUEUE, {
      eventId: eventRequest.event_id,
      projectId,
      organisationId,
      metricName: eventRequest.metric_name,
    }).catch((error) => {
      // Log queue errors but don't fail the request
      // Event is already stored in D1, so it can be processed later
      console.error('Queue publish failed (non-fatal):', error);
    });

    // Return 202 Accepted - event accepted for processing
    const response: EventResponse = {
      event_id: eventRequest.event_id,
      status: 'accepted',
      message: 'Event accepted for processing',
    };

    return new Response(JSON.stringify(response), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    // Format and return error response
    const formattedError = formatError(error);
    
    // Log error for monitoring (in production, use structured logging)
    console.error('Event ingestion error:', {
      error: formattedError.error,
      code: formattedError.code,
      details: formattedError.details,
    });

    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
