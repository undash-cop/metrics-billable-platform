import { Env } from '../types/env.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { getOrganisationById } from '../repositories/organisation.js';
import { createRdsPool } from '../db/rds.js';
import pg from 'pg';

/**
 * Authentication and Authorization Middleware
 * 
 * Handles:
 * - API key authentication
 * - Organisation-level access control
 * - Permission checks
 */

export interface AuthContext {
  organisationId: string;
  organisation: {
    id: string;
    name: string;
  };
  userId?: string;
  permissions?: string[];
}

/**
 * Extract and validate organisation ID from request
 * 
 * Supports:
 * - Query parameter: ?organisationId=uuid
 * - Path parameter: /organisations/:organisationId/...
 * - Request body: { organisationId: uuid }
 */
export async function extractOrganisationId(
  request: Request,
  url: URL
): Promise<string> {
  // Try query parameter first
  const queryOrgId = url.searchParams.get('organisationId');
  if (queryOrgId) {
    return validateUuid(queryOrgId);
  }

  // Try path parameter (e.g., /organisations/:id/projects)
  const pathMatch = url.pathname.match(/\/organisations\/([^/]+)/);
  if (pathMatch && pathMatch[1]) {
    return validateUuid(pathMatch[1]);
  }

  // Try request body (for POST/PUT requests)
  try {
    const body = await request.clone().json();
    if (body && typeof body === 'object' && 'organisationId' in body) {
      return validateUuid(body.organisationId as string);
    }
  } catch {
    // Body parsing failed, continue
  }

  throw new ValidationError('organisationId is required');
}

/**
 * Validate UUID format
 */
function validateUuid(uuid: string): string {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(uuid)) {
    throw new ValidationError('Invalid UUID format');
  }
  return uuid;
}

/**
 * Authenticate request and get organisation context
 * 
 * In production, this would:
 * - Validate API key or JWT token
 * - Check user permissions
 * - Verify organisation access
 * 
 * For now, we'll use a simple API key approach.
 */
export async function authenticateRequest(
  request: Request,
  env: Env,
  url: URL
): Promise<AuthContext> {
  // Get API key from Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ValidationError('Missing or invalid Authorization header');
  }

  const apiKey = authHeader.substring(7).trim();
  
  // In production, validate API key and get user/organisation info
  // For now, we'll extract organisationId from request
  const organisationId = await extractOrganisationId(request, url);

  // Verify organisation exists
  const rdsPool = createRdsPool(env);
  const organisation = await getOrganisationById(rdsPool, organisationId);
  
  if (!organisation) {
    throw new NotFoundError(`Organisation not found: ${organisationId}`);
  }

  return {
    organisationId: organisation.id,
    organisation: {
      id: organisation.id,
      name: organisation.name,
    },
    // In production, extract from JWT or API key
    userId: 'admin', // Placeholder
    permissions: ['read', 'write'], // Placeholder
  };
}

/**
 * Check if user has permission to access organisation
 */
export function checkOrganisationAccess(
  authContext: AuthContext,
  requestedOrganisationId: string
): void {
  if (authContext.organisationId !== requestedOrganisationId) {
    throw new ValidationError(
      'Access denied: Cannot access this organisation'
    );
  }
}

/**
 * Check if operation is read-only (for financial data)
 */
export function checkReadOnly(
  request: Request,
  allowedMethods: string[] = ['GET', 'HEAD', 'OPTIONS']
): void {
  if (!allowedMethods.includes(request.method)) {
    throw new ValidationError(
      'This endpoint is read-only. Financial data cannot be modified via API.'
    );
  }
}
