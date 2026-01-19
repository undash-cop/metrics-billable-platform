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
      { text: 'Getting Started', link: '/getting-started/index' },
      { text: 'API Reference', link: '/api/index' },
      { text: 'Architecture', link: '/architecture/index' },
      { text: 'Operations', link: '/operations/index' },
      { text: 'Status', link: '/status/index' },
      { text: 'Security', link: '/architecture/security/index' },
    ],
    sidebar: {
      '/getting-started/': [
        { text: 'Getting Started', link: '/getting-started' },
        { text: 'Installation', link: '/getting-started/installation' },
        { text: 'Configuration', link: '/getting-started/configuration' },
        { text: 'First Steps', link: '/getting-started/first-steps' },
        { text: 'Deployment', link: '/getting-started/deployment' },
      ],
      '/api/': [
        { text: 'API Reference', link: '/api/index' },
        { text: 'Admin API', link: '/api/admin' },
        { text: 'Events API', link: '/api/events' },
        { text: 'Payments API', link: '/api/payments' },
      ],
      '/architecture/': [
        { text: 'Architecture', link: '/architecture/index' },
        { text: 'Data Flow', link: '/architecture/data-flow' },
        { text: 'Security', link: '/architecture/security' },
        { text: 'System Design', link: '/architecture/system-design' },
        { text: 'Database Schema', link: '/architecture/database-schema' },
      ],
      '/operations/': [
        { text: 'Operations', link: '/operations/index' },
        { text: 'Monitoring', link: '/operations/monitoring' },
        { text: 'Daily Operations', link: '/operations/daily' },
        { text: 'Disaster Recovery', link: '/operations/disaster-recovery' },
        { text: 'Troubleshooting', link: '/operations/troubleshooting' },
      ],
      '/status/': [
        { text: 'Status', link: '/status/index' },
        { text: 'Implementation Status', link: '/status/implementation' },
        { text: 'Production Ready', link: '/status/production-readiness' },
        { text: 'Next Steps', link: '/status/next-steps' },
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
