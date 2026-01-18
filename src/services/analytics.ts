import pg from 'pg';
import { queryRds } from '../db/rds.js';
import { NotFoundError } from '../utils/errors.js';

/**
 * Analytics Service
 * 
 * Provides usage analytics and dashboards for organisations and projects.
 */

export interface UsageSummary {
  organisationId: string;
  projectId?: string;
  startDate: Date;
  endDate: Date;
  totalUsage: number;
  totalEvents: number;
  totalCost: string;
  currency: string;
  metrics: Array<{
    metricName: string;
    unit: string;
    totalUsage: number;
    totalEvents: number;
    totalCost: string;
  }>;
}

export interface UsageTrend {
  date: string; // YYYY-MM-DD
  totalUsage: number;
  totalEvents: number;
  totalCost: string;
  metrics: Record<string, number>; // metric_name -> usage
}

export interface CostBreakdown {
  metricName: string;
  unit: string;
  totalUsage: number;
  totalCost: string;
  percentage: number; // Percentage of total cost
}

/**
 * Get usage summary for an organisation
 */
export async function getUsageSummary(
  pool: pg.Pool,
  organisationId: string,
  options: {
    projectId?: string;
    metricName?: string;
    startMonth?: number;
    startYear?: number;
    endMonth?: number;
    endYear?: number;
  }
): Promise<UsageSummary> {
  // Build date range
  const now = new Date();
  const startDate = options.startYear && options.startMonth
    ? new Date(options.startYear, options.startMonth - 1, 1)
    : new Date(now.getFullYear(), now.getMonth() - 1, 1); // Default: last month
  const endDate = options.endYear && options.endMonth
    ? new Date(options.endYear, options.endMonth, 0) // Last day of month
    : new Date(now.getFullYear(), now.getMonth(), 0); // Default: end of last month

  // Build query
  let query = `
    SELECT 
      ua.metric_name,
      ua.unit,
      SUM(ua.total_value) as total_usage,
      COUNT(DISTINCT ua.project_id) as project_count
    FROM usage_aggregates ua
    WHERE ua.organisation_id = $1
      AND (ua.year * 100 + ua.month) >= $2
      AND (ua.year * 100 + ua.month) <= $3
  `;
  const params: unknown[] = [
    organisationId,
    startDate.getFullYear() * 100 + startDate.getMonth() + 1,
    endDate.getFullYear() * 100 + endDate.getMonth() + 1,
  ];

  if (options.projectId) {
    query += ' AND ua.project_id = $' + (params.length + 1);
    params.push(options.projectId);
  }

  if (options.metricName) {
    query += ' AND ua.metric_name = $' + (params.length + 1);
    params.push(options.metricName);
  }

  query += `
    GROUP BY ua.metric_name, ua.unit
    ORDER BY ua.metric_name, ua.unit
  `;

  const result = await queryRds<{
    metric_name: string;
    unit: string;
    total_usage: string;
    project_count: number;
  }>(pool, query, params);

  // Get pricing to calculate costs
  const metrics: UsageSummary['metrics'] = [];
  let totalCost = 0;
  let totalEvents = 0;
  const currency = 'INR'; // Default, could be fetched from organisation

  for (const row of result.rows) {
    // Get active pricing for this metric
    const pricingResult = await queryRds<{ price_per_unit: string; currency: string }>(
      pool,
      `SELECT price_per_unit, currency
       FROM pricing_plans
       WHERE metric_name = $1
         AND unit = $2
         AND is_active = true
         AND effective_from <= $3
         AND (effective_to IS NULL OR effective_to >= $3)
       ORDER BY effective_from DESC
       LIMIT 1`,
      [row.metric_name, row.unit, startDate]
    );

    const usage = parseFloat(row.total_usage);
    totalEvents += usage; // Approximate: using total_value as event count

    let cost = 0;
    if (pricingResult.rows.length > 0) {
      const pricePerUnit = parseFloat(pricingResult.rows[0].price_per_unit);
      cost = usage * pricePerUnit;
      totalCost += cost;
    }

    metrics.push({
      metricName: row.metric_name,
      unit: row.unit,
      totalUsage: usage,
      totalEvents: usage, // Approximate
      totalCost: cost.toFixed(2),
    });
  }

  return {
    organisationId,
    projectId: options.projectId,
    startDate,
    endDate,
    totalUsage: totalEvents, // Total usage across all metrics
    totalEvents: totalEvents,
    totalCost: totalCost.toFixed(2),
    currency,
    metrics,
  };
}

