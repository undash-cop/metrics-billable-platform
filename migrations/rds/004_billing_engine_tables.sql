-- Billing Engine Tables
-- Supports config-driven pricing rules and minimum charges

-- Minimum charge rules table
-- Supports organisation-specific or global minimum charges
CREATE TABLE IF NOT EXISTS minimum_charge_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
    minimum_amount NUMERIC(20, 2) NOT NULL CHECK (minimum_amount >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    effective_from TIMESTAMP WITH TIME ZONE NOT NULL,
    effective_to TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_minimum_charge_rules_organisation_id ON minimum_charge_rules(organisation_id);
CREATE INDEX idx_minimum_charge_rules_effective_dates ON minimum_charge_rules(effective_from, effective_to);
CREATE INDEX idx_minimum_charge_rules_is_active ON minimum_charge_rules(is_active);

COMMENT ON TABLE minimum_charge_rules IS 'Minimum monthly charge rules. NULL organisation_id = global rule.';
COMMENT ON COLUMN minimum_charge_rules.organisation_id IS 'NULL means global rule, UUID means organisation-specific';

-- Billing configurations table
-- Per-organisation billing settings
CREATE TABLE IF NOT EXISTS billing_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL UNIQUE REFERENCES organisations(id) ON DELETE CASCADE,
    tax_rate NUMERIC(5, 4) NOT NULL CHECK (tax_rate >= 0 AND tax_rate <= 1), -- e.g., 0.18 for 18%
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
    payment_terms INTEGER NOT NULL DEFAULT 30 CHECK (payment_terms > 0), -- Days
    minimum_charge_enabled BOOLEAN NOT NULL DEFAULT false,
    minimum_charge_amount NUMERIC(20, 2) CHECK (minimum_charge_amount >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_billing_configs_organisation_id ON billing_configs(organisation_id);

COMMENT ON TABLE billing_configs IS 'Per-organisation billing configuration';
COMMENT ON COLUMN billing_configs.tax_rate IS 'Tax rate as decimal (e.g., 0.18 for 18% GST)';
COMMENT ON COLUMN billing_configs.payment_terms IS 'Payment terms in days (e.g., 30 for Net 30)';

-- Update pricing_plans table to support organisation-specific rules
-- (This assumes pricing_plans table already exists)
-- Add organisation_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'pricing_plans' 
        AND column_name = 'organisation_id'
    ) THEN
        ALTER TABLE pricing_plans 
        ADD COLUMN organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE;
        
        CREATE INDEX idx_pricing_plans_organisation_id ON pricing_plans(organisation_id);
        
        COMMENT ON COLUMN pricing_plans.organisation_id IS 'NULL means global rule, UUID means organisation-specific';
    END IF;
END $$;

-- Update invoices table to add finalized_at if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' 
        AND column_name = 'finalized_at'
    ) THEN
        ALTER TABLE invoices 
        ADD COLUMN finalized_at TIMESTAMP WITH TIME ZONE;
        
        CREATE INDEX idx_invoices_finalized_at ON invoices(finalized_at) WHERE finalized_at IS NOT NULL;
        
        COMMENT ON COLUMN invoices.finalized_at IS 'Timestamp when invoice becomes immutable. NULL means draft.';
    END IF;
END $$;

-- Update invoices table to add billing_period_start and billing_period_end if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' 
        AND column_name = 'billing_period_start'
    ) THEN
        ALTER TABLE invoices 
        ADD COLUMN billing_period_start DATE;
        
        ALTER TABLE invoices 
        ADD COLUMN billing_period_end DATE;
        
        COMMENT ON COLUMN invoices.billing_period_start IS 'Start date of billing period';
        COMMENT ON COLUMN invoices.billing_period_end IS 'End date of billing period';
    END IF;
END $$;

-- Update invoice_line_items table to add description and line_number if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoice_line_items' 
        AND column_name = 'description'
    ) THEN
        ALTER TABLE invoice_line_items 
        ADD COLUMN description TEXT;
        
        ALTER TABLE invoice_line_items 
        ADD COLUMN line_number INTEGER;
        
        -- Add unique constraint for line_number per invoice
        CREATE UNIQUE INDEX idx_invoice_line_items_invoice_line_number 
        ON invoice_line_items(invoice_id, line_number);
        
        COMMENT ON COLUMN invoice_line_items.description IS 'Human-readable description of line item';
        COMMENT ON COLUMN invoice_line_items.line_number IS 'Line number within invoice (for ordering)';
    END IF;
END $$;

-- Triggers for updated_at
CREATE TRIGGER update_minimum_charge_rules_updated_at 
    BEFORE UPDATE ON minimum_charge_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_billing_configs_updated_at 
    BEFORE UPDATE ON billing_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
