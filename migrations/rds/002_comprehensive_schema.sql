-- Comprehensive PostgreSQL Schema for Multi-Tenant Usage-Based Billing System
-- Financial-grade schema with immutability, idempotency, and auditability

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search if needed

-- ============================================================================
-- CORE TENANT TABLES
-- ============================================================================

-- Organisations table
-- Multi-tenant root entity
CREATE TABLE organisations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE, -- URL-friendly identifier
    razorpay_customer_id VARCHAR(255) UNIQUE,
    billing_email VARCHAR(255),
    tax_id VARCHAR(100), -- GST/PAN number
    address JSONB, -- Structured address data
    metadata JSONB, -- Flexible key-value storage
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE -- Soft delete support
);

CREATE INDEX idx_organisations_slug ON organisations(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_organisations_razorpay_customer_id ON organisations(razorpay_customer_id) WHERE razorpay_customer_id IS NOT NULL;
CREATE INDEX idx_organisations_is_active ON organisations(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_organisations_deleted_at ON organisations(deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON TABLE organisations IS 'Root tenant entity. Supports soft deletes for auditability.';
COMMENT ON COLUMN organisations.slug IS 'URL-friendly unique identifier for the organisation';
COMMENT ON COLUMN organisations.deleted_at IS 'Soft delete timestamp. NULL means active, non-NULL means deleted.';

-- Projects table
-- Multiple projects per organisation
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL, -- Unique within organisation
    api_key_hash VARCHAR(255) NOT NULL UNIQUE, -- Hashed API key for authentication
    description TEXT,
    metadata JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(organisation_id, slug) -- Unique slug per organisation
);

CREATE INDEX idx_projects_organisation_id ON projects(organisation_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_api_key_hash ON projects(api_key_hash);
CREATE INDEX idx_projects_is_active ON projects(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_org_slug ON projects(organisation_id, slug) WHERE deleted_at IS NULL;

COMMENT ON TABLE projects IS 'Projects belong to organisations. Supports soft deletes.';
COMMENT ON COLUMN projects.api_key_hash IS 'Bcrypt/Argon2 hash of the API key. Never store plaintext keys.';
COMMENT ON COLUMN projects.slug IS 'Unique within organisation, used for URL-friendly identifiers';

-- ============================================================================
-- PRICING TABLES
-- ============================================================================

-- Pricing plans table
-- Supports future pricing with effective date ranges
CREATE TABLE pricing_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    metric_name VARCHAR(100) NOT NULL, -- e.g., 'api_calls', 'storage_gb'
    unit VARCHAR(50) NOT NULL, -- e.g., 'count', 'gb', 'hours'
    price_per_unit NUMERIC(20, 8) NOT NULL CHECK (price_per_unit >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    billing_period VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly', 'yearly', 'one-time')),
    effective_from TIMESTAMP WITH TIME ZONE NOT NULL,
    effective_to TIMESTAMP WITH TIME ZONE, -- NULL means active indefinitely
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB, -- For tiered pricing, volume discounts, etc.
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Ensure no overlapping active plans for same metric/unit
    EXCLUDE USING gist (
        metric_name WITH =,
        unit WITH =,
        tstzrange(effective_from, COALESCE(effective_to, 'infinity')) WITH &&
    ) WHERE (is_active = true)
);

CREATE INDEX idx_pricing_plans_metric_name ON pricing_plans(metric_name);
CREATE INDEX idx_pricing_plans_effective_dates ON pricing_plans(effective_from, effective_to);
CREATE INDEX idx_pricing_plans_is_active ON pricing_plans(is_active);
CREATE INDEX idx_pricing_plans_metric_unit ON pricing_plans(metric_name, unit, is_active);

COMMENT ON TABLE pricing_plans IS 'Pricing plans with effective date ranges. Supports future pricing changes.';
COMMENT ON COLUMN pricing_plans.effective_to IS 'NULL means plan is active indefinitely. Used for future pricing.';
COMMENT ON COLUMN pricing_plans.metadata IS 'Stores tiered pricing, volume discounts, or other complex pricing rules';

-- ============================================================================
-- USAGE EVENT TABLES
-- ============================================================================

-- Usage events table
-- Idempotent event storage with deduplication
CREATE TABLE usage_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE, -- Ensures idempotency
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC(20, 8) NOT NULL CHECK (metric_value >= 0),
    unit VARCHAR(50) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    metadata JSONB, -- Additional event context
    ingested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE -- When aggregated
);

CREATE UNIQUE INDEX idx_usage_events_idempotency_key ON usage_events(idempotency_key);
CREATE INDEX idx_usage_events_organisation_id ON usage_events(organisation_id);
CREATE INDEX idx_usage_events_project_id ON usage_events(project_id);
CREATE INDEX idx_usage_events_timestamp ON usage_events(timestamp);
CREATE INDEX idx_usage_events_metric_name ON usage_events(metric_name);
CREATE INDEX idx_usage_events_unprocessed ON usage_events(processed_at) WHERE processed_at IS NULL;
CREATE INDEX idx_usage_events_org_project_metric ON usage_events(organisation_id, project_id, metric_name, timestamp);

COMMENT ON TABLE usage_events IS 'Raw usage events. Idempotent via idempotency_key unique constraint.';
COMMENT ON COLUMN usage_events.idempotency_key IS 'Client-provided unique key. Duplicate keys are rejected.';
COMMENT ON COLUMN usage_events.processed_at IS 'Timestamp when event was aggregated. NULL means unprocessed.';

-- Usage aggregates table
-- Monthly aggregations for billing
CREATE TABLE usage_aggregates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    metric_name VARCHAR(100) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    total_value NUMERIC(20, 8) NOT NULL CHECK (total_value >= 0),
    event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    year INTEGER NOT NULL CHECK (year >= 2020),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- One aggregate per org/project/metric/month/year
    UNIQUE(organisation_id, project_id, metric_name, month, year)
);

CREATE INDEX idx_usage_aggregates_organisation_id ON usage_aggregates(organisation_id);
CREATE INDEX idx_usage_aggregates_project_id ON usage_aggregates(project_id);
CREATE INDEX idx_usage_aggregates_month_year ON usage_aggregates(year, month);
CREATE INDEX idx_usage_aggregates_unique ON usage_aggregates(organisation_id, project_id, metric_name, month, year);

COMMENT ON TABLE usage_aggregates IS 'Monthly usage aggregations. Used for invoice generation.';
COMMENT ON COLUMN usage_aggregates.event_count IS 'Number of events aggregated. Useful for validation.';

-- ============================================================================
-- INVOICE TABLES (IMMUTABLE AFTER FINALIZATION)
-- ============================================================================

-- Invoices table
-- Immutable after status changes to 'finalized' or 'paid'
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
    invoice_number VARCHAR(50) NOT NULL UNIQUE, -- Human-readable invoice number
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'sent', 'paid', 'overdue', 'cancelled', 'void')),
    subtotal NUMERIC(20, 2) NOT NULL CHECK (subtotal >= 0),
    tax_amount NUMERIC(20, 2) NOT NULL CHECK (tax_amount >= 0),
    discount_amount NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total NUMERIC(20, 2) NOT NULL CHECK (total >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,
    due_date DATE NOT NULL,
    issued_at TIMESTAMP WITH TIME ZONE,
    finalized_at TIMESTAMP WITH TIME ZONE, -- When invoice becomes immutable
    sent_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Ensure total = subtotal + tax_amount - discount_amount
    CHECK (total = subtotal + tax_amount - discount_amount),
    -- Ensure billing period is valid
    CHECK (billing_period_end >= billing_period_start)
);

