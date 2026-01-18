-- Migration 011: Usage Alerts
-- Adds alert rules and alert history for usage monitoring

-- Create alert_rules table
CREATE TABLE alert_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL means organisation-wide
    name VARCHAR(255) NOT NULL,
    description TEXT,
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('usage_threshold', 'usage_spike', 'cost_threshold', 'unusual_pattern')),
    metric_name VARCHAR(100), -- NULL for cost-based alerts
    unit VARCHAR(50), -- NULL for cost-based alerts
    threshold_value NUMERIC(20, 2) NOT NULL, -- Threshold value for comparison
    threshold_operator VARCHAR(10) NOT NULL CHECK (threshold_operator IN ('gt', 'gte', 'lt', 'lte', 'eq')), -- Greater than, greater than or equal, less than, less than or equal, equal
    comparison_period VARCHAR(20) NOT NULL CHECK (comparison_period IN ('hour', 'day', 'week', 'month')), -- Period to compare against
    spike_threshold_percent NUMERIC(5, 2), -- For usage_spike: percentage increase (e.g., 50.00 for 50%)
    spike_comparison_period VARCHAR(20), -- For usage_spike: period to compare against (e.g., 'day', 'week')
    is_active BOOLEAN NOT NULL DEFAULT true,
    notification_channels TEXT[] NOT NULL DEFAULT ARRAY['email']::TEXT[], -- Array of channels: 'email', 'sms', 'webhook'
    webhook_url TEXT, -- Optional webhook URL for notifications
    cooldown_minutes INTEGER NOT NULL DEFAULT 60, -- Minutes to wait before sending another alert for same rule
    created_by VARCHAR(255), -- User ID who created the rule
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_rules_organisation_id ON alert_rules(organisation_id);
CREATE INDEX idx_alert_rules_project_id ON alert_rules(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_alert_rules_active ON alert_rules(is_active) WHERE is_active = true;
CREATE INDEX idx_alert_rules_type ON alert_rules(alert_type);

COMMENT ON TABLE alert_rules IS 'Alert rules for monitoring usage and costs';
COMMENT ON COLUMN alert_rules.alert_type IS 'Type of alert: usage_threshold, usage_spike, cost_threshold, unusual_pattern';
COMMENT ON COLUMN alert_rules.threshold_value IS 'Threshold value for comparison (usage amount or cost)';
COMMENT ON COLUMN alert_rules.threshold_operator IS 'Operator for comparison: gt (greater than), gte (>=), lt (<), lte (<=), eq (=)';
COMMENT ON COLUMN alert_rules.comparison_period IS 'Time period to compare against: hour, day, week, month';
COMMENT ON COLUMN alert_rules.spike_threshold_percent IS 'For usage_spike alerts: percentage increase threshold (e.g., 50.00 for 50% increase)';
COMMENT ON COLUMN alert_rules.cooldown_minutes IS 'Minutes to wait before sending another alert for the same rule (prevents spam)';

-- Create alert_history table
CREATE TABLE alert_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    metric_name VARCHAR(100),
    unit VARCHAR(50),
    threshold_value NUMERIC(20, 2) NOT NULL,
    actual_value NUMERIC(20, 2) NOT NULL, -- Actual value that triggered the alert
    comparison_period VARCHAR(20) NOT NULL,
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'acknowledged')),
    notification_channels TEXT[] NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE, -- When alert was sent
    acknowledged_at TIMESTAMP WITH TIME ZONE, -- When alert was acknowledged
    acknowledged_by VARCHAR(255), -- User who acknowledged
    error_message TEXT, -- Error if notification failed
    metadata JSONB, -- Additional context (e.g., spike percentage, comparison values)
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_history_rule_id ON alert_history(alert_rule_id);
CREATE INDEX idx_alert_history_organisation_id ON alert_history(organisation_id);
CREATE INDEX idx_alert_history_project_id ON alert_history(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_alert_history_status ON alert_history(status);
CREATE INDEX idx_alert_history_created_at ON alert_history(created_at DESC);
CREATE INDEX idx_alert_history_rule_created ON alert_history(alert_rule_id, created_at DESC); -- For cooldown checks

COMMENT ON TABLE alert_history IS 'History of all triggered alerts';
COMMENT ON COLUMN alert_history.actual_value IS 'Actual usage/cost value that triggered the alert';
COMMENT ON COLUMN alert_history.status IS 'Alert status: pending (queued), sent (notification sent), failed (notification failed), acknowledged (user acknowledged)';
COMMENT ON COLUMN alert_history.metadata IS 'Additional context: spike percentage, comparison values, etc.';

-- Create function to check cooldown period
CREATE OR REPLACE FUNCTION check_alert_cooldown(
    rule_id UUID,
    cooldown_minutes INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
    last_alert_time TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Get the most recent sent alert for this rule
    SELECT MAX(created_at)
    INTO last_alert_time
    FROM alert_history
    WHERE alert_rule_id = rule_id
      AND status IN ('sent', 'acknowledged');
    
    -- If no previous alert, allow
    IF last_alert_time IS NULL THEN
        RETURN true;
    END IF;
    
    -- Check if cooldown period has passed
    RETURN NOW() >= last_alert_time + (cooldown_minutes || ' minutes')::INTERVAL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION check_alert_cooldown IS 'Checks if enough time has passed since last alert for a rule (cooldown period)';

-- Create function to get active alerts for an organisation
CREATE OR REPLACE FUNCTION get_active_alerts(
    org_id UUID,
    hours_back INTEGER DEFAULT 24
) RETURNS TABLE (
    alert_id UUID,
    rule_id UUID,
    rule_name VARCHAR,
    alert_type VARCHAR,
    metric_name VARCHAR,
    actual_value NUMERIC,
    threshold_value NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ah.id,
        ah.alert_rule_id,
        ar.name,
        ah.alert_type,
        ah.metric_name,
        ah.actual_value,
        ah.threshold_value,
        ah.created_at
    FROM alert_history ah
    JOIN alert_rules ar ON ar.id = ah.alert_rule_id
    WHERE ah.organisation_id = org_id
      AND ah.created_at >= NOW() - (hours_back || ' hours')::INTERVAL
      AND ah.status IN ('pending', 'sent')
    ORDER BY ah.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_active_alerts IS 'Gets active alerts for an organisation within the specified hours';
