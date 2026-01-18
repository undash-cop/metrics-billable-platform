# Getting Started

Welcome to the Undash-cop Metrics Billing Platform! This guide will help you get started quickly.

**Copyright © 2026 Undash-cop Private Limited. All rights reserved.**

## Quick Start

1. **[Installation](/getting-started/installation)** - Set up the platform
2. **[Configuration](/getting-started/configuration)** - Configure your environment
3. **[First Steps](/getting-started/first-steps)** - Create your first organisation and project
4. **[Deployment](/getting-started/deployment)** - Deploy to production

## What You'll Need

- Node.js 18+
- PostgreSQL database (RDS or local)
- Cloudflare account
- Razorpay account (for payments)

## Overview

The Metrics Billing Platform is a production-ready, multi-tenant billing system that:

- Ingests usage events from your applications
- Aggregates usage by metric
- Generates monthly invoices automatically
- Processes payments via Razorpay
- Provides an admin dashboard

## Architecture

```
Client Apps → Cloudflare Workers → D1 (Hot Storage) → Queues → RDS (Financial SOT)
                                                              ↓
                                                         Razorpay (Payments)
```

## Next Steps

- [Installation Guide](/getting-started/installation)
- [API Reference](/api/)
- [Architecture Overview](/architecture/)