CREATE INDEX idx_invoices_organisation_id ON invoices(organisation_id);
CREATE INDEX idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_billing_period ON invoices(billing_period_start, billing_period_end);
CREATE INDEX idx_invoices_due_date ON invoices(due_date) WHERE status NOT IN ('paid', 'cancelled', 'void');
CREATE INDEX idx_invoices_finalized_at ON invoices(finalized_at) WHERE finalized_at IS NOT NULL;

COMMENT ON TABLE invoices IS 'Invoices become immutable after finalized_at is set. Status changes tracked via audit_logs.';
COMMENT ON COLUMN invoices.status IS 'draft -> finalized -> sent -> paid. Once finalized, invoice is immutable.';
COMMENT ON COLUMN invoices.finalized_at IS 'Timestamp when invoice becomes immutable. NULL means draft.';
COMMENT ON COLUMN invoices.metadata IS 'Stores additional invoice context (payment terms, etc.)';

-- Invoice line items table
-- Immutable once invoice is finalized
CREATE TABLE invoice_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    line_number INTEGER NOT NULL CHECK (line_number >= 1),
    description TEXT NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    quantity NUMERIC(20, 8) NOT NULL CHECK (quantity >= 0),
    unit VARCHAR(50) NOT NULL,
    unit_price NUMERIC(20, 8) NOT NULL CHECK (unit_price >= 0),
    total NUMERIC(20, 2) NOT NULL CHECK (total >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    metadata JSONB, -- Links to usage aggregates, pricing plan used, etc.
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Ensure total = quantity * unit_price (rounded)
    CHECK (ABS(total - (quantity * unit_price)) < 0.01),
    -- Unique line numbers per invoice
    UNIQUE(invoice_id, line_number)
);

