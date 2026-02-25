-- Comprehensive PostgreSQL Schema for Multi-Tenant Usage-Based Billing System
-- Financial-grade schema with immutability, idempotency, and auditability

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search if needed
CREATE EXTENSION IF NOT EXISTS "btree_gist"; -- For range queries

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
