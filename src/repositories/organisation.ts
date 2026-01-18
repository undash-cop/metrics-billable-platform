import pg from 'pg';
import { queryRds, transaction } from '../db/rds.js';
import { Organisation } from '../types/domain.js';
import { NotFoundError } from '../utils/errors.js';

/**
 * Organisation repository
 */

export async function getOrganisationById(
  pool: pg.Pool,
  id: string
): Promise<Organisation & { currency?: string } | null> {
  const result = await queryRds<Organisation & { currency?: string }>(
    pool,
    `SELECT 
      id, name, razorpay_customer_id, currency, created_at, updated_at
    FROM organisations
    WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    razorpayCustomerId: row.razorpay_customer_id || undefined,
    currency: row.currency || 'INR',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getOrganisationByRazorpayCustomerId(
  pool: pg.Pool,
  razorpayCustomerId: string
): Promise<Organisation | null> {
  const result = await queryRds<Organisation>(
    pool,
    `SELECT 
      id, name, razorpay_customer_id, created_at, updated_at
    FROM organisations
    WHERE razorpay_customer_id = $1`,
    [razorpayCustomerId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    razorpayCustomerId: row.razorpay_customer_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createOrganisation(
  pool: pg.Pool,
  name: string,
  options?: {
    razorpayCustomerId?: string;
    currency?: string;
  }
): Promise<Organisation & { currency?: string }> {
  const result = await queryRds<Organisation & { currency?: string }>(
    pool,
    `INSERT INTO organisations (name, razorpay_customer_id, currency)
     VALUES ($1, $2, $3)
     RETURNING id, name, razorpay_customer_id, currency, created_at, updated_at`,
    [name, options?.razorpayCustomerId || null, options?.currency || 'INR']
  );

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    razorpayCustomerId: row.razorpay_customer_id || undefined,
    currency: row.currency || 'INR',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function updateOrganisationCurrency(
  pool: pg.Pool,
  organisationId: string,
  currency: string
): Promise<void> {
  await queryRds(
    pool,
    `UPDATE organisations
     SET currency = $1, updated_at = NOW()
     WHERE id = $2`,
    [currency, organisationId]
  );
}

export async function updateOrganisationRazorpayCustomerId(
  pool: pg.Pool,
  organisationId: string,
  razorpayCustomerId: string
): Promise<void> {
  await queryRds(
    pool,
    `UPDATE organisations
     SET razorpay_customer_id = $1
     WHERE id = $2`,
    [razorpayCustomerId, organisationId]
  );
}