CREATE INDEX idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);
CREATE INDEX idx_invoice_line_items_project_id ON invoice_line_items(project_id);
CREATE INDEX idx_invoice_line_items_metric_name ON invoice_line_items(metric_name);

COMMENT ON TABLE invoice_line_items IS 'Line items are immutable once parent invoice is finalized.';
COMMENT ON COLUMN invoice_line_items.metadata IS 'Stores pricing plan ID, usage aggregate ID, etc. for auditability';

-- ============================================================================
-- PAYMENT TABLES (FULLY AUDITABLE)
-- ============================================================================

-- Payments table
-- Fully auditable payment records
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    payment_number VARCHAR(50) NOT NULL UNIQUE, -- Human-readable payment number
    razorpay_payment_id VARCHAR(255) UNIQUE, -- External payment gateway ID
    razorpay_order_id VARCHAR(255),
    amount NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded', 'cancelled')),
    payment_method VARCHAR(100), -- 'card', 'upi', 'netbanking', etc.
    payment_gateway VARCHAR(50) NOT NULL DEFAULT 'razorpay',
    paid_at TIMESTAMP WITH TIME ZONE,
    reconciled_at TIMESTAMP WITH TIME ZONE, -- When payment verified via webhook
    failure_reason TEXT,
    refund_amount NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
    refunded_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB, -- Gateway response, webhook payload, etc.
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Ensure refund doesn't exceed amount
    CHECK (refund_amount <= amount)
);

CREATE INDEX idx_payments_organisation_id ON payments(organisation_id);
CREATE INDEX idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX idx_payments_payment_number ON payments(payment_number);
CREATE INDEX idx_payments_razorpay_payment_id ON payments(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_reconciled_at ON payments(reconciled_at) WHERE reconciled_at IS NULL;
CREATE INDEX idx_payments_paid_at ON payments(paid_at) WHERE paid_at IS NOT NULL;

COMMENT ON TABLE payments IS 'Fully auditable payment records. All status changes tracked via audit_logs.';
COMMENT ON COLUMN payments.reconciled_at IS 'Timestamp when payment verified via webhook. NULL means unreconciled.';
COMMENT ON COLUMN payments.metadata IS 'Stores complete gateway response and webhook payload for audit trail';

-- Payment allocations table
-- Tracks how payments are allocated to invoices (for partial payments, credits, etc.)
CREATE TABLE payment_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    allocated_amount NUMERIC(20, 2) NOT NULL CHECK (allocated_amount > 0),
    allocated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Ensure allocations don't exceed payment amount
    UNIQUE(payment_id, invoice_id)
);

CREATE INDEX idx_payment_allocations_payment_id ON payment_allocations(payment_id);
CREATE INDEX idx_payment_allocations_invoice_id ON payment_allocations(invoice_id);

COMMENT ON TABLE payment_allocations IS 'Tracks payment-to-invoice allocations. Supports partial payments and credits.';

-- ============================================================================
-- IDEMPOTENCY TABLE
-- ============================================================================

