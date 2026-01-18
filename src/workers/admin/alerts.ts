import { Env } from '../../types/env.js';
import { createRdsPool } from '../../db/rds.js';
import {
  createAlertRule,
  getAlertRuleById,
  getAlertRulesByOrganisation,
  updateAlertRule,
  deleteAlertRule,
  getAlertHistory,
} from '../../services/usage-alerts.js';
import { formatError, ValidationError, NotFoundError } from '../../utils/errors.js';
import { AdminAuthContext } from '../../services/admin-auth.js';
import { checkPermission, checkOrganisationAccess } from '../../services/admin-auth.js';
import { z } from 'zod';
import { createLogger } from '../../utils/logger.js';

/**
 * Admin API: Alert Rules Management
 * 
 * Provides CRUD operations for alert rules and alert history.
 */

// Request/Response schemas
const AlertRuleCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  alertType: z.enum(['usage_threshold', 'usage_spike', 'cost_threshold', 'unusual_pattern']),
  metricName: z.string().optional(),
  unit: z.string().optional(),
  thresholdValue: z.string().regex(/^\d+(\.\d+)?$/), // Decimal string
  thresholdOperator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
  comparisonPeriod: z.enum(['hour', 'day', 'week', 'month']),
  spikeThresholdPercent: z.number().optional(),
  spikeComparisonPeriod: z.enum(['day', 'week', 'month']).optional(),
  isActive: z.boolean().default(true),
  notificationChannels: z.array(z.enum(['email', 'sms', 'webhook'])).min(1),
  webhookUrl: z.string().url().optional(),
  cooldownMinutes: z.number().int().min(0).default(60),
  projectId: z.string().uuid().optional(),
});

const AlertRuleUpdateSchema = AlertRuleCreateSchema.partial().extend({
  name: z.string().min(1).max(255).optional(),
  alertType: z.enum(['usage_threshold', 'usage_spike', 'cost_threshold', 'unusual_pattern']).optional(),
});

/**
 * Create Alert Rule
 * 
 * POST /api/v1/admin/organisations/:organisationId/alert-rules
 */
