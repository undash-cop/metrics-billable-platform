/**
 * Admin Authentication Service
 * 
 * Handles authentication for admin endpoints using API keys stored in environment.
 * Supports multiple admin users with different roles and permissions.
 */

import { Env } from '../types/env.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { sha256Hash } from '../utils/crypto.js';
import { createRdsPool } from '../db/rds.js';
import { queryRds } from '../db/rds.js';
import pg from 'pg';

export interface AdminUser {
  id: string;
  email: string;
  role: 'admin' | 'viewer' | 'operator';
  organisationId?: string; // If null, can access all organisations
  permissions: string[];
  isActive: boolean;
}

export interface AdminAuthContext {
  userId: string;
  email: string;
  role: 'admin' | 'viewer' | 'operator';
  organisationId?: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Admin API keys table structure (should be created via migration)
 * 
 * CREATE TABLE admin_api_keys (
 *   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   user_id UUID NOT NULL,
 *   key_hash VARCHAR(255) NOT NULL UNIQUE,
 *   name VARCHAR(255),
 *   last_used_at TIMESTAMP WITH TIME ZONE,
 *   expires_at TIMESTAMP WITH TIME ZONE,
 *   is_active BOOLEAN NOT NULL DEFAULT true,
 *   created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
 * );
 * 
 * CREATE TABLE admin_users (
 *   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   email VARCHAR(255) NOT NULL UNIQUE,
 *   role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'viewer', 'operator')),
 *   organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
 *   permissions JSONB NOT NULL DEFAULT '[]',
 *   is_active BOOLEAN NOT NULL DEFAULT true,
 *   created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
 *   updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
 * );
 */

/**
 * Validate admin API key from environment or database
 * 
 * First checks environment variables (ADMIN_API_KEY_*), then falls back to database.
 */
export async function validateAdminApiKey(
  env: Env,
  apiKey: string
): Promise<AdminUser> {
  // Check environment variables first (for simple deployments)
  if (env.ADMIN_API_KEY) {
    const keyHash = await sha256Hash(apiKey);
    const envKeyHash = await sha256Hash(env.ADMIN_API_KEY);
    
    if (keyHash === envKeyHash) {
      // Return default admin user
      return {
        id: 'env-admin',
        email: 'admin@system',
        role: 'admin',
        permissions: ['read', 'write', 'admin'],
        isActive: true,
      };
    }
  }

  // Fall back to database lookup
  const pool = createRdsPool(env);
  const keyHash = await sha256Hash(apiKey);

  // Look up API key
  const keyResult = await queryRds<{
    id: string;
    user_id: string;
    is_active: boolean;
    expires_at: Date | null;
  }>(
    pool,
    `SELECT id, user_id, is_active, expires_at
     FROM admin_api_keys
     WHERE key_hash = $1`,
    [keyHash]
  );

  if (keyResult.rows.length === 0) {
    throw new ValidationError('Invalid admin API key');
  }

  const apiKeyRecord = keyResult.rows[0];

  // Check if key is active
  if (!apiKeyRecord.is_active) {
    throw new ValidationError('Admin API key is inactive');
  }

  // Check if key is expired
  if (apiKeyRecord.expires_at && apiKeyRecord.expires_at < new Date()) {
    throw new ValidationError('Admin API key has expired');
  }

  // Update last used timestamp
  await queryRds(
    pool,
    `UPDATE admin_api_keys
     SET last_used_at = NOW()
     WHERE id = $1`,
    [apiKeyRecord.id]
  );

  // Get user details
  const userResult = await queryRds<{
    id: string;
    email: string;
    role: 'admin' | 'viewer' | 'operator';
    organisation_id: string | null;
    permissions: string[];
    is_active: boolean;
  }>(
    pool,
    `SELECT id, email, role, organisation_id, permissions, is_active
     FROM admin_users
     WHERE id = $1`,
    [apiKeyRecord.user_id]
  );

  if (userResult.rows.length === 0) {
    throw new NotFoundError('Admin user not found');
  }

  const user = userResult.rows[0];

  if (!user.is_active) {
    throw new ValidationError('Admin user is inactive');
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organisationId: user.organisation_id || undefined,
    permissions: user.permissions,
    isActive: user.is_active,
  };
}

/**
 * Authenticate admin request
 */
export async function authenticateAdmin(
  request: Request,
  env: Env
): Promise<AdminAuthContext> {
  // Get API key from Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ValidationError('Missing or invalid Authorization header');
  }

  const apiKey = authHeader.substring(7).trim();
  if (!apiKey) {
    throw new ValidationError('API key cannot be empty');
  }

  // Validate API key
  const user = await validateAdminApiKey(env, apiKey);

  // Extract IP address and user agent
  const ipAddress = request.headers.get('CF-Connecting-IP') || 
                    request.headers.get('X-Forwarded-For')?.split(',')[0] ||
                    'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    organisationId: user.organisationId,
    permissions: user.permissions,
    ipAddress,
    userAgent,
  };
}

/**
 * Check if user has required permission
 */
export function checkPermission(
  authContext: AdminAuthContext,
  requiredPermission: string
): void {
  if (!authContext.permissions.includes(requiredPermission)) {
    throw new ValidationError(
      `Permission denied: ${requiredPermission} required`
    );
  }
}

/**
 * Check if user has required role
 */
export function checkRole(
  authContext: AdminAuthContext,
  requiredRole: 'admin' | 'viewer' | 'operator'
): void {
  const roleHierarchy: Record<string, number> = {
    viewer: 1,
    operator: 2,
    admin: 3,
  };

  const userRoleLevel = roleHierarchy[authContext.role] || 0;
  const requiredRoleLevel = roleHierarchy[requiredRole] || 0;

  if (userRoleLevel < requiredRoleLevel) {
    throw new ValidationError(
      `Role denied: ${requiredRole} role required, current role: ${authContext.role}`
    );
  }
}

/**
 * Check if user can access organisation
 */
export function checkOrganisationAccess(
  authContext: AdminAuthContext,
  organisationId: string
): void {
  // Admins without organisationId can access all organisations
  if (!authContext.organisationId) {
    return;
  }

  // Users with organisationId can only access their own organisation
  if (authContext.organisationId !== organisationId) {
    throw new ValidationError(
      'Access denied: Cannot access this organisation'
    );
  }
}
