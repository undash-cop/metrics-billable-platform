-- Migration 008: Invoice PDF Support
-- Adds PDF URL column to invoices table

ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS pdf_url VARCHAR(500),
ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMP WITH TIME ZONE;

-- Index for PDF URL lookups
CREATE INDEX IF NOT EXISTS idx_invoices_pdf_url ON invoices(pdf_url) WHERE pdf_url IS NOT NULL;

COMMENT ON COLUMN invoices.pdf_url IS 'URL to generated PDF invoice (stored in R2 or S3)';
COMMENT ON COLUMN invoices.pdf_generated_at IS 'Timestamp when PDF was generated';
