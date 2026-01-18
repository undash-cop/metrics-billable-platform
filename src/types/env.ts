/**
 * Environment variables and Cloudflare bindings
 */

export interface Env {
  // Cloudflare bindings
  EVENTS_DB: D1Database;
  USAGE_EVENTS_QUEUE: Queue; // Queue for async event processing
  USAGE_EVENTS_DLQ?: Queue; // Dead-letter queue for failed messages
  
  // Environment variables
  ENVIRONMENT: 'development' | 'staging' | 'production';
  
  // RDS Postgres connection
  RDS_HOST: string;
  RDS_PORT: string;
  RDS_DATABASE: string;
  RDS_USER: string;
  RDS_PASSWORD: string;
  RDS_SSL: string; // 'true' or 'false'
  
  // Optional: RDS API endpoint for API key validation (if using HTTP-based access)
  RDS_API_URL?: string;
  RDS_API_TOKEN?: string;
  
  // Razorpay credentials
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  RAZORPAY_WEBHOOK_SECRET: string;
  
  // Application config
  TAX_RATE: string; // Decimal as string, e.g., '0.18' for 18% GST
  DEFAULT_CURRENCY: string; // Default 'INR'
  
  // Currency conversion (optional)
  EXCHANGE_RATE_API_KEY?: string; // API key for exchange rate service (e.g., exchangerate-api.com)
  EXCHANGE_RATE_API_URL?: string; // Exchange rate API URL
  EXCHANGE_RATE_UPDATE_INTERVAL_HOURS?: string; // How often to update rates (default: 24)
  
  // Migration config (optional, with defaults)
  MIGRATION_BATCH_SIZE?: string; // Events per batch (default: 1000)
  MIGRATION_MAX_BATCHES?: string; // Max batches per run (default: 10)
  
  // Admin authentication (optional)
  ADMIN_API_KEY?: string; // Admin API key for simple deployments
  ADMIN_IP_WHITELIST?: string; // Comma-separated list of allowed IPs (optional)

  // Email configuration (optional)
  EMAIL_PROVIDER?: 'sendgrid' | 'ses' | 'resend'; // Email provider to use
  SENDGRID_API_KEY?: string; // SendGrid API key
  RESEND_API_KEY?: string; // Resend API key
  AWS_SES_REGION?: string; // AWS SES region
  EMAIL_FROM?: string; // Default from email address
  EMAIL_FROM_NAME?: string; // Default from name

  // PDF generation (optional)
  INVOICE_PDFS_R2?: R2Bucket; // R2 bucket for storing invoice PDFs
  PDF_GENERATION_API_KEY?: string; // API key for PDF generation service (PDFShift, HTMLtoPDF, etc.)
  PDF_GENERATION_API_URL?: string; // PDF generation service URL
  BASE_URL?: string; // Base URL for generating PDF download links
  
  // Payment retry configuration (optional)
  PAYMENT_RETRY_ENABLED?: string; // 'true' or 'false' (default: 'true')
  PAYMENT_RETRY_MAX_RETRIES?: string; // Max retry attempts (default: '3')
  PAYMENT_RETRY_BASE_INTERVAL_HOURS?: string; // Base interval for exponential backoff in hours (default: '24')
}
