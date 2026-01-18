import pg from 'pg';
import { queryRds } from '../db/rds.js';
import { Project } from '../types/domain.js';
import { NotFoundError } from '../utils/errors.js';
import { randomBytesHex } from '../utils/crypto.js';

/**
 * Project repository
 */

export async function getProjectById(
  pool: pg.Pool,
  id: string
): Promise<Project | null> {
  const result = await queryRds<Project>(
    pool,
    `SELECT 
      id, organisation_id, name, api_key, is_active, created_at, updated_at
    FROM projects
    WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    apiKey: row.api_key,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getProjectByApiKey(
  pool: pg.Pool,
  apiKey: string
): Promise<Project | null> {
  const result = await queryRds<Project>(
    pool,
    `SELECT 
      id, organisation_id, name, api_key, is_active, created_at, updated_at
    FROM projects
    WHERE api_key = $1 AND is_active = true`,
    [apiKey]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    apiKey: row.api_key,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getProjectsByOrganisation(
  pool: pg.Pool,
  organisationId: string
): Promise<Project[]> {
  const result = await queryRds<Project>(
    pool,
    `SELECT 
      id, organisation_id, name, api_key, is_active, created_at, updated_at
    FROM projects
    WHERE organisation_id = $1
    ORDER BY created_at DESC`,
    [organisationId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    apiKey: row.api_key,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createProject(
  pool: pg.Pool,
  organisationId: string,
  name: string
): Promise<Project> {
  // Generate a secure API key
  const randomHex = await randomBytesHex(32);
  const apiKey = `sk_${randomHex}`;

  const result = await queryRds<Project>(
    pool,
    `INSERT INTO projects (organisation_id, name, api_key)
     VALUES ($1, $2, $3)
     RETURNING id, organisation_id, name, api_key, is_active, created_at, updated_at`,
    [organisationId, name, apiKey]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    apiKey: row.api_key,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
