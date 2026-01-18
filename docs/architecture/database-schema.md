# Database Schema

Database schema design for the Metrics Billing Platform.

## Overview

The platform uses two databases:
- **Cloudflare D1** - Hot event storage (temporary)
- **Amazon RDS PostgreSQL** - Financial source of truth (permanent)

## RDS Schema

### Core Tables

#### organisations
- `id` (UUID, PK)
- `name` (VARCHAR)
- `billing_email` (VARCHAR)
- `is_active` (BOOLEAN)
- `created_at`, `updated_at` (TIMESTAMP)

#### projects
- `id` (UUID, PK)
- `organisation_id` (UUID, FK → organisations)
- `name` (VARCHAR)
- `description` (TEXT)
- `is_active` (BOOLEAN)
- `created_at`, `updated_at` (TIMESTAMP)

#### api_keys
- `id` (UUID, PK)
- `project_id` (UUID, FK → projects)
- `key_hash` (VARCHAR) - SHA-256 hash
- `name` (VARCHAR)
- `is_active` (BOOLEAN)
- `created_at`, `updated_at` (TIMESTAMP)

### Usage Tables

#### usage_events
- `id` (UUID, PK)
- `organisation_id` (UUID, FK → organisations)
- `project_id` (UUID, FK → projects)
- `metric_name` (VARCHAR)
- `metric_value` (NUMERIC)
- `unit` (VARCHAR)
- `timestamp` (TIMESTAMP)
- `idempotency_key` (VARCHAR, UNIQUE)
- `metadata` (JSONB)
- `ingested_at` (TIMESTAMP)

#### usage_aggregates
- `id` (UUID, PK)
- `organisation_id` (UUID, FK → organisations)
- `project_id` (UUID, FK → projects)
- `metric_name` (VARCHAR)
- `unit` (VARCHAR)
- `total_value` (NUMERIC)
- `event_count` (INTEGER)
- `month` (INTEGER)
- `year` (INTEGER)
- `created_at`, `updated_at` (TIMESTAMP)
- UNIQUE(organisation_id, project_id, metric_name, unit, month, year)

### Billing Tables

#### invoices
- `id` (UUID, PK)
- `organisation_id` (UUID, FK → organisations)
- `invoice_number` (VARCHAR, UNIQUE)
- `total` (NUMERIC)
- `currency` (VARCHAR)
- `status` (VARCHAR) - draft, finalized, paid, refunded, cancelled
- `pdf_url` (VARCHAR) - URL to generated PDF invoice
- `pdf_generated_at` (TIMESTAMP) - When PDF was generated
- `month` (INTEGER)
- `year` (INTEGER)
- `due_date` (DATE)
- `paid_at` (TIMESTAMP)
- `created_at`, `updated_at` (TIMESTAMP)
- UNIQUE(organisation_id, month, year) WHERE status != 'cancelled'

#### invoice_line_items
- `id` (UUID, PK)
- `invoice_id` (UUID, FK → invoices)
- `line_number` (INTEGER)
- `description` (VARCHAR)
- `quantity` (NUMERIC)
- `unit_price` (NUMERIC)
- `total` (NUMERIC)
- `currency` (VARCHAR)

#### payments
- `id` (UUID, PK)
- `organisation_id` (UUID, FK → organisations)
- `invoice_id` (UUID, FK → invoices)
- `razorpay_order_id` (VARCHAR)
- `razorpay_payment_id` (VARCHAR, UNIQUE)
- `amount` (NUMERIC)
- `currency` (VARCHAR)
- `status` (VARCHAR) - pending, authorized, captured, failed, refunded, partially_refunded
- `payment_method` (VARCHAR)
- `paid_at` (TIMESTAMP)
- `reconciled_at` (TIMESTAMP)
- `refund_amount` (NUMERIC) - Total amount refunded
- `refunded_at` (TIMESTAMP)
- `retry_count` (INTEGER) - Number of retry attempts
- `max_retries` (INTEGER) - Maximum retry attempts allowed
- `next_retry_at` (TIMESTAMP) - When next retry should be attempted
- `last_retry_at` (TIMESTAMP) - Timestamp of last retry attempt
- `retry_history` (JSONB) - Array of retry attempts with timestamps and results
- `created_at`, `updated_at` (TIMESTAMP)

#### alert_rules
- `id` (UUID, PK)
- `organisation_id` (UUID, FK → organisations)
- `project_id` (UUID, FK → projects, nullable)
- `name` (VARCHAR)
- `description` (TEXT)
- `alert_type` (VARCHAR) - usage_threshold, usage_spike, cost_threshold, unusual_pattern
- `metric_name` (VARCHAR, nullable)
- `unit` (VARCHAR, nullable)
- `threshold_value` (NUMERIC)
- `threshold_operator` (VARCHAR) - gt, gte, lt, lte, eq
- `comparison_period` (VARCHAR) - hour, day, week, month
- `spike_threshold_percent` (NUMERIC, nullable)
- `spike_comparison_period` (VARCHAR, nullable)
- `is_active` (BOOLEAN)
- `notification_channels` (TEXT[])
- `webhook_url` (TEXT, nullable)
- `cooldown_minutes` (INTEGER)
- `created_at`, `updated_at` (TIMESTAMP)

