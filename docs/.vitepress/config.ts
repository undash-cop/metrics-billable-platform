import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Metrics Billing Platform',
  description: 'Production-ready, multi-tenant, usage-based billing platform',
  base: '/',
  
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started/' },
      { text: 'API Reference', link: '/api/' },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'Operations', link: '/operations/' },
      { text: 'Status', link: '/status/' }
    ],

    sidebar: {
      '/': [
        {
          text: 'Overview',
          items: [
            { text: 'Introduction', link: '/' },
            { text: 'Features', link: '/features' },
            { text: 'Quick Start', link: '/getting-started/' }
          ]
        }
      ],
      '/getting-started/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'Configuration', link: '/getting-started/configuration' },
            { text: 'First Steps', link: '/getting-started/first-steps' },
            { text: 'Deployment', link: '/getting-started/deployment' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'Event Ingestion', link: '/api/events' },
            { text: 'Admin API', link: '/api/admin' },
            { text: 'Payment API', link: '/api/payments' },
            { text: 'Examples', link: '/api/examples' }
          ]
        }
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/' },
            { text: 'System Design', link: '/architecture/system-design' },
            { text: 'Data Flow', link: '/architecture/data-flow' },
            { text: 'Database Schema', link: '/architecture/database-schema' },
            { text: 'Security', link: '/architecture/security' }
          ]
        }
      ],
      '/operations/': [
        {
          text: 'Operations',
          items: [
            { text: 'Overview', link: '/operations/' },
            { text: 'Daily Operations', link: '/operations/daily' },
            { text: 'Monitoring', link: '/operations/monitoring' },
            { text: 'Troubleshooting', link: '/operations/troubleshooting' },
            { text: 'Disaster Recovery', link: '/operations/disaster-recovery' }
          ]
        }
      ],
      '/status/': [
        {
          text: 'Project Status',
          items: [
            { text: 'Current Status', link: '/status/' },
            { text: 'Implementation Status', link: '/status/implementation' },
            { text: 'Production Readiness', link: '/status/production-readiness' },
            { text: 'Next Steps', link: '/status/next-steps' }
          ]
        }
      ]
    },

    socialLinks: [
      // Add your social links here
    ],

    footer: {
      message: 'Metrics Billing Platform Documentation',
      copyright: 'Copyright © 2024'
    },

    search: {
      provider: 'local'
    }
  }
})
