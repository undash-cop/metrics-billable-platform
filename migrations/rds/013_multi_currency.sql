-- Migration 013: Multi-Currency Support
-- Adds currency support for organisations and exchange rate tracking

-- Add currency column to organisations table
ALTER TABLE organisations
ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$');

CREATE INDEX idx_organisations_currency ON organisations(currency);

COMMENT ON COLUMN organisations.currency IS 'Preferred currency for this organisation (ISO 4217 code, e.g., INR, USD, EUR)';

-- Create exchange_rates table for currency conversion
CREATE TABLE exchange_rates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    base_currency VARCHAR(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
    target_currency VARCHAR(3) NOT NULL CHECK (target_currency ~ '^[A-Z]{3}$'),
    rate NUMERIC(20, 8) NOT NULL CHECK (rate > 0), -- Exchange rate: 1 base_currency = rate target_currency
    effective_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMP WITH TIME ZONE, -- NULL means currently active
    source VARCHAR(50) NOT NULL DEFAULT 'manual', -- 'manual', 'api', 'razorpay'
    metadata JSONB, -- Source API response, provider info, etc.
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Ensure base and target are different
    CHECK (base_currency != target_currency),
    -- Unique active rate per currency pair
    UNIQUE(base_currency, target_currency, effective_to)
);

CREATE INDEX idx_exchange_rates_base_target ON exchange_rates(base_currency, target_currency);
CREATE INDEX idx_exchange_rates_effective ON exchange_rates(base_currency, target_currency, effective_from DESC, effective_to NULLS FIRST);
CREATE INDEX idx_exchange_rates_active ON exchange_rates(base_currency, target_currency) WHERE effective_to IS NULL;

COMMENT ON TABLE exchange_rates IS 'Exchange rates for currency conversion. Only one active rate per currency pair.';
COMMENT ON COLUMN exchange_rates.rate IS 'Exchange rate: 1 base_currency = rate target_currency (e.g., 1 USD = 83.5 INR)';
COMMENT ON COLUMN exchange_rates.effective_to IS 'NULL means currently active rate. When a new rate is added, old rate effective_to is set.';
COMMENT ON COLUMN exchange_rates.source IS 'Source of exchange rate: manual (admin entry), api (external API), razorpay (Razorpay rates)';

-- Function to get current exchange rate
CREATE OR REPLACE FUNCTION get_exchange_rate(
    from_currency VARCHAR(3),
    to_currency VARCHAR(3),
    at_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
) RETURNS NUMERIC AS $$
DECLARE
    rate NUMERIC;
BEGIN
    -- If same currency, return 1
    IF from_currency = to_currency THEN
        RETURN 1;
    END IF;

    -- Get active rate (effective_to IS NULL or effective_to > at_date)
    SELECT er.rate INTO rate
    FROM exchange_rates er
    WHERE er.base_currency = from_currency
      AND er.target_currency = to_currency
      AND er.effective_from <= at_date
      AND (er.effective_to IS NULL OR er.effective_to > at_date)
    ORDER BY er.effective_from DESC
    LIMIT 1;

    -- If not found, try reverse (inverse rate)
    IF rate IS NULL THEN
        SELECT 1 / er.rate INTO rate
        FROM exchange_rates er
        WHERE er.base_currency = to_currency
          AND er.target_currency = from_currency
          AND er.effective_from <= at_date
          AND (er.effective_to IS NULL OR er.effective_to > at_date)
        ORDER BY er.effective_from DESC
        LIMIT 1;
    END IF;

    RETURN rate;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_exchange_rate IS 'Gets exchange rate between two currencies at a specific date. Returns 1 if same currency, NULL if rate not found.';

-- Function to convert amount between currencies
CREATE OR REPLACE FUNCTION convert_currency(
    amount NUMERIC,
    from_currency VARCHAR(3),
    to_currency VARCHAR(3),
    at_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
) RETURNS NUMERIC AS $$
DECLARE
    rate NUMERIC;
