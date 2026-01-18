#!/usr/bin/env node

/**
 * RDS Postgres migration script
 * Run this to apply database migrations to RDS
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrate() {
  const pool = new Pool({
    host: process.env.RDS_HOST,
    port: parseInt(process.env.RDS_PORT || '5432', 10),
    database: process.env.RDS_DATABASE,
    user: process.env.RDS_USER,
    password: process.env.RDS_PASSWORD,
    ssl: process.env.RDS_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    // Read migration file
    const migrationPath = join(__dirname, '../migrations/rds/001_initial_schema.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    console.log('Applying RDS migration...');
    await pool.query(migrationSQL);
    console.log('Migration applied successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