/**
 * Get usage trends over time
 */
export async function getUsageTrends(
  pool: pg.Pool,
  organisationId: string,
  options: {
    projectId?: string;
    metricName?: string;
    startMonth?: number;
    startYear?: number;
    endMonth?: number;
    endYear?: number;
    groupBy: 'day' | 'week' | 'month';
  }
): Promise<UsageTrend[]> {
  const now = new Date();
  const startDate = options.startYear && options.startMonth
    ? new Date(options.startYear, options.startMonth - 1, 1)
    : new Date(now.getFullYear(), now.getMonth() - 6, 1); // Default: last 6 months
  const endDate = options.endYear && options.endMonth
    ? new Date(options.endYear, options.endMonth, 0)
    : new Date(now.getFullYear(), now.getMonth(), 0);

  // Build date grouping
  let dateGroup: string;
  switch (options.groupBy) {
    case 'day':
      dateGroup = "TO_CHAR(TO_DATE(ua.year || '-' || LPAD(ua.month::text, 2, '0') || '-01'), 'YYYY-MM-DD')";
      break;
    case 'week':
      dateGroup = "TO_CHAR(DATE_TRUNC('week', TO_DATE(ua.year || '-' || LPAD(ua.month::text, 2, '0') || '-01')), 'YYYY-MM-DD')";
      break;
    case 'month':
    default:
      dateGroup = "ua.year || '-' || LPAD(ua.month::text, 2, '0')";
      break;
  }

  let query = `
    SELECT 
      ${dateGroup} as date,
      ua.metric_name,
      SUM(ua.total_value) as total_usage
    FROM usage_aggregates ua
    WHERE ua.organisation_id = $1
      AND (ua.year * 100 + ua.month) >= $2
      AND (ua.year * 100 + ua.month) <= $3
  `;
  const params: unknown[] = [
    organisationId,
    startDate.getFullYear() * 100 + startDate.getMonth() + 1,
    endDate.getFullYear() * 100 + endDate.getMonth() + 1,
  ];

  if (options.projectId) {
    query += ' AND ua.project_id = $' + (params.length + 1);
    params.push(options.projectId);
  }

  if (options.metricName) {
    query += ' AND ua.metric_name = $' + (params.length + 1);
    params.push(options.metricName);
  }

  query += `
    GROUP BY date, ua.metric_name
    ORDER BY date ASC
  `;

  const result = await queryRds<{
    date: string;
    metric_name: string;
    total_usage: string;
  }>(pool, query, params);

  // Group by date
  const trendsMap = new Map<string, UsageTrend>();

  for (const row of result.rows) {
    const date = row.date;
    if (!trendsMap.has(date)) {
      trendsMap.set(date, {
        date,
        totalUsage: 0,
        totalEvents: 0,
        totalCost: '0.00',
        metrics: {},
      });
    }

    const trend = trendsMap.get(date)!;
    const usage = parseFloat(row.total_usage);
    trend.totalUsage += usage;
    trend.totalEvents += usage;
    trend.metrics[row.metric_name] = (trend.metrics[row.metric_name] || 0) + usage;
  }

  return Array.from(trendsMap.values());
}

/**
 * Get cost breakdown by metric
 */
