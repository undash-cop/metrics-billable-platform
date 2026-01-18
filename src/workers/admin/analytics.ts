import { Env } from '../../types/env.js';
import { createRdsPool } from '../../db/rds.js';
import {
  getUsageSummary,
  getUsageTrends,
  getCostBreakdown,
  getProjectUsageSummary,
  getRealTimeUsage,
} from '../../services/analytics.js';
import { formatError } from '../../utils/errors.js';
import { AuthContext } from '../../services/admin-auth.js';

/**
 * Admin API: Analytics Endpoints
 * 
 * Provides usage analytics and dashboards.
 */

/**
 * GET /api/v1/admin/organisations/:orgId/analytics/summary
 * Get usage summary for an organisation (analytics version)
 */
export async function handleAnalyticsSummary(
  request: Request,
  env: Env,
  authContext: AuthContext
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const orgId = url.pathname.split('/')[4]; // /api/v1/admin/organisations/:orgId/analytics/summary

    // Check permissions
    if (!authContext.permissions.includes('read') && authContext.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check organisation access
    if (authContext.organisationId && authContext.organisationId !== orgId) {
      return new Response(
        JSON.stringify({ error: 'Access denied to this organisation' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse query parameters
    const params = url.searchParams;
    const projectId = params.get('projectId') || undefined;
    const metricName = params.get('metricName') || undefined;
    const startMonth = params.get('startMonth') ? parseInt(params.get('startMonth')!, 10) : undefined;
    const startYear = params.get('startYear') ? parseInt(params.get('startYear')!, 10) : undefined;
    const endMonth = params.get('endMonth') ? parseInt(params.get('endMonth')!, 10) : undefined;
    const endYear = params.get('endYear') ? parseInt(params.get('endYear')!, 10) : undefined;

    const pool = createRdsPool(env);
    const summary = await getUsageSummary(pool, orgId, {
      projectId,
      metricName,
      startMonth,
      startYear,
      endMonth,
      endYear,
    });

    await pool.end();

    return new Response(JSON.stringify(summary), {
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

/**
 * GET /api/v1/admin/organisations/:orgId/analytics/trends
 * Get usage trends over time
 */
export async function handleUsageTrends(
  request: Request,
  env: Env,
  authContext: AuthContext
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const orgId = url.pathname.split('/')[4];

    // Check permissions
    if (!authContext.permissions.includes('read') && authContext.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check organisation access
    if (authContext.organisationId && authContext.organisationId !== orgId) {
      return new Response(
        JSON.stringify({ error: 'Access denied to this organisation' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse query parameters
    const params = url.searchParams;
    const projectId = params.get('projectId') || undefined;
    const metricName = params.get('metricName') || undefined;
    const startMonth = params.get('startMonth') ? parseInt(params.get('startMonth')!, 10) : undefined;
    const startYear = params.get('startYear') ? parseInt(params.get('startYear')!, 10) : undefined;
    const endMonth = params.get('endMonth') ? parseInt(params.get('endMonth')!, 10) : undefined;
    const endYear = params.get('endYear') ? parseInt(params.get('endYear')!, 10) : undefined;
    const groupBy = (params.get('groupBy') || 'month') as 'day' | 'week' | 'month';

    const pool = createRdsPool(env);
    const trends = await getUsageTrends(pool, orgId, {
      projectId,
      metricName,
      startMonth,
      startYear,
      endMonth,
      endYear,
      groupBy,
    });

    await pool.end();

    return new Response(JSON.stringify({ trends }), {
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

/**
 * GET /api/v1/admin/organisations/:orgId/analytics/cost-breakdown
 * Get cost breakdown by metric
 */
export async function handleCostBreakdown(
  request: Request,
  env: Env,
  authContext: AuthContext
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const orgId = url.pathname.split('/')[4];

    // Check permissions
    if (!authContext.permissions.includes('read') && authContext.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check organisation access
    if (authContext.organisationId && authContext.organisationId !== orgId) {
      return new Response(
        JSON.stringify({ error: 'Access denied to this organisation' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse query parameters
    const params = url.searchParams;
    const projectId = params.get('projectId') || undefined;
    const startMonth = params.get('startMonth') ? parseInt(params.get('startMonth')!, 10) : undefined;
    const startYear = params.get('startYear') ? parseInt(params.get('startYear')!, 10) : undefined;
    const endMonth = params.get('endMonth') ? parseInt(params.get('endMonth')!, 10) : undefined;
    const endYear = params.get('endYear') ? parseInt(params.get('endYear')!, 10) : undefined;

    const pool = createRdsPool(env);
    const breakdown = await getCostBreakdown(pool, orgId, {
      projectId,
      startMonth,
      startYear,
      endMonth,
      endYear,
    });

    await pool.end();

    return new Response(JSON.stringify({ breakdown }), {
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

/**
 * GET /api/v1/admin/organisations/:orgId/analytics/realtime
 * Get real-time usage (last 24 hours)
 */
export async function handleRealTimeUsage(
  request: Request,
  env: Env,
  authContext: AuthContext
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const orgId = url.pathname.split('/')[4];

    // Check permissions
    if (!authContext.permissions.includes('read') && authContext.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check organisation access
    if (authContext.organisationId && authContext.organisationId !== orgId) {
      return new Response(
        JSON.stringify({ error: 'Access denied to this organisation' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse query parameters
    const params = url.searchParams;
    const projectId = params.get('projectId') || undefined;
    const metricName = params.get('metricName') || undefined;

    const pool = createRdsPool(env);
    const realtime = await getRealTimeUsage(pool, orgId, {
      projectId,
      metricName,
    });

    await pool.end();

    return new Response(JSON.stringify(realtime), {
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

/**
 * GET /api/v1/admin/projects/:projectId/analytics/summary
 * Get project-level usage summary
 */
export async function handleProjectUsageSummary(
  request: Request,
  env: Env,
  authContext: AuthContext
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[4]; // /api/v1/admin/projects/:projectId/analytics/summary

    // Check permissions
    if (!authContext.permissions.includes('read') && authContext.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Insufficient permissions' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get project to verify access
    const pool = createRdsPool(env);
    const projectResult = await pool.query<{ organisation_id: string }>(
      `SELECT organisation_id FROM projects WHERE id = $1`,
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      await pool.end();
      return new Response(
        JSON.stringify({ error: 'Project not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const organisationId = projectResult.rows[0].organisation_id;

    // Check organisation access
    if (authContext.organisationId && authContext.organisationId !== organisationId) {
      await pool.end();
      return new Response(
        JSON.stringify({ error: 'Access denied to this project' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse query parameters
    const params = url.searchParams;
    const startMonth = params.get('startMonth') ? parseInt(params.get('startMonth')!, 10) : undefined;
    const startYear = params.get('startYear') ? parseInt(params.get('startYear')!, 10) : undefined;
    const endMonth = params.get('endMonth') ? parseInt(params.get('endMonth')!, 10) : undefined;
    const endYear = params.get('endYear') ? parseInt(params.get('endYear')!, 10) : undefined;

    const summary = await getProjectUsageSummary(pool, organisationId, projectId, {
      startMonth,
      startYear,
      endMonth,
      endYear,
    });

    await pool.end();

    return new Response(JSON.stringify(summary), {
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
