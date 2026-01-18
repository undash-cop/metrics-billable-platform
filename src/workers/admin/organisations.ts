import { Env } from '../../types/env.js';
import { createRdsPool } from '../../db/rds.js';
import { createOrganisation } from '../../repositories/organisation.js';
import {
  CreateOrganisationRequestSchema,
  OrganisationResponseSchema,
  type OrganisationResponse,
} from '../../types/api.js';
import { formatError, ValidationError } from '../../utils/errors.js';
import { AdminAuthContext } from '../../services/admin-auth.js';
import { checkPermission } from '../../services/admin-auth.js';
import { logAdminAction } from '../../middleware/admin-audit.js';

/**
 * Admin API: Create Organisation
 * 
 * POST /api/v1/admin/organisations
 * 
 * Creates a new organisation.
 * Requires admin authentication and 'write' permission.
 */

export async function handleCreateOrganisation(
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

    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      throw new ValidationError('Invalid JSON in request body');
    }

    const validationResult = CreateOrganisationRequestSchema.safeParse(body);
    if (!validationResult.success) {
      throw new ValidationError('Invalid request body', {
        errors: validationResult.error.errors,
      });
    }

    const createRequest = validationResult.data;

    // Create organisation
    const rdsPool = createRdsPool(env);
    const organisation = await createOrganisation(
      rdsPool,
      createRequest.name,
      {
        razorpayCustomerId: createRequest.razorpayCustomerId,
        currency: createRequest.currency,
      }
    );

    // Log admin action
    await logAdminAction(env, authContext, {
      action: 'create_organisation',
      entityType: 'organisation',
      entityId: organisation.id,
      organisationId: organisation.id,
      changes: {
        name: organisation.name,
        razorpayCustomerId: organisation.razorpayCustomerId,
      },
    });

    // Format response
    const response: OrganisationResponse = {
      id: organisation.id,
      name: organisation.name,
      razorpayCustomerId: organisation.razorpayCustomerId || null,
      billingEmail: null, // Not in current schema
      taxId: null, // Not in current schema
      currency: organisation.currency || null,
      createdAt: organisation.createdAt.toISOString(),
      updatedAt: organisation.updatedAt.toISOString(),
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
