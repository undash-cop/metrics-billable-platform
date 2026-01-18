-- Migration 007: Email Notifications
-- Adds email notification tracking table

CREATE TABLE IF NOT EXISTS email_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  recipient_email VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  message_id VARCHAR(255), -- Provider message ID (e.g., SendGrid message ID)
  status VARCHAR(50) NOT NULL CHECK (status IN ('sent', 'failed', 'pending')),
  error_message TEXT,
  provider VARCHAR(50), -- 'sendgrid', 'ses', 'resend'
  metadata JSONB, -- Additional metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  opened_at TIMESTAMP WITH TIME ZONE,
  clicked_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for common queries
CREATE INDEX idx_email_notifications_org ON email_notifications(organisation_id);
CREATE INDEX idx_email_notifications_invoice ON email_notifications(invoice_id);
CREATE INDEX idx_email_notifications_payment ON email_notifications(payment_id);
CREATE INDEX idx_email_notifications_status ON email_notifications(status);
CREATE INDEX idx_email_notifications_created ON email_notifications(created_at DESC);
CREATE INDEX idx_email_notifications_recipient ON email_notifications(recipient_email);

-- Add email preferences to organisations (optional)
ALTER TABLE organisations 
ADD COLUMN IF NOT EXISTS billing_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS invoice_email_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS payment_email_enabled BOOLEAN DEFAULT true;

-- Add index for email lookups
CREATE INDEX IF NOT EXISTS idx_organisations_billing_email ON organisations(billing_email);

COMMENT ON TABLE email_notifications IS 'Tracks all email notifications sent by the platform';
COMMENT ON COLUMN email_notifications.message_id IS 'Provider-specific message ID for tracking';
COMMENT ON COLUMN email_notifications.status IS 'Current status of the email';
COMMENT ON COLUMN email_notifications.provider IS 'Email provider used to send the email';
COMMENT ON COLUMN email_notifications.metadata IS 'Additional metadata about the email';