BEGIN
    rate := get_exchange_rate(from_currency, to_currency, at_date);
    
    IF rate IS NULL THEN
        RETURN NULL; -- Rate not found
    END IF;
    
    RETURN amount * rate;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION convert_currency IS 'Converts amount from one currency to another using exchange rate. Returns NULL if rate not found.';

-- Add currency conversion metadata to invoices
-- This will store original currency and conversion details if invoice was converted
ALTER TABLE invoices
ADD COLUMN original_currency VARCHAR(3) CHECK (original_currency ~ '^[A-Z]{3}$'),
ADD COLUMN exchange_rate NUMERIC(20, 8) CHECK (exchange_rate > 0),
ADD COLUMN conversion_date TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN invoices.original_currency IS 'Original currency before conversion (NULL if no conversion)';
COMMENT ON COLUMN invoices.exchange_rate IS 'Exchange rate used for conversion (if converted)';
COMMENT ON COLUMN invoices.conversion_date IS 'Date when currency conversion was performed';

-- Add currency conversion metadata to pricing_plans
ALTER TABLE pricing_plans
ADD COLUMN original_currency VARCHAR(3) CHECK (original_currency ~ '^[A-Z]{3}$'),
ADD COLUMN exchange_rate NUMERIC(20, 8) CHECK (exchange_rate > 0),
ADD COLUMN conversion_date TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN pricing_plans.original_currency IS 'Original currency before conversion (if pricing was converted)';
COMMENT ON COLUMN pricing_plans.exchange_rate IS 'Exchange rate used for conversion (if converted)';

-- Create view for active exchange rates (for easy querying)
CREATE OR REPLACE VIEW active_exchange_rates AS
SELECT 
    base_currency,
    target_currency,
    rate,
    effective_from,
    source,
    updated_at
FROM exchange_rates
WHERE effective_to IS NULL
ORDER BY base_currency, target_currency;

COMMENT ON VIEW active_exchange_rates IS 'View of currently active exchange rates';

-- Insert default exchange rates (1:1 for same currency, common pairs)
-- These are placeholder rates - should be updated via API or admin
INSERT INTO exchange_rates (base_currency, target_currency, rate, source, metadata)
VALUES
    ('INR', 'USD', 0.012, 'manual', '{"note": "Placeholder rate - update with real rates"}'),
    ('USD', 'INR', 83.33, 'manual', '{"note": "Placeholder rate - update with real rates"}'),
    ('INR', 'EUR', 0.011, 'manual', '{"note": "Placeholder rate - update with real rates"}'),
    ('EUR', 'INR', 90.91, 'manual', '{"note": "Placeholder rate - update with real rates"}'),
    ('USD', 'EUR', 0.92, 'manual', '{"note": "Placeholder rate - update with real rates"}'),
    ('EUR', 'USD', 1.09, 'manual', '{"note": "Placeholder rate - update with real rates"}')
ON CONFLICT (base_currency, target_currency, effective_to) DO NOTHING;

-- Function to update exchange rate (sets old rate effective_to, inserts new rate)
CREATE OR REPLACE FUNCTION update_exchange_rate(
    p_base_currency VARCHAR(3),
    p_target_currency VARCHAR(3),
    p_rate NUMERIC,
    p_source VARCHAR(50) DEFAULT 'manual',
    p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    new_rate_id UUID;
BEGIN
    -- Set old rate effective_to to NOW()
    UPDATE exchange_rates
    SET effective_to = NOW(),
        updated_at = NOW()
    WHERE base_currency = p_base_currency
      AND target_currency = p_target_currency
      AND effective_to IS NULL;

    -- Insert new rate
    INSERT INTO exchange_rates (base_currency, target_currency, rate, source, metadata)
    VALUES (p_base_currency, p_target_currency, p_rate, p_source, p_metadata)
    RETURNING id INTO new_rate_id;

    RETURN new_rate_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_exchange_rate IS 'Updates exchange rate by setting old rate effective_to and inserting new rate';
