-- Migration 010: Payment Retry Logic
-- Adds retry tracking columns to payments table

-- Add retry tracking columns to payments table
ALTER TABLE payments
ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3,
ADD COLUMN next_retry_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN last_retry_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN retry_history JSONB DEFAULT '[]'::jsonb;

-- Add index for finding payments ready for retry
CREATE INDEX idx_payments_retry ON payments(status, next_retry_at)
WHERE status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW();

-- Add index for retry count tracking
CREATE INDEX idx_payments_retry_count ON payments(status, retry_count)
WHERE status = 'failed' AND retry_count < max_retries;

COMMENT ON COLUMN payments.retry_count IS 'Number of retry attempts made for this payment';
COMMENT ON COLUMN payments.max_retries IS 'Maximum number of retry attempts allowed (default: 3)';
COMMENT ON COLUMN payments.next_retry_at IS 'Timestamp when next retry should be attempted (null if max retries reached)';
COMMENT ON COLUMN payments.last_retry_at IS 'Timestamp of last retry attempt';
COMMENT ON COLUMN payments.retry_history IS 'JSON array of retry attempts with timestamps and results';

-- Add function to calculate next retry time with exponential backoff
CREATE OR REPLACE FUNCTION calculate_next_retry_time(
  retry_count INTEGER,
  base_interval_hours INTEGER DEFAULT 24
) RETURNS TIMESTAMP WITH TIME ZONE AS $$
BEGIN
  -- Exponential backoff: 24h, 48h, 96h
  -- Formula: base_interval * 2^(retry_count)
  RETURN NOW() + (base_interval_hours * POWER(2, retry_count) || ' hours')::INTERVAL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_next_retry_time IS 'Calculates next retry time using exponential backoff';

-- Add function to check if payment is eligible for retry
CREATE OR REPLACE FUNCTION is_payment_retry_eligible(
  payment_status VARCHAR,
  current_retry_count INTEGER,
  max_retries INTEGER,
  next_retry_time TIMESTAMP WITH TIME ZONE
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN payment_status = 'failed' 
    AND current_retry_count < max_retries
    AND (next_retry_time IS NULL OR next_retry_time <= NOW());
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_payment_retry_eligible IS 'Checks if a payment is eligible for retry';
