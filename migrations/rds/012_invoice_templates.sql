-- Migration 012: Invoice Templates
-- Adds support for customizable invoice templates

-- Create invoice_templates table
CREATE TABLE invoice_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE, -- NULL means system-wide template
    name VARCHAR(255) NOT NULL,
    description TEXT,
    template_type VARCHAR(50) NOT NULL DEFAULT 'html' CHECK (template_type IN ('html', 'pdf')), -- Template format
    is_default BOOLEAN NOT NULL DEFAULT false, -- Default template for organisation
    is_active BOOLEAN NOT NULL DEFAULT true,
    html_content TEXT, -- HTML template content
    css_content TEXT, -- CSS styles for the template
    variables JSONB NOT NULL DEFAULT '{}'::jsonb, -- Available template variables and their descriptions
    preview_data JSONB, -- Sample data for preview
    created_by VARCHAR(255), -- User ID who created the template
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_templates_organisation_id ON invoice_templates(organisation_id) WHERE organisation_id IS NOT NULL;
CREATE INDEX idx_invoice_templates_default ON invoice_templates(organisation_id, is_default) WHERE is_default = true AND is_active = true;
CREATE INDEX idx_invoice_templates_active ON invoice_templates(is_active) WHERE is_active = true;

COMMENT ON TABLE invoice_templates IS 'Customizable invoice templates for organisations';
COMMENT ON COLUMN invoice_templates.organisation_id IS 'NULL for system-wide templates, UUID for organisation-specific templates';
COMMENT ON COLUMN invoice_templates.is_default IS 'Indicates if this is the default template for the organisation';
COMMENT ON COLUMN invoice_templates.html_content IS 'HTML template content with variable placeholders (e.g., {{invoice_number}})';
COMMENT ON COLUMN invoice_templates.css_content IS 'CSS styles for the template';
COMMENT ON COLUMN invoice_templates.variables IS 'JSON object describing available template variables and their descriptions';
COMMENT ON COLUMN invoice_templates.preview_data IS 'Sample data used for template preview';

