import { defineConfig } from "vitepress";


export default defineConfig({
  base: '/',
  ignoreDeadLinks: true,
  title: 'Undash-cop Metrics Billing Platform',
  description: 'Documentation for the Undash-cop Metrics Billing Platform',
  themeConfig: {
    logo: '/assets/logo.svg',
    nav: [
      { text: 'Home', link: '/INDEX.md' },
      { text: 'Getting Started', link: '/getting-started/index.md' },
      { text: 'API Reference', link: '/api/index.md' },
      { text: 'Architecture', link: '/architecture/index.md' },
      { text: 'Operations', link: '/operations/index.md' },
      { text: 'Status', link: '/status/index.md' },
      { text: 'Security', link: '/architecture/security/index.md' },
    ],
    sidebar: {
      '/getting-started/': [
        { text: 'Getting Started', link: '/getting-started/index.md' },
        { text: 'Installation', link: '/getting-started/installation.md' },
        { text: 'Configuration', link: '/getting-started/configuration.md' },
        { text: 'First Steps', link: '/getting-started/first-steps.md' },
        { text: 'Deployment', link: '/getting-started/deployment.md' },
      ],
      '/api/': [
        { text: 'API Reference', link: '/api/index.md' },
        { text: 'Admin API', link: '/api/admin.md' },
        { text: 'Events API', link: '/api/events.md' },
        { text: 'Payments API', link: '/api/payments.md' },
        { text: 'Examples', link: '/api/examples.md' },
      ],
      '/architecture/': [
        { text: 'Architecture', link: '/architecture/index.md' },
        { text: 'Data Flow', link: '/architecture/data-flow.md' },
        { text: 'Security', link: '/architecture/security.md' },
        { text: 'System Design', link: '/architecture/system-design.md' },
        { text: 'Database Schema', link: '/architecture/database-schema.md' },
      ],
      '/operations/': [
        { text: 'Operations', link: '/operations/index.md' },
        { text: 'Monitoring', link: '/operations/monitoring.md' },
        { text: 'Daily Operations', link: '/operations/daily.md' },
        { text: 'Disaster Recovery', link: '/operations/disaster-recovery.md' },
        { text: 'Troubleshooting', link: '/operations/troubleshooting.md' },
      ],
      '/status/': [
        { text: 'Status', link: '/status/index.md' },
        { text: 'Implementation Status', link: '/status/implementation.md' },
        { text: 'Production Ready', link: '/status/production-readiness.md' },
        { text: 'Next Steps', link: '/status/next-steps.md' },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/undash-cop/metrics-billing-platform' },
    ],
    footer: {
      copyright: 'Copyright © 2026 Undash-cop Private Limited. All rights reserved.',
      message: 'Powered by Undash-cop',
    },
  },
});
