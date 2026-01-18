import pg from 'pg';
import { Env } from '../types/env.js';
import { queryRds, transaction } from '../db/rds.js';
import { createLogger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { getUsageSummary, getRealTimeUsage } from './analytics.js';
import Decimal from 'decimal.js';
import { toDecimal } from '../utils/decimal.js';

/**
 * Usage Alerts Service
 * 
 * Handles alert rule management and alert evaluation.
 * Supports:
 * - Usage threshold alerts
 * - Usage spike detection
 * - Cost threshold alerts
 * - Unusual pattern detection
 */

export interface AlertRule {
  id: string;
  organisationId: string;
  projectId?: string;
  name: string;
  description?: string;
  alertType: 'usage_threshold' | 'usage_spike' | 'cost_threshold' | 'unusual_pattern';
  metricName?: string;
  unit?: string;
  thresholdValue: string; // Decimal string
  thresholdOperator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  comparisonPeriod: 'hour' | 'day' | 'week' | 'month';
  spikeThresholdPercent?: number; // For usage_spike alerts
  spikeComparisonPeriod?: 'day' | 'week' | 'month'; // For usage_spike alerts
  isActive: boolean;
  notificationChannels: string[]; // 'email', 'sms', 'webhook'
  webhookUrl?: string;
  cooldownMinutes: number;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertHistory {
  id: string;
  alertRuleId: string;
  organisationId: string;
  projectId?: string;
  alertType: string;
  metricName?: string;
  unit?: string;
  thresholdValue: string;
  actualValue: string;
  comparisonPeriod: string;
  periodStart: Date;
  periodEnd: Date;
  status: 'pending' | 'sent' | 'failed' | 'acknowledged';
  notificationChannels: string[];
  sentAt?: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface AlertEvaluationResult {
  triggered: boolean;
  actualValue: string;
  thresholdValue: string;
  comparisonValue?: string; // For spike detection
  spikePercentage?: number; // For spike detection
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Create a new alert rule
 */
export async function createAlertRule(
  pool: pg.Pool,
  rule: Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'>
): Promise<AlertRule> {
  const logger = createLogger();

  // Validate alert rule
  validateAlertRule(rule);

  const result = await queryRds<AlertRule>(
    pool,
    `INSERT INTO alert_rules (
      organisation_id, project_id, name, description, alert_type,
      metric_name, unit, threshold_value, threshold_operator,
      comparison_period, spike_threshold_percent, spike_comparison_period,
      is_active, notification_channels, webhook_url, cooldown_minutes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING id, organisation_id, project_id, name, description, alert_type,
              metric_name, unit, threshold_value, threshold_operator,
              comparison_period, spike_threshold_percent, spike_comparison_period,
              is_active, notification_channels, webhook_url, cooldown_minutes,
              created_by, created_at, updated_at`,
    [
      rule.organisationId,
      rule.projectId || null,
      rule.name,
      rule.description || null,
      rule.alertType,
      rule.metricName || null,
      rule.unit || null,
      rule.thresholdValue,
      rule.thresholdOperator,
      rule.comparisonPeriod,
      rule.spikeThresholdPercent || null,
      rule.spikeComparisonPeriod || null,
      rule.isActive,
      rule.notificationChannels,
      rule.webhookUrl || null,
      rule.cooldownMinutes,
      rule.createdBy || null,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create alert rule');
  }

  return mapAlertRuleFromDb(result.rows[0]);
}

/**
 * Get alert rule by ID
 */
export async function getAlertRuleById(
  pool: pg.Pool,
  ruleId: string
): Promise<AlertRule | null> {
  const result = await queryRds<AlertRule>(
    pool,
    `SELECT id, organisation_id, project_id, name, description, alert_type,
            metric_name, unit, threshold_value, threshold_operator,
            comparison_period, spike_threshold_percent, spike_comparison_period,
            is_active, notification_channels, webhook_url, cooldown_minutes,
            created_by, created_at, updated_at
     FROM alert_rules
     WHERE id = $1`,
    [ruleId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapAlertRuleFromDb(result.rows[0]);
}

/**
 * Get all alert rules for an organisation
 */
export async function getAlertRulesByOrganisation(
  pool: pg.Pool,
  organisationId: string,
  options?: {
    projectId?: string;
    isActive?: boolean;
  }
): Promise<AlertRule[]> {
  let query = `
    SELECT id, organisation_id, project_id, name, description, alert_type,
           metric_name, unit, threshold_value, threshold_operator,
           comparison_period, spike_threshold_percent, spike_comparison_period,
           is_active, notification_channels, webhook_url, cooldown_minutes,
           created_by, created_at, updated_at
    FROM alert_rules
    WHERE organisation_id = $1
  `;
  const params: unknown[] = [organisationId];

  if (options?.projectId !== undefined) {
    query += ` AND (project_id = $${params.length + 1} OR project_id IS NULL)`;
    params.push(options.projectId);
  }

  if (options?.isActive !== undefined) {
    query += ` AND is_active = $${params.length + 1}`;
    params.push(options.isActive);
  }

  query += ` ORDER BY created_at DESC`;

  const result = await queryRds<AlertRule>(pool, query, params);

  return result.rows.map(mapAlertRuleFromDb);
}

/**
 * Update alert rule
 */
export async function updateAlertRule(
  pool: pg.Pool,
  ruleId: string,
  updates: Partial<Omit<AlertRule, 'id' | 'organisationId' | 'createdAt' | 'createdBy'>>
): Promise<AlertRule> {
  const existingRule = await getAlertRuleById(pool, ruleId);
  if (!existingRule) {
    throw new NotFoundError(`Alert rule not found: ${ruleId}`);
  }

  // Merge updates
  const updatedRule = { ...existingRule, ...updates };

  // Validate updated rule
  validateAlertRule(updatedRule);

  const result = await queryRds<AlertRule>(
    pool,
    `UPDATE alert_rules
     SET name = $1, description = $2, alert_type = $3,
         metric_name = $4, unit = $5, threshold_value = $6,
         threshold_operator = $7, comparison_period = $8,
         spike_threshold_percent = $9, spike_comparison_period = $10,
         is_active = $11, notification_channels = $12,
         webhook_url = $13, cooldown_minutes = $14, updated_at = NOW()
     WHERE id = $15
     RETURNING id, organisation_id, project_id, name, description, alert_type,
               metric_name, unit, threshold_value, threshold_operator,
               comparison_period, spike_threshold_percent, spike_comparison_period,
               is_active, notification_channels, webhook_url, cooldown_minutes,
               created_by, created_at, updated_at`,
    [
      updatedRule.name,
      updatedRule.description || null,
      updatedRule.alertType,
      updatedRule.metricName || null,
      updatedRule.unit || null,
      updatedRule.thresholdValue,
      updatedRule.thresholdOperator,
      updatedRule.comparisonPeriod,
      updatedRule.spikeThresholdPercent || null,
      updatedRule.spikeComparisonPeriod || null,
      updatedRule.isActive,
      updatedRule.notificationChannels,
      updatedRule.webhookUrl || null,
      updatedRule.cooldownMinutes,
      ruleId,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to update alert rule');
  }

  return mapAlertRuleFromDb(result.rows[0]);
}

/**
 * Delete alert rule
 */
export async function deleteAlertRule(
  pool: pg.Pool,
  ruleId: string
): Promise<void> {
  const result = await queryRds(
    pool,
    `DELETE FROM alert_rules WHERE id = $1`,
    [ruleId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError(`Alert rule not found: ${ruleId}`);
  }
}

/**
 * Evaluate an alert rule and check if it should trigger
 */
export async function evaluateAlertRule(
  pool: pg.Pool,
  env: Env,
  rule: AlertRule
): Promise<AlertEvaluationResult | null> {
  const logger = createLogger(env);

  if (!rule.isActive) {
    return null;
  }

  // Check cooldown period
  const cooldownCheck = await queryRds<{ check_alert_cooldown: boolean }>(
    pool,
    `SELECT check_alert_cooldown($1, $2) as check_alert_cooldown`,
    [rule.id, rule.cooldownMinutes]
  );

  if (!cooldownCheck.rows[0]?.check_alert_cooldown) {
    logger.debug('Alert rule in cooldown period', { ruleId: rule.id });
    return null;
  }

  // Calculate period dates
  const { periodStart, periodEnd } = calculatePeriodDates(rule.comparisonPeriod);

  let evaluationResult: AlertEvaluationResult | null = null;

  switch (rule.alertType) {
    case 'usage_threshold':
      evaluationResult = await evaluateUsageThreshold(
        pool,
        rule,
        periodStart,
        periodEnd
      );
      break;

    case 'usage_spike':
      evaluationResult = await evaluateUsageSpike(
        pool,
        rule,
        periodStart,
        periodEnd
      );
      break;

    case 'cost_threshold':
      evaluationResult = await evaluateCostThreshold(
        pool,
        rule,
        periodStart,
        periodEnd
      );
      break;

    case 'unusual_pattern':
      evaluationResult = await evaluateUnusualPattern(
        pool,
        rule,
        periodStart,
        periodEnd
      );
      break;

    default:
      logger.warn('Unknown alert type', { alertType: rule.alertType });
      return null;
  }

  return evaluationResult;
}

/**
 * Evaluate usage threshold alert
 */
async function evaluateUsageThreshold(
  pool: pg.Pool,
  rule: AlertRule,
  periodStart: Date,
  periodEnd: Date
): Promise<AlertEvaluationResult | null> {
  if (!rule.metricName || !rule.unit) {
    return null;
  }

  // Get usage for the period
  const usageSummary = await getUsageSummary(pool, rule.organisationId, {
    projectId: rule.projectId,
    metricName: rule.metricName,
    startYear: periodStart.getFullYear(),
    startMonth: periodStart.getMonth() + 1,
    endYear: periodEnd.getFullYear(),
    endMonth: periodEnd.getMonth() + 1,
  });

  // Find matching metric
  const metric = usageSummary.metrics.find(
    (m) => m.metricName === rule.metricName && m.unit === rule.unit
  );

  if (!metric) {
    return null; // No usage for this metric
  }

  const actualValue = toDecimal(metric.totalUsage.toString());
  const thresholdValue = toDecimal(rule.thresholdValue);

  // Check threshold condition
  const triggered = checkThresholdCondition(
    actualValue,
    thresholdValue,
    rule.thresholdOperator
  );

  if (!triggered) {
    return null;
  }

  return {
    triggered: true,
    actualValue: actualValue.toString(),
    thresholdValue: rule.thresholdValue,
    periodStart,
    periodEnd,
  };
}

/**
 * Evaluate usage spike alert
 */
async function evaluateUsageSpike(
  pool: pg.Pool,
  rule: AlertRule,
  periodStart: Date,
  periodEnd: Date
): Promise<AlertEvaluationResult | null> {
  if (!rule.metricName || !rule.unit || !rule.spikeThresholdPercent || !rule.spikeComparisonPeriod) {
    return null;
  }

  // Get current period usage
  const currentUsage = await getUsageSummary(pool, rule.organisationId, {
    projectId: rule.projectId,
    metricName: rule.metricName,
    startYear: periodStart.getFullYear(),
    startMonth: periodStart.getMonth() + 1,
    endYear: periodEnd.getFullYear(),
    endMonth: periodEnd.getMonth() + 1,
  });

  // Calculate comparison period
  const comparisonDates = calculateComparisonPeriod(
    periodStart,
    rule.spikeComparisonPeriod
  );

  // Get comparison period usage
  const comparisonUsage = await getUsageSummary(pool, rule.organisationId, {
    projectId: rule.projectId,
    metricName: rule.metricName,
    startYear: comparisonDates.start.getFullYear(),
    startMonth: comparisonDates.start.getMonth() + 1,
    endYear: comparisonDates.end.getFullYear(),
    endMonth: comparisonDates.end.getMonth() + 1,
  });

  const currentMetric = currentUsage.metrics.find(
    (m) => m.metricName === rule.metricName && m.unit === rule.unit
  );
  const comparisonMetric = comparisonUsage.metrics.find(
    (m) => m.metricName === rule.metricName && m.unit === rule.unit
  );

  if (!currentMetric || !comparisonMetric) {
    return null; // No usage data
  }

  const currentValue = toDecimal(currentMetric.totalUsage.toString());
  const comparisonValue = toDecimal(comparisonMetric.totalUsage.toString());

  if (comparisonValue.equals(0)) {
    return null; // Can't calculate spike from zero
  }

  // Calculate spike percentage
  const spikePercentage = currentValue
    .minus(comparisonValue)
    .div(comparisonValue)
    .mul(100)
    .toNumber();

  const thresholdPercent = rule.spikeThresholdPercent;

  // Check if spike exceeds threshold
  if (spikePercentage >= thresholdPercent) {
    return {
      triggered: true,
      actualValue: currentValue.toString(),
      thresholdValue: rule.thresholdValue,
      comparisonValue: comparisonValue.toString(),
      spikePercentage,
      periodStart,
      periodEnd,
    };
  }

  return null;
}

/**
 * Evaluate cost threshold alert
 */
async function evaluateCostThreshold(
  pool: pg.Pool,
  rule: AlertRule,
  periodStart: Date,
  periodEnd: Date
): Promise<AlertEvaluationResult | null> {
  // Get cost for the period
  const usageSummary = await getUsageSummary(pool, rule.organisationId, {
    projectId: rule.projectId,
    startYear: periodStart.getFullYear(),
    startMonth: periodStart.getMonth() + 1,
    endYear: periodEnd.getFullYear(),
    endMonth: periodEnd.getMonth() + 1,
  });

  const actualValue = toDecimal(usageSummary.totalCost);
  const thresholdValue = toDecimal(rule.thresholdValue);

  // Check threshold condition
  const triggered = checkThresholdCondition(
    actualValue,
    thresholdValue,
    rule.thresholdOperator
  );

  if (!triggered) {
    return null;
  }

  return {
    triggered: true,
    actualValue: actualValue.toString(),
    thresholdValue: rule.thresholdValue,
    periodStart,
    periodEnd,
  };
}

/**
 * Evaluate unusual pattern alert (simplified: checks for sudden drop to zero)
 */
async function evaluateUnusualPattern(
  pool: pg.Pool,
  rule: AlertRule,
  periodStart: Date,
  periodEnd: Date
): Promise<AlertEvaluationResult | null> {
  if (!rule.metricName || !rule.unit) {
    return null;
  }

  // Get real-time usage (last 24 hours)
  const realtimeUsage = await getRealTimeUsage(pool, rule.organisationId, {
    projectId: rule.projectId,
    metricName: rule.metricName,
  });

  // Check if usage dropped to zero unexpectedly
  // This is a simplified check - could be enhanced with ML/statistical analysis
  const last24Hours = realtimeUsage.last24Hours.metrics.find(
    (m) => m.metricName === rule.metricName && m.unit === rule.unit
  );

  if (!last24Hours) {
    return null;
  }

  // If usage is zero but threshold suggests it should be non-zero
  const actualValue = toDecimal(last24Hours.totalUsage.toString());
  const thresholdValue = toDecimal(rule.thresholdValue);

  if (actualValue.equals(0) && thresholdValue.greaterThan(0)) {
    return {
      triggered: true,
      actualValue: actualValue.toString(),
      thresholdValue: rule.thresholdValue,
      periodStart,
      periodEnd,
    };
  }

  return null;
}

/**
 * Create alert history record
 */
export async function createAlertHistory(
  pool: pg.Pool,
  rule: AlertRule,
  evaluationResult: AlertEvaluationResult
): Promise<AlertHistory> {
  const result = await queryRds<AlertHistory>(
    pool,
    `INSERT INTO alert_history (
      alert_rule_id, organisation_id, project_id, alert_type,
      metric_name, unit, threshold_value, actual_value,
      comparison_period, period_start, period_end,
      notification_channels, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id, alert_rule_id, organisation_id, project_id, alert_type,
              metric_name, unit, threshold_value, actual_value,
              comparison_period, period_start, period_end, status,
              notification_channels, sent_at, acknowledged_at, acknowledged_by,
              error_message, metadata, created_at`,
    [
      rule.id,
      rule.organisationId,
      rule.projectId || null,
      rule.alertType,
      rule.metricName || null,
      rule.unit || null,
      rule.thresholdValue,
      evaluationResult.actualValue,
      rule.comparisonPeriod,
      evaluationResult.periodStart,
      evaluationResult.periodEnd,
      rule.notificationChannels,
      JSON.stringify({
        comparisonValue: evaluationResult.comparisonValue,
        spikePercentage: evaluationResult.spikePercentage,
      }),
    ]
  );

  return mapAlertHistoryFromDb(result.rows[0]);
}

/**
 * Get alert history for an organisation
 */
export async function getAlertHistory(
  pool: pg.Pool,
  organisationId: string,
  options?: {
    projectId?: string;
    alertRuleId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<AlertHistory[]> {
  let query = `
    SELECT id, alert_rule_id, organisation_id, project_id, alert_type,
           metric_name, unit, threshold_value, actual_value,
           comparison_period, period_start, period_end, status,
           notification_channels, sent_at, acknowledged_at, acknowledged_by,
           error_message, metadata, created_at
    FROM alert_history
    WHERE organisation_id = $1
  `;
  const params: unknown[] = [organisationId];

  if (options?.projectId !== undefined) {
    query += ` AND (project_id = $${params.length + 1} OR project_id IS NULL)`;
    params.push(options.projectId);
  }

  if (options?.alertRuleId) {
    query += ` AND alert_rule_id = $${params.length + 1}`;
    params.push(options.alertRuleId);
  }

  if (options?.status) {
    query += ` AND status = $${params.length + 1}`;
    params.push(options.status);
  }

  query += ` ORDER BY created_at DESC`;

  if (options?.limit) {
    query += ` LIMIT $${params.length + 1}`;
    params.push(options.limit);
  }

  if (options?.offset) {
    query += ` OFFSET $${params.length + 1}`;
    params.push(options.offset);
  }

  const result = await queryRds<AlertHistory>(pool, query, params);

  return result.rows.map(mapAlertHistoryFromDb);
}

/**
 * Update alert history status
 */
export async function updateAlertHistoryStatus(
  pool: pg.Pool,
  alertId: string,
  status: 'sent' | 'failed' | 'acknowledged',
  options?: {
    errorMessage?: string;
    acknowledgedBy?: string;
  }
): Promise<void> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  updates.push(`status = $${paramIndex++}`);
  values.push(status);

  if (status === 'sent') {
    updates.push(`sent_at = NOW()`);
  } else if (status === 'acknowledged') {
    updates.push(`acknowledged_at = NOW()`);
    if (options?.acknowledgedBy) {
      updates.push(`acknowledged_by = $${paramIndex++}`);
      values.push(options.acknowledgedBy);
    }
  } else if (status === 'failed' && options?.errorMessage) {
    updates.push(`error_message = $${paramIndex++}`);
    values.push(options.errorMessage);
  }

  values.push(alertId);
  updates.push(`WHERE id = $${paramIndex}`);

  await queryRds(pool, `UPDATE alert_history SET ${updates.join(', ')}`, values);
}

// Helper functions

function validateAlertRule(rule: Partial<AlertRule>): void {
  if (!rule.name || rule.name.trim().length === 0) {
    throw new ValidationError('Alert rule name is required');
  }

  if (!rule.alertType) {
    throw new ValidationError('Alert type is required');
  }

  if (rule.alertType === 'usage_threshold' || rule.alertType === 'unusual_pattern') {
    if (!rule.metricName || !rule.unit) {
      throw new ValidationError('Metric name and unit are required for usage threshold alerts');
    }
  }

  if (rule.alertType === 'usage_spike') {
    if (!rule.metricName || !rule.unit || !rule.spikeThresholdPercent || !rule.spikeComparisonPeriod) {
      throw new ValidationError('Metric name, unit, spike threshold, and comparison period are required for usage spike alerts');
    }
  }

  if (!rule.thresholdValue || parseFloat(rule.thresholdValue) < 0) {
    throw new ValidationError('Threshold value must be a non-negative number');
  }

  if (!rule.notificationChannels || rule.notificationChannels.length === 0) {
    throw new ValidationError('At least one notification channel is required');
  }

  if (rule.notificationChannels.includes('webhook') && !rule.webhookUrl) {
    throw new ValidationError('Webhook URL is required when webhook notification channel is selected');
  }
}

function checkThresholdCondition(
  actual: Decimal,
  threshold: Decimal,
  operator: string
): boolean {
  switch (operator) {
    case 'gt':
      return actual.greaterThan(threshold);
    case 'gte':
      return actual.greaterThanOrEqualTo(threshold);
    case 'lt':
      return actual.lessThan(threshold);
    case 'lte':
      return actual.lessThanOrEqualTo(threshold);
    case 'eq':
      return actual.equals(threshold);
    default:
      return false;
  }
}

function calculatePeriodDates(period: string): { periodStart: Date; periodEnd: Date } {
  const now = new Date();
  let periodStart: Date;
  let periodEnd: Date = new Date(now);

  switch (period) {
    case 'hour':
      periodStart = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case 'day':
      periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'week':
      const dayOfWeek = now.getDay();
      periodStart = new Date(now.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
      periodStart.setHours(0, 0, 0, 0);
      break;
    case 'month':
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      break;
    default:
      periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  return { periodStart, periodEnd };
}

function calculateComparisonPeriod(
  currentStart: Date,
  comparisonPeriod: string
): { start: Date; end: Date } {
  const currentEnd = new Date(currentStart);
  const duration = currentEnd.getTime() - currentStart.getTime();

  let start: Date;
  let end: Date;

  switch (comparisonPeriod) {
    case 'day':
      start = new Date(currentStart.getTime() - 24 * 60 * 60 * 1000);
      end = new Date(currentStart);
      break;
    case 'week':
      start = new Date(currentStart.getTime() - 7 * 24 * 60 * 60 * 1000);
      end = new Date(currentStart);
      break;
    case 'month':
      start = new Date(currentStart.getFullYear(), currentStart.getMonth() - 1, currentStart.getDate());
      end = new Date(currentStart);
      break;
    default:
      start = new Date(currentStart.getTime() - duration);
      end = new Date(currentStart);
  }

  return { start, end };
}

function mapAlertRuleFromDb(row: any): AlertRule {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    projectId: row.project_id || undefined,
    name: row.name,
    description: row.description || undefined,
    alertType: row.alert_type,
    metricName: row.metric_name || undefined,
    unit: row.unit || undefined,
    thresholdValue: row.threshold_value.toString(),
    thresholdOperator: row.threshold_operator,
    comparisonPeriod: row.comparison_period,
    spikeThresholdPercent: row.spike_threshold_percent || undefined,
    spikeComparisonPeriod: row.spike_comparison_period || undefined,
    isActive: row.is_active,
    notificationChannels: row.notification_channels || [],
    webhookUrl: row.webhook_url || undefined,
    cooldownMinutes: row.cooldown_minutes,
    createdBy: row.created_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAlertHistoryFromDb(row: any): AlertHistory {
  return {
    id: row.id,
    alertRuleId: row.alert_rule_id,
    organisationId: row.organisation_id,
    projectId: row.project_id || undefined,
    alertType: row.alert_type,
    metricName: row.metric_name || undefined,
    unit: row.unit || undefined,
    thresholdValue: row.threshold_value.toString(),
    actualValue: row.actual_value.toString(),
    comparisonPeriod: row.comparison_period,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    notificationChannels: row.notification_channels || [],
    sentAt: row.sent_at || undefined,
    acknowledgedAt: row.acknowledged_at || undefined,
    acknowledgedBy: row.acknowledged_by || undefined,
    errorMessage: row.error_message || undefined,
    metadata: row.metadata || undefined,
    createdAt: row.created_at,
  };
}
