import pg from 'pg';
import { queryRds, transaction } from './rds.js';
import { IdempotencyError } from '../utils/errors.js';

/**
 * Idempotency utilities for ensuring operations are safe to retry
 */

/**
 * Check if an idempotency key already exists
 * Returns the existing entity ID if found, null otherwise
 */
export async function checkIdempotency(
  pool: pg.Pool,
  idempotencyKey: string
): Promise<string | null> {
  const result = await queryRds<{ entity_id: string }>(
    pool,
    `SELECT entity_id FROM idempotency_keys WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  if (result.rows.length > 0) {
    return result.rows[0].entity_id;
  }

  return null;
}

/**
 * Store an idempotency key with its associated entity
 * Throws IdempotencyError if key already exists with different entity
 */
export async function storeIdempotencyKey(
  pool: pg.Pool,
  idempotencyKey: string,
  entityType: string,
  entityId: string
): Promise<void> {
  try {
    await queryRds(
      pool,
      `INSERT INTO idempotency_keys (idempotency_key, entity_type, entity_id)
       VALUES ($1, $2, $3)`,
      [idempotencyKey, entityType, entityId]
    );
  } catch (error) {
    // Check if it's a unique constraint violation
    if (error instanceof Error && error.message.includes('unique constraint')) {
      // Verify it's the same entity
      const existing = await checkIdempotency(pool, idempotencyKey);
      if (existing && existing !== entityId) {
        throw new IdempotencyError(
          `Idempotency key already exists with different entity`,
          existing
        );
      }
      // Same entity, this is fine (idempotent retry)
      return;
    }
    throw error;
  }
}

/**
 * Execute an operation with idempotency check
 * If the idempotency key exists, returns the existing entity ID
 * Otherwise, executes the operation and stores the idempotency key
 */
export async function withIdempotency<T>(
  pool: pg.Pool,
  idempotencyKey: string,
  entityType: string,
  operation: () => Promise<{ id: string; result: T }>
): Promise<T> {
  // Check if key already exists
  const existingId = await checkIdempotency(pool, idempotencyKey);
  if (existingId) {
    // Return existing result (idempotent retry)
    // Note: In a real implementation, you might want to fetch and return the actual entity
    // For now, we'll throw to indicate it's a duplicate
    throw new IdempotencyError(
      `Operation already completed with idempotency key`,
      existingId
    );
  }

  // Execute operation in transaction
  return await transaction(pool, async (client) => {
    // Double-check idempotency key (race condition protection)
    const checkResult = await client.query<{ entity_id: string }>(
      `SELECT entity_id FROM idempotency_keys WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (checkResult.rows.length > 0) {
      const existingId = checkResult.rows[0].entity_id;
      throw new IdempotencyError(
        `Operation already completed with idempotency key`,
        existingId
      );
    }

    // Execute the operation
    const { id, result } = await operation();

    // Store idempotency key
    await client.query(
      `INSERT INTO idempotency_keys (idempotency_key, entity_type, entity_id)
       VALUES ($1, $2, $3)`,
      [idempotencyKey, entityType, id]
    );

    return result;
  });
}
