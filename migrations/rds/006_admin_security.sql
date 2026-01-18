-- Admin Security Tables
-- Supports proper authentication, RBAC, and audit logging for admin endpoints

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'viewer', 'operator')),
    organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
    permissions JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_admin_users_role ON admin_users(role);
CREATE INDEX idx_admin_users_organisation_id ON admin_users(organisation_id);
CREATE INDEX idx_admin_users_is_active ON admin_users(is_active);

COMMENT ON TABLE admin_users IS 'Admin users with roles and permissions. Supports RBAC.';
COMMENT ON COLUMN admin_users.role IS 'admin: full access, operator: operational access, viewer: read-only';
COMMENT ON COLUMN admin_users.organisation_id IS 'NULL means can access all organisations, UUID means organisation-specific access';
COMMENT ON COLUMN admin_users.permissions IS 'JSON array of permission strings, e.g., ["read", "write", "admin"]';

-- Admin API keys table
CREATE TABLE IF NOT EXISTS admin_api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_api_keys_user_id ON admin_api_keys(user_id);
CREATE INDEX idx_admin_api_keys_key_hash ON admin_api_keys(key_hash);
CREATE INDEX idx_admin_api_keys_is_active ON admin_api_keys(is_active);
CREATE INDEX idx_admin_api_keys_expires_at ON admin_api_keys(expires_at) WHERE expires_at IS NOT NULL;

COMMENT ON TABLE admin_api_keys IS 'API keys for admin authentication. Keys are hashed before storage.';
COMMENT ON COLUMN admin_api_keys.key_hash IS 'SHA-256 hash of the API key. Never store plaintext keys.';
COMMENT ON COLUMN admin_api_keys.expires_at IS 'Optional expiration date. NULL means never expires.';

-- Admin action logs table (separate from audit_logs for admin-specific tracking)
CREATE TABLE IF NOT EXISTS admin_action_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    changes JSONB,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_action_logs_user_id ON admin_action_logs(user_id);
CREATE INDEX idx_admin_action_logs_email ON admin_action_logs(email);
CREATE INDEX idx_admin_action_logs_action ON admin_action_logs(action);
CREATE INDEX idx_admin_action_logs_created_at ON admin_action_logs(created_at DESC);
CREATE INDEX idx_admin_action_logs_organisation_id ON admin_action_logs(organisation_id);

COMMENT ON TABLE admin_action_logs IS 'Audit log for all admin actions. Separate from general audit_logs for admin-specific tracking.';

-- Trigger for updated_at
CREATE TRIGGER update_admin_users_updated_at 
    BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default admin user (for initial setup)
-- Password/API key should be set via environment variable ADMIN_API_KEY
-- This user can be disabled after creating proper admin users
INSERT INTO admin_users (id, email, role, permissions, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'admin@system',
    'admin',
    '["read", "write", "admin"]'::jsonb,
    true
)
ON CONFLICT (email) DO NOTHING;

COMMENT ON TABLE admin_action_logs IS 'Audit log for all admin actions. Tracks who did what, when, and from where.';
