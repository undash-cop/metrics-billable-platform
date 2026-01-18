-- Migration 009: Refunds Support
-- Adds refunds table for tracking refund records

CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    refund_number VARCHAR(50) NOT NULL UNIQUE, -- Human-readable refund number
    razorpay_refund_id VARCHAR(255) UNIQUE, -- Razorpay refund ID
    razorpay_payment_id VARCHAR(255) NOT NULL, -- Original payment ID
    amount NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed', 'cancelled')),
    refund_type VARCHAR(20) NOT NULL DEFAULT 'full' CHECK (refund_type IN ('full', 'partial')),
    reason TEXT, -- Refund reason/notes
    processed_at TIMESTAMP WITH TIME ZONE,
    failure_reason TEXT,
    metadata JSONB, -- Razorpay response, webhook payload, etc.
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL, -- Admin user who initiated refund
    -- Ensure refund amount doesn't exceed payment amount
    CHECK (amount > 0)
);

CREATE INDEX idx_refunds_organisation_id ON refunds(organisation_id);
CREATE INDEX idx_refunds_invoice_id ON refunds(invoice_id);
CREATE INDEX idx_refunds_payment_id ON refunds(payment_id);
CREATE INDEX idx_refunds_refund_number ON refunds(refund_number);
CREATE INDEX idx_refunds_razorpay_refund_id ON refunds(razorpay_refund_id) WHERE razorpay_refund_id IS NOT NULL;
CREATE INDEX idx_refunds_status ON refunds(status);
CREATE INDEX idx_refunds_created_at ON refunds(created_at);

COMMENT ON TABLE refunds IS 'Refund records for tracking refunds processed via Razorpay';
COMMENT ON COLUMN refunds.refund_type IS 'full: refund entire payment, partial: refund portion of payment';
COMMENT ON COLUMN refunds.metadata IS 'Stores Razorpay refund response and webhook payload for audit trail';

-- Add trigger to update payment refund_amount when refund is processed
CREATE OR REPLACE FUNCTION update_payment_refund_amount()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'processed' AND OLD.status != 'processed' THEN
        UPDATE payments
        SET refund_amount = COALESCE(refund_amount, 0) + NEW.amount,
            refunded_at = COALESCE(refunded_at, NEW.processed_at),
            status = CASE
                WHEN (COALESCE(refund_amount, 0) + NEW.amount) >= amount THEN 'refunded'
                ELSE 'partially_refunded'
            END,
            updated_at = NOW()
        WHERE id = NEW.payment_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_payment_refund_amount
AFTER UPDATE ON refunds
FOR EACH ROW
WHEN (NEW.status = 'processed' AND OLD.status != 'processed')
EXECUTE FUNCTION update_payment_refund_amount();

-- Add trigger to update invoice status when payment is fully refunded
CREATE OR REPLACE FUNCTION update_invoice_status_on_refund()
RETURNS TRIGGER AS $$
DECLARE
    payment_record RECORD;
BEGIN
    IF NEW.status = 'processed' AND OLD.status != 'processed' THEN
        SELECT * INTO payment_record FROM payments WHERE id = NEW.payment_id;
        
        -- If payment is fully refunded, update invoice status
        IF payment_record.status = 'refunded' THEN
            UPDATE invoices
            SET status = 'refunded',
                updated_at = NOW()
            WHERE id = NEW.invoice_id
              AND status = 'paid';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_invoice_status_on_refund
AFTER UPDATE ON refunds
FOR EACH ROW
WHEN (NEW.status = 'processed' AND OLD.status != 'processed')
EXECUTE FUNCTION update_invoice_status_on_refund();
