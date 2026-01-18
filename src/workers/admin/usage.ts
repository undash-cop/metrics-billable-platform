import { Env } from '../../types/env.js';
import { createRdsPool } from '../../db/rds.js';
import {
  UsageSummaryQuerySchema,
  UsageSummaryResponseSchema,
  type UsageSummaryResponse,
} from '../../types/api.js';
import { formatError, ValidationError } from '../../utils/errors.js';
import { AdminAuthContext } from '../../services/admin-auth.js';
import { checkPermission, checkOrganisationAccess } from '../../services/admin-auth.js';
import { queryRds } from '../../db/rds.js';

/**
 * Admin API: Usage Summary
 * 
 * GET /api/v1/admin/organisations/:organisationId/usage
 * 
 * Returns usage summary for an organisation.
 * Read-only endpoint.
 */

export async function handleUsageSummary(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Check permission
    checkPermission(authContext, 'read');

    const url = new URL(request.url);
    // Extract organisation ID from path
    const pathMatch = url.pathname.match(/\/organisations\/([^/]+)\/usage/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: organisationId required in path');
    }

    const organisationId = pathMatch[1];
    checkOrganisationAccess(authContext, organisationId);

    // Parse query parameters
    const queryParams: Record<string, unknown> = {
      organisationId,
      startMonth: url.searchParams.get('startMonth')
        ? parseInt(url.searchParams.get('startMonth')!, 10)
        : undefined,
      startYear: url.searchParams.get('startYear')
        ? parseInt(url.searchParams.get('startYear')!, 10)
        : undefined,
      endMonth: url.searchParams.get('endMonth')
        ? parseInt(url.searchParams.get('endMonth')!, 10)
        : undefined,
      endYear: url.searchParams.get('endYear')
        ? parseInt(url.searchParams.get('endYear')!, 10)
        : undefined,
      projectId: url.searchParams.get('projectId') || undefined,
      metricName: url.searchParams.get('metricName') || undefined,
    };

    const validationResult = UsageSummaryQuerySchema.safeParse(queryParams);
    if (!validationResult.success) {
      throw new ValidationError('Invalid query parameters', {
        errors: validationResult.error.errors,
      });
    }

    const query = validationResult.data;

    // Get organisation name
    const rdsPool = createRdsPool(env);
    const orgResult = await queryRds<{ name: string }>(
      rdsPool,
      `SELECT name FROM organisations WHERE id = $1`,
      [organisationId]
    );

    if (orgResult.rows.length === 0) {
      throw new ValidationError(`Organisation not found: ${organisationId}`);
    }

    const organisationName = orgResult.rows[0].name;

    // Build query for usage aggregates
    let sql = `
      SELECT 
        ua.project_id,
        p.name AS project_name,
        ua.metric_name,
        ua.unit,
        ua.total_value,
        ua.event_count,
        ua.month,
        ua.year
      FROM usage_aggregates ua
      JOIN projects p ON p.id = ua.project_id
      WHERE ua.organisation_id = $1
    `;

    const params: unknown[] = [organisationId];
    let paramIndex = 2;

    if (query.startMonth && query.startYear) {
      sql += ` AND (ua.year > $${paramIndex} OR (ua.year = $${paramIndex} AND ua.month >= $${paramIndex + 1}))`;
      params.push(query.startYear, query.startMonth);
      paramIndex += 2;
    }

    if (query.endMonth && query.endYear) {
      sql += ` AND (ua.year < $${paramIndex} OR (ua.year = $${paramIndex} AND ua.month <= $${paramIndex + 1}))`;
      params.push(query.endYear, query.endMonth);
      paramIndex += 2;
    }

    if (query.projectId) {
      sql += ` AND ua.project_id = $${paramIndex}`;
      params.push(query.projectId);
      paramIndex++;
    }

    if (query.metricName) {
      sql += ` AND ua.metric_name = $${paramIndex}`;
      params.push(query.metricName);
      paramIndex++;
    }

    sql += ` ORDER BY ua.year DESC, ua.month DESC, ua.metric_name, ua.project_id`;

    const result = await queryRds<{
      project_id: string;
      project_name: string;
      metric_name: string;
      unit: string;
      total_value: number;
      event_count: number;
      month: number;
      year: number;
    }>(rdsPool, sql, params);

    // Aggregate by metric
    const metricsMap = new Map<
      string,
      {
        metricName: string;
        unit: string;
        totalValue: number;
        eventCount: number;
        projects: Array<{
          projectId: string;
          projectName: string;
          value: number;
        }>;
      }
    >();

    const projectsSet = new Set<string>();

    for (const row of result.rows) {
      const key = `${row.metric_name}_${row.unit}`;
      projectsSet.add(row.project_id);

      if (!metricsMap.has(key)) {
        metricsMap.set(key, {
          metricName: row.metric_name,
          unit: row.unit,
          totalValue: 0,
          eventCount: 0,
          projects: [],
        });
      }

      const metric = metricsMap.get(key)!;
      metric.totalValue += Number(row.total_value);
      metric.eventCount += row.event_count || 0;
      metric.projects.push({
        projectId: row.project_id,
        projectName: row.project_name,
        value: Number(row.total_value),
      });
    }

    // Determine period
    const startMonth = query.startMonth || 1;
    const startYear = query.startYear || new Date().getFullYear();
    const endMonth = query.endMonth || 12;
    const endYear = query.endYear || new Date().getFullYear();

    const response: UsageSummaryResponse = {
      organisationId,
      organisationName,
      period: {
        start: { month: startMonth, year: startYear },
        end: { month: endMonth, year: endYear },
      },
      metrics: Array.from(metricsMap.values()),
      totalProjects: projectsSet.size,
      totalMetrics: metricsMap.size,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const formattedError = formatError(error);
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
