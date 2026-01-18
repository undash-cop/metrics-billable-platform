/**
 * Admin Audit Logging Middleware
 * 
 * Logs all admin actions for security and compliance.
 */

import { Env } from '../types/env.js';
import { AdminAuthContext } from '../services/admin-auth.js';
import { createAuditLog } from '../db/audit.js';
import { createRdsPool } from '../db/rds.js';

export interface AdminAction {
  action: string; // e.g., 'create_organisation', 'generate_api_key'
  entityType: string; // e.g., 'organisation', 'project'
  entityId?: string;
  organisationId?: string;
  changes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Log admin action
 */
export async function logAdminAction(
  env: Env,
  authContext: AdminAuthContext,
  action: AdminAction
): Promise<void> {
  const pool = createRdsPool(env);

  try {
    await createAuditLog(pool, {
      organisationId: action.organisationId || authContext.organisationId,
      entityType: action.entityType,
      entityId: action.entityId || 'admin_action',
      action: action.action,
      userId: authContext.userId,
      changes: {
        ...action.changes,
        adminEmail: authContext.email,
        adminRole: authContext.role,
        ipAddress: authContext.ipAddress,
        userAgent: authContext.userAgent,
      },
      ipAddress: authContext.ipAddress,
      userAgent: authContext.userAgent,
      metadata: {
        ...action.metadata,
        adminAction: true,
      },
    });
  } catch (error) {
    // Log error but don't fail the request
    console.error('Failed to log admin action:', error);
  }
}

/**
 * Create admin action logger middleware
 */
export function createAdminActionLogger(
  env: Env,
  authContext: AdminAuthContext
) {
  return async (action: AdminAction): Promise<void> => {
    await logAdminAction(env, authContext, action);
  };
}