export async function handleCreateAlertRule(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'write');

    const url = new URL(request.url);
    const organisationId = url.pathname.split('/')[4]; // /api/v1/admin/organisations/:organisationId/alert-rules

    checkOrganisationAccess(authContext, organisationId);

    const body = await request.json();
    const parsedBody = AlertRuleCreateSchema.parse(body);

    const rdsPool = createRdsPool(env);
    const rule = await createAlertRule(rdsPool, {
      organisationId,
      projectId: parsedBody.projectId,
      name: parsedBody.name,
      description: parsedBody.description,
      alertType: parsedBody.alertType,
      metricName: parsedBody.metricName,
      unit: parsedBody.unit,
      thresholdValue: parsedBody.thresholdValue,
      thresholdOperator: parsedBody.thresholdOperator,
      comparisonPeriod: parsedBody.comparisonPeriod,
      spikeThresholdPercent: parsedBody.spikeThresholdPercent,
      spikeComparisonPeriod: parsedBody.spikeComparisonPeriod,
      isActive: parsedBody.isActive,
      notificationChannels: parsedBody.notificationChannels,
      webhookUrl: parsedBody.webhookUrl,
      cooldownMinutes: parsedBody.cooldownMinutes,
      createdBy: authContext.userId,
    });

    return new Response(
      JSON.stringify({
        id: rule.id,
        organisationId: rule.organisationId,
        projectId: rule.projectId,
        name: rule.name,
        description: rule.description,
        alertType: rule.alertType,
        metricName: rule.metricName,
        unit: rule.unit,
        thresholdValue: rule.thresholdValue,
        thresholdOperator: rule.thresholdOperator,
        comparisonPeriod: rule.comparisonPeriod,
        spikeThresholdPercent: rule.spikeThresholdPercent,
        spikeComparisonPeriod: rule.spikeComparisonPeriod,
        isActive: rule.isActive,
        notificationChannels: rule.notificationChannels,
        webhookUrl: rule.webhookUrl,
        cooldownMinutes: rule.cooldownMinutes,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to create alert rule', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * List Alert Rules
 * 
 * GET /api/v1/admin/organisations/:organisationId/alert-rules
 */
export async function handleListAlertRules(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'read');

    const url = new URL(request.url);
    const organisationId = url.pathname.split('/')[4];
    const projectId = url.searchParams.get('projectId') || undefined;
    const isActive = url.searchParams.get('isActive');
    const isActiveBool = isActive ? isActive === 'true' : undefined;

    checkOrganisationAccess(authContext, organisationId);

    const rdsPool = createRdsPool(env);
    const rules = await getAlertRulesByOrganisation(rdsPool, organisationId, {
      projectId,
      isActive: isActiveBool,
    });

    return new Response(
      JSON.stringify({
        rules: rules.map((rule) => ({
          id: rule.id,
          organisationId: rule.organisationId,
          projectId: rule.projectId,
          name: rule.name,
          description: rule.description,
          alertType: rule.alertType,
          metricName: rule.metricName,
          unit: rule.unit,
          thresholdValue: rule.thresholdValue,
          thresholdOperator: rule.thresholdOperator,
          comparisonPeriod: rule.comparisonPeriod,
          spikeThresholdPercent: rule.spikeThresholdPercent,
          spikeComparisonPeriod: rule.spikeComparisonPeriod,
          isActive: rule.isActive,
          notificationChannels: rule.notificationChannels,
          webhookUrl: rule.webhookUrl,
          cooldownMinutes: rule.cooldownMinutes,
          createdAt: rule.createdAt.toISOString(),
          updatedAt: rule.updatedAt.toISOString(),
        })),
        total: rules.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to list alert rules', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Get Alert Rule
 * 
 * GET /api/v1/admin/alert-rules/:ruleId
 */
export async function handleGetAlertRule(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'read');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/alert-rules\/([^/]+)/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: ruleId required in path');
    }
    const ruleId = pathMatch[1];

    const rdsPool = createRdsPool(env);
    const rule = await getAlertRuleById(rdsPool, ruleId);

    if (!rule) {
      throw new NotFoundError(`Alert rule not found: ${ruleId}`);
    }

    checkOrganisationAccess(authContext, rule.organisationId);

    return new Response(
      JSON.stringify({
        id: rule.id,
        organisationId: rule.organisationId,
        projectId: rule.projectId,
        name: rule.name,
        description: rule.description,
        alertType: rule.alertType,
        metricName: rule.metricName,
        unit: rule.unit,
        thresholdValue: rule.thresholdValue,
        thresholdOperator: rule.thresholdOperator,
        comparisonPeriod: rule.comparisonPeriod,
        spikeThresholdPercent: rule.spikeThresholdPercent,
        spikeComparisonPeriod: rule.spikeComparisonPeriod,
        isActive: rule.isActive,
        notificationChannels: rule.notificationChannels,
        webhookUrl: rule.webhookUrl,
        cooldownMinutes: rule.cooldownMinutes,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to get alert rule', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Update Alert Rule
 * 
 * PATCH /api/v1/admin/alert-rules/:ruleId
 */
export async function handleUpdateAlertRule(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'PATCH') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'write');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/alert-rules\/([^/]+)/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: ruleId required in path');
    }
    const ruleId = pathMatch[1];

    const rdsPool = createRdsPool(env);
    const existingRule = await getAlertRuleById(rdsPool, ruleId);

    if (!existingRule) {
      throw new NotFoundError(`Alert rule not found: ${ruleId}`);
    }

    checkOrganisationAccess(authContext, existingRule.organisationId);

    const body = await request.json();
    const parsedBody = AlertRuleUpdateSchema.parse(body);

    const updatedRule = await updateAlertRule(rdsPool, ruleId, parsedBody);

    return new Response(
      JSON.stringify({
        id: updatedRule.id,
        organisationId: updatedRule.organisationId,
        projectId: updatedRule.projectId,
        name: updatedRule.name,
        description: updatedRule.description,
        alertType: updatedRule.alertType,
        metricName: updatedRule.metricName,
        unit: updatedRule.unit,
        thresholdValue: updatedRule.thresholdValue,
        thresholdOperator: updatedRule.thresholdOperator,
        comparisonPeriod: updatedRule.comparisonPeriod,
        spikeThresholdPercent: updatedRule.spikeThresholdPercent,
        spikeComparisonPeriod: updatedRule.spikeComparisonPeriod,
        isActive: updatedRule.isActive,
        notificationChannels: updatedRule.notificationChannels,
        webhookUrl: updatedRule.webhookUrl,
        cooldownMinutes: updatedRule.cooldownMinutes,
        createdAt: updatedRule.createdAt.toISOString(),
        updatedAt: updatedRule.updatedAt.toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to update alert rule', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Delete Alert Rule
 * 
 * DELETE /api/v1/admin/alert-rules/:ruleId
 */
export async function handleDeleteAlertRule(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'DELETE') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'write');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/alert-rules\/([^/]+)/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: ruleId required in path');
    }
    const ruleId = pathMatch[1];

    const rdsPool = createRdsPool(env);
    const rule = await getAlertRuleById(rdsPool, ruleId);

    if (!rule) {
      throw new NotFoundError(`Alert rule not found: ${ruleId}`);
    }

    checkOrganisationAccess(authContext, rule.organisationId);

    await deleteAlertRule(rdsPool, ruleId);

    return new Response(
      JSON.stringify({
        message: 'Alert rule deleted successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to delete alert rule', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Get Alert History
 * 
 * GET /api/v1/admin/organisations/:organisationId/alert-history
 */
export async function handleGetAlertHistory(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'read');

    const url = new URL(request.url);
    const organisationId = url.pathname.split('/')[4];
    const projectId = url.searchParams.get('projectId') || undefined;
    const alertRuleId = url.searchParams.get('alertRuleId') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : 50;
    const offset = url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!, 10) : 0;

    checkOrganisationAccess(authContext, organisationId);

    const rdsPool = createRdsPool(env);
    const history = await getAlertHistory(rdsPool, organisationId, {
      projectId,
      alertRuleId,
      status,
      limit,
      offset,
    });

    return new Response(
      JSON.stringify({
        alerts: history.map((alert) => ({
          id: alert.id,
          alertRuleId: alert.alertRuleId,
          organisationId: alert.organisationId,
          projectId: alert.projectId,
          alertType: alert.alertType,
          metricName: alert.metricName,
          unit: alert.unit,
          thresholdValue: alert.thresholdValue,
          actualValue: alert.actualValue,
          comparisonPeriod: alert.comparisonPeriod,
          periodStart: alert.periodStart.toISOString(),
          periodEnd: alert.periodEnd.toISOString(),
          status: alert.status,
          notificationChannels: alert.notificationChannels,
          sentAt: alert.sentAt?.toISOString(),
          acknowledgedAt: alert.acknowledgedAt?.toISOString(),
          acknowledgedBy: alert.acknowledgedBy,
          errorMessage: alert.errorMessage,
          metadata: alert.metadata,
          createdAt: alert.createdAt.toISOString(),
        })),
        total: history.length,
        limit,
        offset,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to get alert history', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