-- Idempotency keys table
-- Ensures operations are idempotent across the system
CREATE TABLE idempotency_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    entity_type VARCHAR(100) NOT NULL, -- 'usage_event', 'payment', 'invoice', etc.
    entity_id UUID NOT NULL,
    request_hash VARCHAR(64), -- SHA-256 hash of request payload for validation
    response_status INTEGER,
    response_body JSONB,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL, -- Cleanup old keys
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_idempotency_keys_key ON idempotency_keys(idempotency_key);
CREATE INDEX idx_idempotency_keys_entity ON idempotency_keys(entity_type, entity_id);
CREATE INDEX idx_idempotency_keys_expires_at ON idempotency_keys(expires_at) WHERE expires_at < NOW();

COMMENT ON TABLE idempotency_keys IS 'Tracks idempotent operations. Prevents duplicate processing.';
COMMENT ON COLUMN idempotency_keys.request_hash IS 'Hash of request payload to detect request changes with same key';
COMMENT ON COLUMN idempotency_keys.expires_at IS 'Keys expire after 30 days. Old keys can be cleaned up.';

-- ============================================================================
-- AUDIT TABLES
-- ============================================================================

-- Audit logs table
-- Complete audit trail for financial operations
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
    entity_type VARCHAR(100) NOT NULL, -- 'invoice', 'payment', 'usage_event', etc.
    entity_id UUID NOT NULL,
    action VARCHAR(100) NOT NULL, -- 'created', 'updated', 'finalized', 'paid', etc.
    actor_type VARCHAR(50) NOT NULL DEFAULT 'system', -- 'user', 'system', 'webhook', 'cron'
    actor_id VARCHAR(255), -- User ID, webhook ID, etc.
    changes JSONB, -- Before/after state for updates
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(255), -- For tracing requests across services
    metadata JSONB, -- Additional context
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_organisation_id ON audit_logs(organisation_id) WHERE organisation_id IS NOT NULL;
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_type, actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_logs_request_id ON audit_logs(request_id) WHERE request_id IS NOT NULL;

COMMENT ON TABLE audit_logs IS 'Complete audit trail. Immutable. Required for financial compliance.';
COMMENT ON COLUMN audit_logs.changes IS 'JSONB with before/after state for update operations';
COMMENT ON COLUMN audit_logs.request_id IS 'Correlation ID for tracing requests across services';

-- ============================================================================
-- TRIGGERS FOR IMMUTABILITY AND AUDITABILITY
-- ============================================================================

-- Function to prevent updates to finalized invoices
CREATE OR REPLACE FUNCTION prevent_finalized_invoice_updates()
RETURNS TRIGGER AS $$
BEGIN
    -- If invoice is finalized, only allow status changes to 'paid', 'cancelled', 'void'
    IF OLD.finalized_at IS NOT NULL THEN
        IF NEW.status != OLD.status AND NEW.status NOT IN ('paid', 'cancelled', 'void') THEN
            RAISE EXCEPTION 'Cannot modify finalized invoice. Only status changes to paid/cancelled/void are allowed.';
        END IF;
        
        -- Prevent changes to financial fields
        IF NEW.subtotal != OLD.subtotal OR 
           NEW.tax_amount != OLD.tax_amount OR 
           NEW.discount_amount != OLD.discount_amount OR 
           NEW.total != OLD.total THEN
            RAISE EXCEPTION 'Cannot modify financial fields of finalized invoice';
        END IF;
        
        -- Prevent changes to billing period
        IF NEW.billing_period_start != OLD.billing_period_start OR 
           NEW.billing_period_end != OLD.billing_period_end THEN
            RAISE EXCEPTION 'Cannot modify billing period of finalized invoice';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_finalized_invoice_updates_trigger
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION prevent_finalized_invoice_updates();

-- Function to prevent updates to invoice line items of finalized invoices
CREATE OR REPLACE FUNCTION prevent_finalized_invoice_line_item_updates()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM invoices 
        WHERE id = NEW.invoice_id 
        AND finalized_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Cannot modify line items of finalized invoice';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_finalized_invoice_line_item_updates_trigger
    BEFORE UPDATE ON invoice_line_items
    FOR EACH ROW
    EXECUTE FUNCTION prevent_finalized_invoice_line_item_updates();

