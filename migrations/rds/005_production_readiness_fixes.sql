-- Production Readiness Fixes (P0 - Critical)
-- Addresses critical risks identified in production readiness review

-- ============================================================================
-- 1. PREVENT DUPLICATE INVOICE GENERATION
-- ============================================================================

-- Add month and year columns to invoices if they don't exist
-- These are needed for the unique constraint and invoice lookup
DO $$
BEGIN
    -- Add month column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' 
        AND column_name = 'month'
    ) THEN
        ALTER TABLE invoices 
        ADD COLUMN month INTEGER CHECK (month >= 1 AND month <= 12);
        
        -- Populate month from billing_period_start for existing records
        UPDATE invoices 
        SET month = EXTRACT(MONTH FROM billing_period_start)
        WHERE month IS NULL;
        
        -- Make it NOT NULL after populating
        ALTER TABLE invoices 
        ALTER COLUMN month SET NOT NULL;
        
        COMMENT ON COLUMN invoices.month IS 'Billing month (1-12). Used for duplicate prevention.';
    END IF;
    
    -- Add year column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' 
        AND column_name = 'year'
    ) THEN
        ALTER TABLE invoices 
        ADD COLUMN year INTEGER CHECK (year >= 2020);
        
        -- Populate year from billing_period_start for existing records
        UPDATE invoices 
        SET year = EXTRACT(YEAR FROM billing_period_start)
        WHERE year IS NULL;
        
        -- Make it NOT NULL after populating
        ALTER TABLE invoices 
        ALTER COLUMN year SET NOT NULL;
        
        COMMENT ON COLUMN invoices.year IS 'Billing year. Used for duplicate prevention.';
    END IF;
END $$;

-- Add unique constraint to prevent duplicate invoices per organisation/month/year
-- Only applies to non-cancelled invoices
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_org_month_year_unique 
ON invoices(organisation_id, month, year) 
WHERE status != 'cancelled';

COMMENT ON INDEX idx_invoices_org_month_year_unique IS 
'Prevents duplicate invoice generation for same organisation/month/year. Critical for preventing double billing.';

-- Add index for efficient invoice lookup by month/year
CREATE INDEX IF NOT EXISTS idx_invoices_month_year 
ON invoices(year, month);

-- ============================================================================
-- 2. ADD IDEMPOTENCY SUPPORT FOR INVOICE GENERATION
-- ============================================================================

-- The idempotency_keys table already exists, but we'll ensure it's properly configured
-- Invoice generation should use idempotency key: invoice_{orgId}_{year}_{month}

-- ============================================================================
-- 3. ADD RECONCILIATION TRACKING FOR D1 TO RDS MIGRATION
-- ============================================================================

-- Add reconciliation metadata table to track migration status
CREATE TABLE IF NOT EXISTS d1_rds_reconciliation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    metric_name VARCHAR(100) NOT NULL,
    reconciliation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    d1_event_count INTEGER NOT NULL DEFAULT 0,
    rds_event_count INTEGER NOT NULL DEFAULT 0,
    discrepancy_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reconciled', 'discrepancy', 'error')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(organisation_id, project_id, metric_name, reconciliation_date)
);

CREATE INDEX idx_d1_rds_reconciliation_org_date 
ON d1_rds_reconciliation(organisation_id, reconciliation_date);

CREATE INDEX idx_d1_rds_reconciliation_status 
ON d1_rds_reconciliation(status) 
WHERE status IN ('discrepancy', 'error');

COMMENT ON TABLE d1_rds_reconciliation IS 
'Tracks reconciliation between D1 and RDS event counts. Used to detect data loss.';

-- ============================================================================
-- 4. ADD RECONCILIATION TRACKING FOR RAZORPAY PAYMENTS
-- ============================================================================

-- Add reconciliation metadata table for payments
CREATE TABLE IF NOT EXISTS payment_reconciliation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
    reconciliation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    razorpay_order_count INTEGER NOT NULL DEFAULT 0,
    our_payment_count INTEGER NOT NULL DEFAULT 0,
    unreconciled_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reconciled', 'discrepancy', 'error')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(organisation_id, reconciliation_date)
);

CREATE INDEX idx_payment_reconciliation_org_date 
ON payment_reconciliation(organisation_id, reconciliation_date);

CREATE INDEX idx_payment_reconciliation_status 
ON payment_reconciliation(status) 
WHERE status IN ('discrepancy', 'error');

COMMENT ON TABLE payment_reconciliation IS 
'Tracks reconciliation between Razorpay orders and our payment records. Used to detect missing payments.';

-- Add view for unreconciled payments (payments without razorpay_payment_id)
CREATE OR REPLACE VIEW unreconciled_payments AS
SELECT 
    p.id,
    p.organisation_id,
    p.invoice_id,
    p.payment_number,
    p.razorpay_order_id,
    p.amount,
    p.currency,
    p.status,
    p.created_at,
    p.updated_at,
    i.invoice_number,
    o.name AS organisation_name
FROM payments p
JOIN invoices i ON p.invoice_id = i.id
JOIN organisations o ON p.organisation_id = o.id
WHERE p.razorpay_payment_id IS NULL
  AND p.status != 'cancelled'
  AND p.created_at > NOW() - INTERVAL '30 days' -- Only recent payments
ORDER BY p.created_at DESC;

COMMENT ON VIEW unreconciled_payments IS 
'Payments that have not been reconciled via Razorpay webhook. Requires manual review.';

-- ============================================================================
-- 5. ADD ALERTING METADATA TABLE
-- ============================================================================

-- Table to track alert thresholds and alert history
CREATE TABLE IF NOT EXISTS alert_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_type VARCHAR(100) NOT NULL, -- e.g., 'migration_failure', 'duplicate_invoice', 'webhook_failure'
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    metadata JSONB,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_history_type_severity 
ON alert_history(alert_type, severity);

CREATE INDEX idx_alert_history_unresolved 
ON alert_history(resolved_at) 
WHERE resolved_at IS NULL;

CREATE INDEX idx_alert_history_created_at 
ON alert_history(created_at DESC);

COMMENT ON TABLE alert_history IS 
'Stores alert history for monitoring and debugging. Critical alerts should trigger notifications.';

-- ============================================================================
-- 6. ADD TRIGGERS FOR UPDATED_AT
-- ============================================================================

-- Create function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for new tables
CREATE TRIGGER update_d1_rds_reconciliation_updated_at 
    BEFORE UPDATE ON d1_rds_reconciliation
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_reconciliation_updated_at 
    BEFORE UPDATE ON payment_reconciliation
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
