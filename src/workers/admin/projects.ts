import { Env } from '../../types/env.js';
import { createRdsPool } from '../../db/rds.js';
import { createProject, getProjectsByOrganisation } from '../../repositories/project.js';
import {
  CreateProjectRequestSchema,
  ProjectResponseSchema,
  ProjectListResponseSchema,
  GenerateApiKeyRequestSchema,
  GenerateApiKeyResponseSchema,
  type ProjectResponse,
  type ProjectListResponse,
  type GenerateApiKeyResponse,
} from '../../types/api.js';
import { formatError, ValidationError, NotFoundError } from '../../utils/errors.js';
import { AdminAuthContext } from '../../services/admin-auth.js';
import { checkPermission, checkOrganisationAccess } from '../../services/admin-auth.js';
import { logAdminAction } from '../../middleware/admin-audit.js';
import { randomBytesHex } from '../../utils/crypto.js';
import { queryRds, transaction } from '../../db/rds.js';

/**
 * Admin API: Create Project
 * 
 * POST /api/v1/admin/organisations/:organisationId/projects
 * 
 * Creates a new project for an organisation.
 * Requires organisation access.
 */

export async function handleCreateProject(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Check permission
    checkPermission(authContext, 'write');

    // Extract organisation ID from path
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/organisations\/([^/]+)\/projects/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: organisationId required in path');
    }

    const organisationId = pathMatch[1];
    checkOrganisationAccess(authContext, organisationId);

    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      throw new ValidationError('Invalid JSON in request body');
    }

    const validationResult = CreateProjectRequestSchema.safeParse({
      ...body,
      organisationId,
    });

    if (!validationResult.success) {
      throw new ValidationError('Invalid request body', {
        errors: validationResult.error.errors,
      });
    }

    const createRequest = validationResult.data;

    // Create project
    const rdsPool = createRdsPool(env);
    const project = await createProject(
      rdsPool,
      createRequest.organisationId,
      createRequest.name
    );

    // Log admin action
    await logAdminAction(env, authContext, {
      action: 'create_project',
      entityType: 'project',
      entityId: project.id,
      organisationId: project.organisationId,
      changes: {
        name: project.name,
      },
    });

    // Format response (include API key on creation)
    const response: ProjectResponse = {
      id: project.id,
      organisationId: project.organisationId,
      name: project.name,
      description: null, // Not in current schema
      apiKey: project.apiKey, // Only returned on creation
      isActive: project.isActive,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };

    return new Response(JSON.stringify(response), {
      status: 201,
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
 * Admin API: List Projects
 * 
 * GET /api/v1/admin/organisations/:organisationId/projects
 */

export async function handleListProjects(
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
    const pathMatch = url.pathname.match(/\/organisations\/([^/]+)\/projects/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: organisationId required in path');
    }

    const organisationId = pathMatch[1];
    checkOrganisationAccess(authContext, organisationId);

    // Get projects
    const rdsPool = createRdsPool(env);
    const projects = await getProjectsByOrganisation(rdsPool, organisationId);

    // Format response (exclude API keys)
    const response: ProjectListResponse[] = projects.map((project) => ({
      id: project.id,
      organisationId: project.organisationId,
      name: project.name,
      description: null,
      isActive: project.isActive,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    }));

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

/**
 * Admin API: Generate API Key
 * 
 * POST /api/v1/admin/projects/:projectId/api-keys
 * 
 * Generates a new API key for a project.
 * Invalidates old API key.
 */

export async function handleGenerateApiKey(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Check permission
    checkPermission(authContext, 'write');

    const url = new URL(request.url);

    // Extract project ID from path
    const pathMatch = url.pathname.match(/\/projects\/([^/]+)\/api-keys/);
    if (!pathMatch || !pathMatch[1]) {
      throw new ValidationError('Invalid URL: projectId required in path');
    }

    const projectId = pathMatch[1];

    // Get project to verify organisation access
    const rdsPool = createRdsPool(env);
    const project = await queryRds<{ organisation_id: string }>(
      rdsPool,
      `SELECT organisation_id FROM projects WHERE id = $1`,
      [projectId]
    );

    if (project.rows.length === 0) {
      throw new NotFoundError(`Project not found: ${projectId}`);
    }

    checkOrganisationAccess(authContext, project.rows[0].organisation_id);

    // Generate new API key
    const newApiKey = await transaction(rdsPool, async (client) => {
      const randomHex = await randomBytesHex(32);
      const apiKey = `sk_${randomHex}`;

      await client.query(
        `UPDATE projects SET api_key = $1, updated_at = NOW() WHERE id = $2`,
        [apiKey, projectId]
      );

      return apiKey;
    });

    // Log admin action
    await logAdminAction(env, authContext, {
      action: 'generate_api_key',
      entityType: 'project',
      entityId: projectId,
      organisationId: project.rows[0].organisation_id,
      changes: {
        projectId,
      },
    });

    const response: GenerateApiKeyResponse = {
      projectId,
      apiKey: newApiKey,
      message: 'API key generated successfully. Old key is now invalid.',
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
