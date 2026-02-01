---
layout: home

hero:
  name: "Undash-cop Metrics Billing Platform"
  text: "Production-Ready Billing System"
  tagline: Multi-tenant, usage-based billing with enterprise-grade security and reliability
  image:
    src: /assets/logo-icon.svg
    alt: Undash-cop Logo
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: View API Docs
      link: /api/
    - theme: alt
      text: Check Status
      link: /status/
    - theme: alt
      text: Legal
      link: /legal/

features:
  - title: 🚀 Production Ready
    details: All 17 production readiness fixes completed. Enterprise-grade security, reliability, and observability.
  - title: 🔒 Secure by Default
    details: API key authentication, RBAC, rate limiting, IP whitelisting, and full audit logging.
  - title: 📊 Multi-Tenant
    details: Support for multiple organisations and projects with complete data isolation.
  - title: 💰 Usage-Based Billing
    details: Track and bill based on usage metrics with configurable pricing rules.
  - title: 🧾 Automated Invoicing
    details: Monthly invoice generation with tax calculation, PDF generation, and payment integration.
  - title: 🔄 Data Integrity
    details: Idempotent operations, reconciliation jobs, and comprehensive validation.
  - title: 📄 PDF Invoices
    details: Professional PDF invoice generation with automatic storage and email delivery.
  - title: 💸 Refund Management
    details: Full and partial refunds with automatic status updates and webhook reconciliation.
---

## Quick Links

<div class="quick-links">
  <div class="link-card">
    <h3>🚀 Getting Started</h3>
    <p>Install, configure, and deploy the platform</p>
    <a href="/getting-started/">Get Started →</a>
  </div>
  
  <div class="link-card">
    <h3>📖 API Reference</h3>
    <p>Complete API documentation and examples</p>
    <a href="/api/">View APIs →</a>
  </div>
  
  <div class="link-card">
    <h3>🏗️ Architecture</h3>
    <p>System design and architecture overview</p>
    <a href="/architecture/">View Architecture →</a>
  </div>
  
  <div class="link-card">
    <h3>⚙️ Operations</h3>
    <p>Daily operations, monitoring, and troubleshooting</p>
    <a href="/operations/">Operations Guide →</a>
  </div>
  
  <div class="link-card">
    <h3>✅ Project Status</h3>
    <p>Current implementation status and next steps</p>
    <a href="/status/">View Status →</a>
  </div>
  
  <div class="link-card">
    <h3>🔒 Security</h3>
    <p>Security features and best practices</p>
    <a href="/architecture/security">Security Guide →</a>
  </div>
</div>

## Current Status

<div class="status-badge">
  <span class="badge badge-success">✅ Production Ready</span>
  <span class="badge badge-info">17/17 Fixes Complete</span>
  <span class="badge badge-info">100% Implementation</span>
</div>

### Implementation Status

- ✅ **P0 Critical**: 5/5 fixes complete
- ✅ **P1 High Priority**: 2/2 fixes complete  
- ✅ **P2 Medium Priority**: 5/5 fixes complete
- ✅ **P3 Low Priority**: 5/5 fixes complete

[View Full Status →](/status/)

## Key Features

### Core Platform
- Multi-tenant architecture (organisations → projects)
- Usage-based event ingestion API
- Monthly invoice generation
- Razorpay payment integration
- Admin dashboard API

### Production Features
- Idempotent operations (no duplicates)
- Data reconciliation (D1 vs RDS, payments)
- Invoice validation (calculation checks)
- D1 as queue; cron migration + aggregation (no Cloudflare Queues)
- Retry logic (exponential backoff)
- Payment retry with exponential backoff
- Usage alerts (threshold, spike, cost monitoring)
- Audit logging (full audit trail)
- Rate limiting (prevent abuse)
- RBAC (role-based access control)

### Business Features
- Invoice PDF generation with branding
- Email notifications (invoice, payment, reminders)
- Scheduled monthly invoice generation
- Refund handling (full and partial)
- Usage dashboards and analytics
- Multi-currency support with conversion
- Customizable invoice templates

<style>
.quick-links {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
  margin: 2rem 0;
}

.link-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 1.5rem;
  transition: all 0.3s ease;
}

.link-card:hover {
  border-color: var(--vp-c-brand);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.link-card h3 {
  margin-top: 0;
  font-size: 1.25rem;
}

.link-card p {
  color: var(--vp-c-text-2);
  margin: 0.5rem 0;
}

.link-card a {
  color: var(--vp-c-brand);
  text-decoration: none;
  font-weight: 500;
}

.status-badge {
  display: flex;
  gap: 1rem;
  margin: 2rem 0;
  flex-wrap: wrap;
}

.badge {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  font-weight: 500;
  font-size: 0.9rem;
}

.badge-success {
  background-color: #10b981;
  color: white;
}

.badge-info {
  background-color: #3b82f6;
  color: white;
}
</style>
