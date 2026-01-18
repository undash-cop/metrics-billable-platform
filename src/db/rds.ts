import pg from 'pg';
import { Env } from '../types/env.js';
import { DatabaseError } from '../utils/errors.js';

const { Pool } = pg;

/**
 * RDS Postgres connection pool
 * This is the financial source of truth
 */
export function createRdsPool(env: Env): pg.Pool {
  const pool = new Pool({
    host: env.RDS_HOST,
    port: parseInt(env.RDS_PORT, 10),
    database: env.RDS_DATABASE,
    user: env.RDS_USER,
    password: env.RDS_PASSWORD,
    ssl: env.RDS_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle RDS client', err);
  });

  return pool;
}

/**
 * Execute a query with error handling
 */
export async function queryRds<T = unknown>(
  pool: pg.Pool,
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  try {
    return await pool.query<T>(text, params);
  } catch (error) {
    if (error instanceof Error) {
      throw new DatabaseError(`RDS query failed: ${error.message}`, {
        query: text,
        params,
        originalError: error.message,
      });
    }
    throw new DatabaseError('Unknown RDS query error', { query: text, params });
  }
}

/**
 * Execute a transaction
 */
export async function transaction<T>(
  pool: pg.Pool,
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
