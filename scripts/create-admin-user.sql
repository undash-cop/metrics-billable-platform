-- Script to create admin user and API key
-- Usage: psql $DATABASE_URL -f scripts/create-admin-user.sql

-- Set variables (modify these)
\set email 'admin@example.com'
\set role 'admin'
\set api_key_name 'Production API Key'

-- Create admin user
INSERT INTO admin_users (email, role, permissions, organisation_id, is_active)
VALUES (
  :'email',
  :'role',
  '["read", "write", "admin"]'::jsonb,
  NULL,  -- NULL = can access all organisations
  true
)
ON CONFLICT (email) DO UPDATE
SET role = EXCLUDED.role,
    permissions = EXCLUDED.permissions,
    is_active = EXCLUDED.is_active
RETURNING id, email, role;

-- Note: You need to hash the API key before inserting
-- Use: echo -n "your-api-key" | sha256sum
-- Or use your application's hashing function

-- Example: Create API key (replace 'hashed-key-here' with actual hash)
/*
INSERT INTO admin_api_keys (user_id, key_hash, name, expires_at, is_active)
SELECT 
  id,
  'hashed-api-key-here',  -- Replace with SHA-256 hash of your API key
  :'api_key_name',
  NULL,  -- NULL = never expires
  true
FROM admin_users
WHERE email = :'email'
RETURNING id, user_id, name, created_at;
*/

-- View created user
SELECT 
  u.id,
  u.email,
  u.role,
  u.permissions,
  u.is_active,
  COUNT(k.id) as api_key_count
FROM admin_users u
LEFT JOIN admin_api_keys k ON u.id = k.user_id AND k.is_active = true
WHERE u.email = :'email'
GROUP BY u.id, u.email, u.role, u.permissions, u.is_active;
