import { Env } from '../../types/env.js';
import { handleCreateOrganisation } from './organisations.js';
import {
  handleCreateProject,
  handleListProjects,
  handleGenerateApiKey,
} from './projects.js';
import { handleUsageSummary } from './usage.js';
import { handleListInvoices, handleGetInvoice, handleDownloadInvoicePdf } from './invoices.js';
import { handleListPayments } from './payments.js';
import {
  handleCreateRefund,
  handleGetRefund,
  handleListRefunds,
} from './refunds.js';
import {
  handleRetryPayment,
  handleGetRetryStatus,
  handleUpdateRetryConfig,
} from './payment-retry.js';
import {
  handleAnalyticsSummary,
  handleUsageTrends,
  handleCostBreakdown,
  handleRealTimeUsage,
  handleProjectUsageSummary,
} from './analytics.js';
import {
  handleCreateAlertRule,
  handleListAlertRules,
  handleGetAlertRule,
  handleUpdateAlertRule,
  handleDeleteAlertRule,
  handleGetAlertHistory,
} from './alerts.js';
import {
  handleCreateTemplate,
  handleListTemplates,
  handleGetTemplate,
  handleUpdateTemplate,
  handleDeleteTemplate,
  handlePreviewTemplate,
} from './invoice-templates.js';
import {
  handleGetExchangeRates,
  handleGetExchangeRate,
  handleUpdateExchangeRate,
  handleSyncExchangeRates,
} from './exchange-rates.js';
import {
  handleListEmailNotifications,
  handleGetEmailNotification,
} from './email-notifications.js';
import { authenticateAdmin } from '../../services/admin-auth.js';
import { checkRateLimit, getRateLimitKey, ADMIN_RATE_LIMIT_CONFIG } from '../../middleware/rate-limit.js';
import { formatError } from '../../utils/errors.js';

/**
 * Admin API Router
 * 
 * Routes admin dashboard API requests to appropriate handlers.
 * 
 * Security Features:
 * - Authentication via admin API keys
 * - Rate limiting to prevent brute force attacks
 * - Audit logging for all admin actions
 * - IP whitelisting (optional)
 */