export async function getCostBreakdown(
  pool: pg.Pool,
  organisationId: string,
  options: {
    projectId?: string;
    startMonth?: number;
    startYear?: number;
    endMonth?: number;
    endYear?: number;
  }
): Promise<CostBreakdown[]> {
  const summary = await getUsageSummary(pool, organisationId, options);
  const totalCost = parseFloat(summary.totalCost);

  if (totalCost === 0) {
    return [];
  }

  return summary.metrics.map((metric) => {
    const cost = parseFloat(metric.totalCost);
    return {
      metricName: metric.metricName,
      unit: metric.unit,
      totalUsage: metric.totalUsage,
      totalCost: metric.totalCost,
      percentage: (cost / totalCost) * 100,
    };
  }).sort((a, b) => parseFloat(b.totalCost) - parseFloat(a.totalCost));
}

/**
 * Get project-level usage summary
 */
export async function getProjectUsageSummary(
  pool: pg.Pool,
  organisationId: string,
  projectId: string,
  options: {
    startMonth?: number;
    startYear?: number;
    endMonth?: number;
    endYear?: number;
  }
): Promise<UsageSummary> {
  return getUsageSummary(pool, organisationId, {
    ...options,
    projectId,
  });
}

/**
 * Get real-time usage (last 24 hours)
 */
export async function getRealTimeUsage(
  pool: pg.Pool,
  organisationId: string,
  options: {
    projectId?: string;
    metricName?: string;
  }
): Promise<{
  last24Hours: UsageSummary;
  lastHour: {
    totalEvents: number;
    totalUsage: number;
  };
}> {
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

  // Get events from last 24 hours
  let query = `
    SELECT 
      metric_name,
      unit,
      COUNT(*) as event_count,
      SUM(metric_value) as total_usage
    FROM usage_events
    WHERE organisation_id = $1
      AND ingested_at >= $2
  `;
  const params: unknown[] = [organisationId, last24Hours];

  if (options.projectId) {
    query += ' AND project_id = $' + (params.length + 1);
    params.push(options.projectId);
  }

  if (options.metricName) {
    query += ' AND metric_name = $' + (params.length + 1);
    params.push(options.metricName);
  }

  query += `
    GROUP BY metric_name, unit
    ORDER BY metric_name, unit
  `;

  const result = await queryRds<{
    metric_name: string;
    unit: string;
    event_count: number;
    total_usage: string;
  }>(pool, query, params);

  const metrics: UsageSummary['metrics'] = [];
  let totalUsage = 0;
  let totalEvents = 0;

  for (const row of result.rows) {
    const usage = parseFloat(row.total_usage);
    totalUsage += usage;
    totalEvents += row.event_count;

    metrics.push({
      metricName: row.metric_name,
      unit: row.unit,
      totalUsage: usage,
      totalEvents: row.event_count,
      totalCost: '0.00', // Real-time doesn't calculate cost
    });
  }

  // Get last hour stats
  const lastHourQuery = `
    SELECT 
      COUNT(*) as event_count,
      SUM(metric_value) as total_usage
    FROM usage_events
    WHERE organisation_id = $1
      AND ingested_at >= $2
  `;
  const lastHourParams: unknown[] = [organisationId, lastHour];
  if (options.projectId) {
    lastHourParams.push(options.projectId);
  }
  if (options.metricName) {
    lastHourParams.push(options.metricName);
  }

  const lastHourResult = await queryRds<{
    event_count: number;
    total_usage: string;
  }>(pool, lastHourQuery.replace('$2', '$' + (lastHourParams.length + 1)), lastHourParams);

  const lastHourStats = lastHourResult.rows[0] || { event_count: 0, total_usage: '0' };

  return {
    last24Hours: {
      organisationId,
      projectId: options.projectId,
      startDate: last24Hours,
      endDate: now,
      totalUsage,
      totalEvents,
      totalCost: '0.00',
      currency: 'INR',
      metrics,
    },
    lastHour: {
      totalEvents: lastHourStats.event_count,
      totalUsage: parseFloat(lastHourStats.total_usage),
    },
  };
}
