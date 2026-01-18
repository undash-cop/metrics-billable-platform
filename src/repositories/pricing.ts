import pg from 'pg';
import { queryRds } from '../db/rds.js';
import { PricingPlan } from '../types/domain.js';

/**
 * Pricing plan repository
 */

export async function createPricingPlan(
  pool: pg.Pool,
  plan: {
    metricName: string;
    unit: string;
    pricePerUnit: string;
    currency?: string;
    effectiveFrom: Date;
    effectiveTo?: Date;
  }
): Promise<PricingPlan> {
  const result = await queryRds<PricingPlan>(
    pool,
    `INSERT INTO pricing_plans (
      metric_name, unit, price_per_unit, currency, effective_from, effective_to
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, metric_name, unit, price_per_unit, currency,
              effective_from, effective_to, is_active, created_at, updated_at`,
    [
      plan.metricName,
      plan.unit,
      plan.pricePerUnit,
      plan.currency || 'INR',
      plan.effectiveFrom,
      plan.effectiveTo || null,
    ]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    metricName: row.metric_name,
    unit: row.unit,
    pricePerUnit: row.price_per_unit.toString(),
    currency: row.currency,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getActivePricingPlans(
  pool: pg.Pool,
  date: Date = new Date()
): Promise<PricingPlan[]> {
  const result = await queryRds<PricingPlan>(
    pool,
    `SELECT 
      id, metric_name, unit, price_per_unit, currency,
      effective_from, effective_to, is_active, created_at, updated_at
    FROM pricing_plans
    WHERE is_active = true
      AND effective_from <= $1
      AND (effective_to IS NULL OR effective_to >= $1)
    ORDER BY metric_name, effective_from DESC`,
    [date]
  );

  return result.rows.map((row) => ({
    id: row.id,
    metricName: row.metric_name,
    unit: row.unit,
    pricePerUnit: row.price_per_unit.toString(),
    currency: row.currency,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