#### alert_history
- `id` (UUID, PK)
- `alert_rule_id` (UUID, FK → alert_rules)
- `organisation_id` (UUID, FK → organisations)
- `project_id` (UUID, FK → projects, nullable)
- `alert_type` (VARCHAR)
- `metric_name` (VARCHAR, nullable)
- `unit` (VARCHAR, nullable)
- `threshold_value` (NUMERIC)
- `actual_value` (NUMERIC)
- `comparison_period` (VARCHAR)
- `period_start`, `period_end` (TIMESTAMP)
- `status` (VARCHAR) - pending, sent, failed, acknowledged
- `notification_channels` (TEXT[])
- `sent_at` (TIMESTAMP, nullable)
- `acknowledged_at` (TIMESTAMP, nullable)
- `error_message` (TEXT, nullable)
- `metadata` (JSONB)
- `created_at` (TIMESTAMP)

#### invoice_templates
- `id` (UUID, PK)
- `organisation_id` (UUID, FK → organisations, nullable)
- `name` (VARCHAR)
- `description` (TEXT)
- `template_type` (VARCHAR) - html, pdf
- `is_default` (BOOLEAN)
- `is_active` (BOOLEAN)
- `html_content` (TEXT)
- `css_content` (TEXT)
- `variables` (JSONB) - Variable descriptions
- `preview_data` (JSONB) - Sample data for preview
- `created_by` (VARCHAR)
- `created_at`, `updated_at` (TIMESTAMP)

**Note**: `template_id` column added to `invoices` table to reference the template used.

#### exchange_rates
- `id` (UUID, PK)
- `base_currency` (VARCHAR(3))
- `target_currency` (VARCHAR(3))
- `rate` (NUMERIC) - Exchange rate: 1 base_currency = rate target_currency
- `effective_from` (TIMESTAMP)
- `effective_to` (TIMESTAMP, nullable) - NULL means currently active
- `source` (VARCHAR) - manual, api, razorpay
- `metadata` (JSONB)
- `created_at`, `updated_at` (TIMESTAMP)

**Note**: `currency` column added to `organisations` table. `original_currency`, `exchange_rate`, and `conversion_date` columns added to `invoices` and `pricing_plans` tables for conversion tracking.

### Pricing Tables

#### pricing_plans
- `id` (UUID, PK)
- `metric_name` (VARCHAR)
- `unit` (VARCHAR)
- `price_per_unit` (NUMERIC)
- `currency` (VARCHAR)
- `effective_from` (DATE)
- `effective_to` (DATE, nullable)
- `is_active` (BOOLEAN)
- `created_at`, `updated_at` (TIMESTAMP)

### Admin Tables

#### admin_users
- `id` (UUID, PK)
- `email` (VARCHAR, UNIQUE)
- `role` (VARCHAR) - admin, viewer, operator
- `permissions` (JSONB)
- `created_at`, `updated_at` (TIMESTAMP)

#### admin_api_keys
- `id` (UUID, PK)
- `user_id` (UUID, FK → admin_users)
- `key_hash` (VARCHAR, UNIQUE) - SHA-256 hash
- `name` (VARCHAR)
- `is_active` (BOOLEAN)
- `created_at`, `updated_at` (TIMESTAMP)

### Audit Tables

#### audit_logs
- `id` (UUID, PK)
- `organisation_id` (UUID, FK → organisations)
- `entity_type` (VARCHAR)
- `entity_id` (UUID)
- `action` (VARCHAR)
- `user_id` (UUID, FK → admin_users)
- `changes` (JSONB)
- `ip_address` (VARCHAR)
- `user_agent` (VARCHAR)
- `created_at` (TIMESTAMP)

### Email Tables

#### email_notifications
- `id` (UUID, PK)
- `organisation_id` (UUID, FK → organisations)
- `invoice_id` (UUID, FK → invoices)
- `payment_id` (UUID, FK → payments)
- `recipient_email` (VARCHAR)
- `subject` (VARCHAR)
- `message_id` (VARCHAR)
- `status` (VARCHAR) - sent, failed, pending
- `error_message` (TEXT)
- `created_at`, `sent_at` (TIMESTAMP)

## D1 Schema

### usage_events
- `id` (TEXT, PK)
- `project_id` (TEXT)
- `organisation_id` (TEXT)
- `metric_name` (TEXT)
- `metric_value` (REAL)
- `unit` (TEXT)
- `timestamp` (INTEGER)
- `metadata` (TEXT)
- `idempotency_key` (TEXT, UNIQUE)
- `ingested_at` (INTEGER)
- `processed_at` (INTEGER, nullable)

## Indexes

### Critical Indexes

- `usage_events(organisation_id, project_id, timestamp)`
- `usage_aggregates(organisation_id, month, year)`
- `invoices(organisation_id, month, year)`
- `payments(razorpay_payment_id)`
- `api_keys(key_hash)`
- `admin_api_keys(key_hash)`

## See Also

- [Architecture Overview](./index)
- [System Design](./system-design)
- [Data Flow](./data-flow)
