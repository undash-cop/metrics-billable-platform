import { Env } from '../types/env.js';
import { ingestUsageEvent } from '../services/usage-ingestion.js';
import { formatError } from '../utils/errors.js';

/**
 * Usage event ingestion worker
 * Handles POST /ingest endpoint for usage events
 */

export async function handleIngestion(request: Request, env: Env): Promise<Response> {
  // Only allow POST
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Get API key from Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = authHeader.substring(7);

    // Parse request body
    const body = await request.json();

    // Ingest event
    const result = await ingestUsageEvent(env, env.EVENTS_DB, apiKey, body);

    return new Response(JSON.stringify(result), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const formattedError = formatError(error);
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
