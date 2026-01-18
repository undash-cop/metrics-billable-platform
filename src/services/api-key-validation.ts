import { Env } from '../types/env.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { sha256Hash } from '../utils/crypto.js';

/**
 * API Key Validation Service
 * 
 * Validates API keys and returns project/organisation IDs.
 * 
 * Design Decision: Since Cloudflare Workers don't support direct PostgreSQL connections,
 * we use one of these approaches:
 * 1. Cache API key -> project mapping in D1 (recommended for high throughput)
 * 2. Use HTTP-based database access (via connection pooler or API gateway)
 * 3. Use Cloudflare Durable Objects for caching
 * 
 * This implementation supports both approaches.
 */

export interface ProjectInfo {
  projectId: string;
  organisationId: string;
  isActive: boolean;
}

/**
 * Validate API key using D1 cache (fast path)
 * 
 * D1 should be populated with API key -> project mappings.
 * This provides fast lookups without RDS round-trip.
 */
async function validateApiKeyFromD1(
  db: D1Database,
  apiKey: string
): Promise<ProjectInfo | null> {
  try {
    // Hash the API key before lookup (security: never store plaintext keys)
    const apiKeyHash = await sha256Hash(apiKey);
    
    const result = await db
      .prepare(
        `SELECT project_id, organisation_id, is_active
         FROM projects_cache
         WHERE api_key_hash = ?
         LIMIT 1`
      )
      .bind(apiKeyHash)
      .first<{ project_id: string; organisation_id: string; is_active: number }>();

    if (!result) {
      return null;
    }

    return {
      projectId: result.project_id,
      organisationId: result.organisation_id,
      isActive: result.is_active === 1,
    };
  } catch (error) {
    // If table doesn't exist or query fails, return null to fall back to RDS
    console.warn('D1 API key lookup failed, falling back to RDS:', error);
    return null;
  }
}

/**
 * Validate API key using RDS via HTTP API
 * 
 * This requires an HTTP-based database access layer.
 * In production, you might use:
 * - PostgREST
 * - Hasura
 * - Custom API gateway
 * - Cloudflare Durable Objects with RDS connection
 */
async function validateApiKeyFromRDS(
  env: Env,
  apiKey: string
): Promise<ProjectInfo> {
  if (!env.RDS_API_URL) {
    throw new Error('RDS_API_URL not configured. Cannot validate API key.');
  }

  const response = await fetch(`${env.RDS_API_URL}/api/projects/validate-key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RDS_API_TOKEN || ''}`,
    },
    body: JSON.stringify({ api_key: apiKey }),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new NotFoundError('Invalid API key');
    }
    if (response.status === 401) {
      throw new ValidationError('API key validation service authentication failed');
    }
    throw new Error(`Failed to validate API key: ${response.statusText}`);
  }

  const data = await response.json();
  
  if (!data.project_id || !data.organisation_id) {
    throw new Error('Invalid response from API key validation service');
  }

  return {
    projectId: data.project_id,
    organisationId: data.organisation_id,
    isActive: data.is_active !== false,
  };
}

/**
 * Validate API key and return project/organisation IDs
 * 
 * Tries D1 cache first (fast), falls back to RDS if needed.
 */
export async function validateApiKey(
  env: Env,
  apiKey: string
): Promise<ProjectInfo> {
  // Try D1 cache first (fast path)
  const cached = await validateApiKeyFromD1(env.EVENTS_DB, apiKey);
  
  if (cached) {
    if (!cached.isActive) {
      throw new ValidationError('Project is not active');
    }
    return cached;
  }

  // Fall back to RDS (slower but authoritative)
  const projectInfo = await validateApiKeyFromRDS(env, apiKey);
  
  if (!projectInfo.isActive) {
    throw new ValidationError('Project is not active');
  }

  // Optionally: Cache the result in D1 for future requests
  // This is a performance optimization
  // IMPORTANT: Hash the API key before storing (never store plaintext)
  try {
    const apiKeyHash = await sha256Hash(apiKey);
    await env.EVENTS_DB
      .prepare(
        `INSERT OR REPLACE INTO projects_cache (api_key_hash, project_id, organisation_id, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(apiKeyHash, projectInfo.projectId, projectInfo.organisationId, 1, Math.floor(Date.now() / 1000))
      .run();
  } catch (error) {
    // Cache write failure is non-fatal - log and continue
    console.warn('Failed to cache API key validation result:', error);
  }

  return projectInfo;
}