CREATE TRIGGER prevent_finalized_invoice_line_item_deletes_trigger
    BEFORE DELETE ON invoice_line_items
    FOR EACH ROW
    EXECUTE FUNCTION prevent_finalized_invoice_line_item_updates();

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to relevant tables
CREATE TRIGGER update_organisations_updated_at BEFORE UPDATE ON organisations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pricing_plans_updated_at BEFORE UPDATE ON pricing_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_usage_aggregates_updated_at BEFORE UPDATE ON usage_aggregates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- View for invoice summary with payment status
CREATE VIEW invoice_summary AS
SELECT 
    i.id,
    i.organisation_id,
    i.invoice_number,
    i.status,
    i.subtotal,
    i.tax_amount,
    i.discount_amount,
    i.total,
    i.currency,
    i.billing_period_start,
    i.billing_period_end,
    i.due_date,
    i.finalized_at,
    i.paid_at,
    COALESCE(SUM(p.amount), 0) AS total_paid,
    COALESCE(SUM(p.refund_amount), 0) AS total_refunded,
    i.total - COALESCE(SUM(p.amount), 0) + COALESCE(SUM(p.refund_amount), 0) AS amount_due,
    COUNT(DISTINCT p.id) AS payment_count
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id AND p.status IN ('captured', 'refunded', 'partially_refunded')
WHERE i.status NOT IN ('cancelled', 'void')
GROUP BY i.id;

COMMENT ON VIEW invoice_summary IS 'Invoice summary with payment totals. Useful for reporting.';

-- View for organisation usage summary
CREATE VIEW organisation_usage_summary AS
SELECT 
    o.id AS organisation_id,
    o.name AS organisation_name,
    ua.metric_name,
    ua.unit,
    ua.year,
    ua.month,
    SUM(ua.total_value) AS total_usage,
    SUM(ua.event_count) AS total_events,
    COUNT(DISTINCT ua.project_id) AS project_count
FROM organisations o
JOIN usage_aggregates ua ON ua.organisation_id = o.id
WHERE o.deleted_at IS NULL
GROUP BY o.id, o.name, ua.metric_name, ua.unit, ua.year, ua.month;

COMMENT ON VIEW organisation_usage_summary IS 'Monthly usage summary per organisation. Useful for analytics.';

-- ============================================================================
-- TABLE JUSTIFICATIONS
-- ============================================================================

/*
ORGANISATIONS
- Root tenant entity for multi-tenancy
- Soft deletes (deleted_at) preserve audit trail
- Unique slug for URL-friendly identifiers
- Razorpay customer ID for payment integration

PROJECTS
- Multiple projects per organisation
- API key hash for authentication (never store plaintext)
- Unique slug per organisation for URL-friendly identifiers
- Soft deletes preserve audit trail

PRICING_PLANS
- Supports future pricing with effective date ranges
- Exclusion constraint prevents overlapping active plans
- Metadata field supports complex pricing (tiers, volume discounts)
- Billing period support (monthly, yearly, one-time)

USAGE_EVENTS
- Idempotent via unique idempotency_key constraint
- Processed_at tracks aggregation status
- Indexes optimized for time-range queries
- Metadata for flexible event context

USAGE_AGGREGATES
- Monthly aggregations for invoice generation
- Unique constraint ensures one aggregate per org/project/metric/month/year
- Event count for validation
- Indexed for efficient invoice generation queries

INVOICES
- Immutable after finalized_at is set (enforced by trigger)
- Status transitions: draft -> finalized -> sent -> paid
- Financial fields validated via CHECK constraints
- Metadata for flexible invoice context

INVOICE_LINE_ITEMS
- Immutable once parent invoice is finalized (enforced by trigger)
- Links to projects and usage aggregates via metadata
- Line numbers ensure ordering
- Total validated against quantity * unit_price

PAYMENTS
- Fully auditable with complete gateway response in metadata
- Reconciliation timestamp tracks webhook verification
- Supports partial refunds
- Status transitions tracked via audit_logs

PAYMENT_ALLOCATIONS
- Tracks payment-to-invoice allocations
- Supports partial payments and credits
- Useful for complex payment scenarios

IDEMPOTENCY_KEYS
- Ensures operations are idempotent across the system
- Request hash validates request consistency
- Expires for cleanup
- Stores response for idempotent retries

AUDIT_LOGS
- Complete audit trail for financial compliance
- Immutable (no UPDATE/DELETE allowed)
- Tracks who, what, when, why
- Request ID for distributed tracing
*/