-- Create default system template
INSERT INTO invoice_templates (
    id,
    organisation_id,
    name,
    description,
    template_type,
    is_default,
    is_active,
    html_content,
    css_content,
    variables,
    created_by
) VALUES (
    uuid_generate_v4(),
    NULL, -- System-wide template
    'Default Invoice Template',
    'Default professional invoice template',
    'html',
    true,
    true,
    '<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice {{invoice_number}}</title>
    <style>{{css_content}}</style>
</head>
<body>
    <div class="invoice-container">
        <div class="header">
            <div class="company-info">
                <h1>Metrics Billing Platform</h1>
                <p>Invoice for {{organisation_name}}</p>
            </div>
            <div class="invoice-info">
                <h2>INVOICE</h2>
                <p><strong>{{invoice_number}}</strong></p>
                <p><span class="status-badge status-{{status}}">{{status}}</span></p>
            </div>
        </div>

        <div class="invoice-details">
            <div class="detail-section">
                <h3>Bill To</h3>
                <p><strong>{{organisation_name}}</strong></p>
                {{#if billing_email}}<p>{{billing_email}}</p>{{/if}}
            </div>
            <div class="detail-section">
                <h3>Invoice Details</h3>
                <p><strong>Invoice Date:</strong> {{invoice_date}}</p>
                <p><strong>Due Date:</strong> {{due_date}}</p>
                <p><strong>Billing Period:</strong> {{billing_period_start}} - {{billing_period_end}}</p>
            </div>
        </div>

        <div class="line-items">
            <table>
                <thead>
                    <tr>
                        <th>Description</th>
                        <th>Quantity</th>
                        <th>Unit Price</th>
                        <th>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {{#each line_items}}
                    <tr>
                        <td>{{description}}</td>
                        <td>{{quantity}}</td>
                        <td>{{currency}} {{unit_price}}</td>
                        <td>{{currency}} {{total}}</td>
                    </tr>
                    {{/each}}
                </tbody>
            </table>
        </div>

        <div class="totals">
            <p>Subtotal: {{currency}} {{subtotal}}</p>
            <p>Tax ({{tax_rate}}%): {{currency}} {{tax}}</p>
            <p class="total-amount">Total: {{currency}} {{total}}</p>
        </div>

        <div class="footer">
            <p>Thank you for your business!</p>
            {{#if billing_email}}<p>If you have any questions, please contact us at {{billing_email}}.</p>{{/if}}
        </div>
    </div>
</body>
</html>',
    'body {
      font-family: ''Helvetica Neue'', ''Helvetica'', Arial, sans-serif;
      margin: 0;
      padding: 20px;
      color: #333;
      line-height: 1.6;
      font-size: 10pt;
    }
    .invoice-container {
      max-width: 800px;
      margin: 0 auto;
      background: #fff;
      padding: 30px;
      border: 1px solid #eee;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.05);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 30px;
      border-bottom: 2px solid #eee;
      padding-bottom: 20px;
    }
    .company-info h1 {
      color: #333;
      font-size: 24pt;
      margin: 0;
    }
    .invoice-info {
      text-align: right;
    }
    .invoice-info h2 {
      color: #555;
      font-size: 20pt;
      margin: 0 0 10px 0;
    }
    .invoice-details {
      display: flex;
      justify-content: space-between;
      margin-bottom: 30px;
    }
    .detail-section h3 {
      color: #555;
      font-size: 12pt;
      border-bottom: 1px solid #eee;
      padding-bottom: 5px;
      margin-bottom: 10px;
    }
    .line-items table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    .line-items th, .line-items td {
      border: 1px solid #eee;
      padding: 10px;
      text-align: left;
    }
    .line-items th {
      background-color: #f8f8f8;
      font-weight: bold;
    }
    .totals {
      text-align: right;
      margin-top: 20px;
    }
    .totals .total-amount {
      font-size: 16pt;
      font-weight: bold;
      color: #333;
      border-top: 2px solid #eee;
      padding-top: 10px;
      margin-top: 15px;
    }
    .footer {
      text-align: center;
      margin-top: 50px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      color: #777;
      font-size: 9pt;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-paid { background: #d1fae5; color: #065f46; }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-overdue { background: #fee2e2; color: #991b1b; }',
    '{
      "invoice_number": "Invoice number (e.g., INV-2024-001)",
      "organisation_name": "Organisation name",
      "billing_email": "Billing email address",
      "invoice_date": "Invoice issue date",
      "due_date": "Invoice due date",
      "billing_period_start": "Billing period start date",
      "billing_period_end": "Billing period end date",
      "status": "Invoice status (paid, pending, overdue)",
      "currency": "Currency code (e.g., INR)",
      "subtotal": "Subtotal amount",
      "tax": "Tax amount",
      "tax_rate": "Tax rate percentage",
      "total": "Total amount",
      "line_items": "Array of line items with description, quantity, unit_price, total, currency"
    }'::jsonb,
    'system'
);

-- Add template_id column to invoices table
ALTER TABLE invoices
ADD COLUMN template_id UUID REFERENCES invoice_templates(id) ON DELETE SET NULL;

CREATE INDEX idx_invoices_template_id ON invoices(template_id) WHERE template_id IS NOT NULL;

COMMENT ON COLUMN invoices.template_id IS 'Template used to generate this invoice. NULL means default template was used.';

-- Function to get default template for an organisation
CREATE OR REPLACE FUNCTION get_default_invoice_template(org_id UUID)
RETURNS UUID AS $$
DECLARE
    template_id UUID;
BEGIN
    -- First, try to get organisation-specific default template
    SELECT id INTO template_id
    FROM invoice_templates
    WHERE organisation_id = org_id
      AND is_default = true
      AND is_active = true
    LIMIT 1;

    -- If not found, get system-wide default template
    IF template_id IS NULL THEN
        SELECT id INTO template_id
        FROM invoice_templates
        WHERE organisation_id IS NULL
          AND is_default = true
          AND is_active = true
        LIMIT 1;
    END IF;

    RETURN template_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_default_invoice_template IS 'Gets the default invoice template for an organisation (organisation-specific or system-wide)';

-- Function to ensure only one default template per organisation
CREATE OR REPLACE FUNCTION ensure_single_default_template()
RETURNS TRIGGER AS $$
BEGIN
    -- If this template is being set as default, unset other defaults for the same organisation
    IF NEW.is_default = true THEN
        UPDATE invoice_templates
        SET is_default = false
        WHERE id != NEW.id
          AND organisation_id IS NOT DISTINCT FROM NEW.organisation_id
          AND is_active = true;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ensure_single_default_template
BEFORE INSERT OR UPDATE ON invoice_templates
FOR EACH ROW
WHEN (NEW.is_default = true)
EXECUTE FUNCTION ensure_single_default_template();

COMMENT ON TRIGGER trg_ensure_single_default_template ON invoice_templates IS 'Ensures only one default template per organisation';