export async function handleAdminApi(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);

  // Check IP whitelist if configured
  if (env.ADMIN_IP_WHITELIST) {
    const ipAddress =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For')?.split(',')[0] ||
      'unknown';
    
    const whitelist = env.ADMIN_IP_WHITELIST.split(',').map((ip) => ip.trim());
    
    if (!whitelist.includes(ipAddress)) {
      return new Response(
        JSON.stringify({
          error: 'Access denied: IP address not whitelisted',
          code: 'IP_WHITELIST_DENIED',
          statusCode: 403,
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // Authenticate request
  let authContext;
  try {
    authContext = await authenticateAdmin(request, env);
  } catch (error) {
    return new Response(
      JSON.stringify(formatError(error)),
      {
        status: error instanceof Error && 'statusCode' in error
          ? (error as { statusCode: number }).statusCode
          : 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Rate limiting
  try {
    const rateLimitKey = getRateLimitKey(request, authContext);
    await checkRateLimit(env, rateLimitKey, ADMIN_RATE_LIMIT_CONFIG);
  } catch (error) {
    return new Response(
      JSON.stringify(formatError(error)),
      {
        status: 429, // Too Many Requests
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': error instanceof Error && 'details' in error && typeof error.details === 'object' && error.details !== null && 'retryAfter' in error.details
            ? String((error.details as { retryAfter: number }).retryAfter)
            : '60',
        },
      }
    );
  }

  // Extract path after /api/v1/admin
  const pathMatch = url.pathname.match(/^\/api\/v1\/admin(.+)$/);
  if (!pathMatch) {
    return new Response('Not found', { status: 404 });
  }

  const path = pathMatch[1];

  // Route to appropriate handler
  try {
    // Organisations
    if (path === '/organisations' && request.method === 'POST') {
      return handleCreateOrganisation(request, env, authContext);
    }

    // Projects
    if (path.match(/^\/organisations\/[^/]+\/projects$/) && request.method === 'POST') {
      return handleCreateProject(request, env, authContext);
    }
    if (path.match(/^\/organisations\/[^/]+\/projects$/) && request.method === 'GET') {
      return handleListProjects(request, env, authContext);
    }
    if (path.match(/^\/projects\/[^/]+\/api-keys$/) && request.method === 'POST') {
      return handleGenerateApiKey(request, env, authContext);
    }

    // Usage
    if (path.match(/^\/organisations\/[^/]+\/usage$/) && request.method === 'GET') {
      return handleUsageSummary(request, env, authContext);
    }

    // Invoices (Read-Only)
    if (path.match(/^\/organisations\/[^/]+\/invoices$/) && request.method === 'GET') {
      return handleListInvoices(request, env, authContext);
    }
    if (path.match(/^\/invoices\/[^/]+\/pdf$/) && request.method === 'GET') {
      return handleDownloadInvoicePdf(request, env, authContext);
    }
    if (path.match(/^\/invoices\/[^/]+$/) && request.method === 'GET') {
      return handleGetInvoice(request, env, authContext);
    }

    // Payments (Read-Only)
    if (path.match(/^\/organisations\/[^/]+\/payments$/) && request.method === 'GET') {
      return handleListPayments(request, env, authContext);
    }

    // Refunds
    if (path.match(/^\/payments\/[^/]+\/refunds$/) && request.method === 'POST') {
      return handleCreateRefund(request, env, authContext);
    }
    if (path.match(/^\/payments\/[^/]+\/refunds$/) && request.method === 'GET') {
      return handleListRefunds(request, env, authContext);
    }
    if (path.match(/^\/refunds\/[^/]+$/) && request.method === 'GET') {
      return handleGetRefund(request, env, authContext);
    }

    // Payment Retry
    if (path.match(/^\/payments\/[^/]+\/retry$/) && request.method === 'POST') {
      return handleRetryPayment(request, env, authContext);
    }
    if (path.match(/^\/payments\/[^/]+\/retry-status$/) && request.method === 'GET') {
      return handleGetRetryStatus(request, env, authContext);
    }
    if (path.match(/^\/payments\/[^/]+\/retry-config$/) && request.method === 'PATCH') {
      return handleUpdateRetryConfig(request, env, authContext);
    }

    // Analytics
    if (path.match(/^\/organisations\/[^/]+\/analytics\/summary$/) && request.method === 'GET') {
      return handleAnalyticsSummary(request, env, authContext);
    }
    if (path.match(/^\/organisations\/[^/]+\/analytics\/trends$/) && request.method === 'GET') {
      return handleUsageTrends(request, env, authContext);
    }
    if (path.match(/^\/organisations\/[^/]+\/analytics\/cost-breakdown$/) && request.method === 'GET') {
      return handleCostBreakdown(request, env, authContext);
    }
    if (path.match(/^\/organisations\/[^/]+\/analytics\/realtime$/) && request.method === 'GET') {
      return handleRealTimeUsage(request, env, authContext);
    }
    if (path.match(/^\/projects\/[^/]+\/analytics\/summary$/) && request.method === 'GET') {
      return handleProjectUsageSummary(request, env, authContext);
    }

    // Alert Rules
    if (path.match(/^\/organisations\/[^/]+\/alert-rules$/) && request.method === 'POST') {
      return handleCreateAlertRule(request, env, authContext);
    }
    if (path.match(/^\/organisations\/[^/]+\/alert-rules$/) && request.method === 'GET') {
      return handleListAlertRules(request, env, authContext);
    }
    if (path.match(/^\/alert-rules\/[^/]+$/) && request.method === 'GET') {
      return handleGetAlertRule(request, env, authContext);
    }
    if (path.match(/^\/alert-rules\/[^/]+$/) && request.method === 'PATCH') {
      return handleUpdateAlertRule(request, env, authContext);
    }
    if (path.match(/^\/alert-rules\/[^/]+$/) && request.method === 'DELETE') {
      return handleDeleteAlertRule(request, env, authContext);
    }
    if (path.match(/^\/organisations\/[^/]+\/alert-history$/) && request.method === 'GET') {
      return handleGetAlertHistory(request, env, authContext);
    }

    // Invoice Templates
    if (path.match(/^\/organisations\/[^/]+\/invoice-templates$/) && request.method === 'POST') {
      return handleCreateTemplate(request, env, authContext);
    }
    if (path.match(/^\/organisations\/[^/]+\/invoice-templates$/) && request.method === 'GET') {
      return handleListTemplates(request, env, authContext);
    }
    if (path === '/invoice-templates' && request.method === 'POST') {
      return handleCreateTemplate(request, env, authContext);
    }
    if (path === '/invoice-templates' && request.method === 'GET') {
      return handleListTemplates(request, env, authContext);
    }
    if (path.match(/^\/invoice-templates\/[^/]+$/) && request.method === 'GET') {
      return handleGetTemplate(request, env, authContext);
    }
    if (path.match(/^\/invoice-templates\/[^/]+$/) && request.method === 'PATCH') {
      return handleUpdateTemplate(request, env, authContext);
    }
    if (path.match(/^\/invoice-templates\/[^/]+$/) && request.method === 'DELETE') {
      return handleDeleteTemplate(request, env, authContext);
    }
    if (path.match(/^\/invoice-templates\/[^/]+\/preview$/) && (request.method === 'GET' || request.method === 'POST')) {
      return handlePreviewTemplate(request, env, authContext);
    }

    // Exchange Rates
    if (path === '/exchange-rates' && request.method === 'GET') {
      return handleGetExchangeRates(request, env, authContext);
    }
    if (path.match(/^\/exchange-rates\/[A-Z]{3}\/[A-Z]{3}$/) && request.method === 'GET') {
      return handleGetExchangeRate(request, env, authContext);
    }
    if (path === '/exchange-rates' && request.method === 'POST') {
      return handleUpdateExchangeRate(request, env, authContext);
    }
    if (path === '/exchange-rates/sync' && request.method === 'POST') {
      return handleSyncExchangeRates(request, env, authContext);
    }

    // Email Notifications
    if (path.match(/^\/organisations\/[^/]+\/email-notifications$/) && request.method === 'GET') {
      return handleListEmailNotifications(request, env, authContext);
    }
    if (path.match(/^\/invoices\/[^/]+\/email-notifications$/) && request.method === 'GET') {
      return handleListEmailNotifications(request, env, authContext);
    }
    if (path.match(/^\/payments\/[^/]+\/email-notifications$/) && request.method === 'GET') {
      return handleListEmailNotifications(request, env, authContext);
    }
    if (path.match(/^\/email-notifications\/[^/]+$/) && request.method === 'GET') {
      return handleGetEmailNotification(request, env, authContext);
    }

    return new Response('Not found', { status: 404 });
  } catch (error) {
    // Error handling is done in individual handlers
    throw error;
  }
}
