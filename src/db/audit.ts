import pg from 'pg';
import { queryRds } from './rds.js';
import { AuditLog } from '../types/domain.js';

/**
 * Audit logging utilities for financial auditability
 */

export interface AuditLogInput {
  organisationId?: string;
  entityType: string;
  entityId: string;
  action: string;
  userId?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(
  pool: pg.Pool,
  input: AuditLogInput
): Promise<void> {
  await queryRds(
    pool,
    `INSERT INTO audit_logs (
      organisation_id, entity_type, entity_id, action, user_id,
      changes, ip_address, user_agent
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.organisationId || null,
      input.entityType,
      input.entityId,
      input.action,
      input.userId || null,
      input.changes ? JSON.stringify(input.changes) : null,
      input.ipAddress || null,
      input.userAgent || null,
    ]
  );
}

/**
 * Get audit logs for an entity
 */
export async function getAuditLogs(
  pool: pg.Pool,
  entityType: string,
  entityId: string,
  limit: number = 100
): Promise<AuditLog[]> {
  const result = await queryRds<AuditLog>(
    pool,
    `SELECT 
      id, organisation_id, entity_type, entity_id, action, user_id,
      changes, ip_address, user_agent, created_at
    FROM audit_logs
    WHERE entity_type = $1 AND entity_id = $2
    ORDER BY created_at DESC
    LIMIT $3`,
    [entityType, entityId, limit]
  );

  return result.rows.map((row) => ({
    ...row,
    changes: row.changes ? (typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes) : undefined,
    createdAt: row.created_at,
  }));
}

/**
 * Get audit logs for an organisation
 */
export async function getOrganisationAuditLogs(
  pool: pg.Pool,
  organisationId: string,
  limit: number = 100
): Promise<AuditLog[]> {
  const result = await queryRds<AuditLog>(
    pool,
    `SELECT 
      id, organisation_id, entity_type, entity_id, action, user_id,
      changes, ip_address, user_agent, created_at
    FROM audit_logs
    WHERE organisation_id = $1
    ORDER BY created_at DESC
    LIMIT $2`,
    [organisationId, limit]
  );

  return result.rows.map((row) => ({
    ...row,
    changes: row.changes ? (typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes) : undefined,
    createdAt: row.created_at,
  }));
}
