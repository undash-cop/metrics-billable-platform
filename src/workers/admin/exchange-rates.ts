import { Env } from '../../types/env.js';
import { createRdsPool } from '../../db/rds.js';
import {
  getActiveExchangeRates,
  getExchangeRate,
  updateExchangeRate,
  syncExchangeRates,
} from '../../services/currency-conversion.js';
import { formatError, ValidationError } from '../../utils/errors.js';
import { AdminAuthContext } from '../../services/admin-auth.js';
import { checkPermission } from '../../services/admin-auth.js';
import { z } from 'zod';
import { createLogger } from '../../utils/logger.js';
import { toDecimal } from '../../utils/decimal.js';

/**
 * Admin API: Exchange Rate Management
 * 
 * Provides endpoints for managing exchange rates.
 */

const UpdateExchangeRateSchema = z.object({
  baseCurrency: z.string().length(3).regex(/^[A-Z]{3}$/),
  targetCurrency: z.string().length(3).regex(/^[A-Z]{3}$/),
  rate: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num > 0;
  }, 'Rate must be a positive number'),
  source: z.enum(['manual', 'api', 'razorpay']).default('manual'),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Get Active Exchange Rates
 * 
 * GET /api/v1/admin/exchange-rates?baseCurrency=INR
 */
export async function handleGetExchangeRates(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'read');

    const url = new URL(request.url);
    const baseCurrency = url.searchParams.get('baseCurrency') || undefined;

    const rdsPool = createRdsPool(env);
    const rates = await getActiveExchangeRates(rdsPool, baseCurrency);

    return new Response(
      JSON.stringify({
        exchangeRates: rates.map((rate) => ({
          id: rate.id,
          baseCurrency: rate.baseCurrency,
          targetCurrency: rate.targetCurrency,
          rate: rate.rate,
          effectiveFrom: rate.effectiveFrom.toISOString(),
          effectiveTo: rate.effectiveTo?.toISOString() || null,
          source: rate.source,
          metadata: rate.metadata,
          updatedAt: rate.updatedAt.toISOString(),
        })),
        total: rates.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to get exchange rates', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Get Exchange Rate for Currency Pair
 * 
 * GET /api/v1/admin/exchange-rates/:baseCurrency/:targetCurrency
 */
export async function handleGetExchangeRate(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'read');

    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/\/exchange-rates\/([A-Z]{3})\/([A-Z]{3})/);
    if (!pathMatch || !pathMatch[1] || !pathMatch[2]) {
      throw new ValidationError('Invalid URL: baseCurrency and targetCurrency required (e.g., /exchange-rates/INR/USD)');
    }

    const baseCurrency = pathMatch[1];
    const targetCurrency = pathMatch[2];
    const atDate = url.searchParams.get('atDate')
      ? new Date(url.searchParams.get('atDate')!)
      : undefined;

    const rdsPool = createRdsPool(env);
    const rate = await getExchangeRate(rdsPool, baseCurrency, targetCurrency, atDate);

    if (!rate) {
      return new Response(
        JSON.stringify({
          error: `Exchange rate not found: ${baseCurrency} to ${targetCurrency}`,
          code: 'EXCHANGE_RATE_NOT_FOUND',
          statusCode: 404,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        baseCurrency,
        targetCurrency,
        rate: rate.toString(),
        atDate: atDate?.toISOString() || new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to get exchange rate', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Update Exchange Rate
 * 
 * POST /api/v1/admin/exchange-rates
 */
export async function handleUpdateExchangeRate(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'write');

    const body = await request.json();
    const parsedBody = UpdateExchangeRateSchema.parse(body);

    if (parsedBody.baseCurrency === parsedBody.targetCurrency) {
      throw new ValidationError('Base and target currency cannot be the same');
    }

    const rdsPool = createRdsPool(env);
    const rateId = await updateExchangeRate(
      rdsPool,
      parsedBody.baseCurrency,
      parsedBody.targetCurrency,
      toDecimal(parsedBody.rate),
      parsedBody.source,
      parsedBody.metadata
    );

    logger.info('Exchange rate updated', {
      baseCurrency: parsedBody.baseCurrency,
      targetCurrency: parsedBody.targetCurrency,
      rate: parsedBody.rate,
      source: parsedBody.source,
    });

    return new Response(
      JSON.stringify({
        id: rateId,
        baseCurrency: parsedBody.baseCurrency,
        targetCurrency: parsedBody.targetCurrency,
        rate: parsedBody.rate,
        source: parsedBody.source,
        message: 'Exchange rate updated successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to update exchange rate', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Sync Exchange Rates from External API
 * 
 * POST /api/v1/admin/exchange-rates/sync?baseCurrency=INR
 */
export async function handleSyncExchangeRates(
  request: Request,
  env: Env,
  authContext: AdminAuthContext
): Promise<Response> {
  const logger = createLogger(env);
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    checkPermission(authContext, 'write');

    const url = new URL(request.url);
    const baseCurrency = url.searchParams.get('baseCurrency') || 'INR';

    if (!baseCurrency.match(/^[A-Z]{3}$/)) {
      throw new ValidationError('Invalid base currency code');
    }

    const rdsPool = createRdsPool(env);
    const result = await syncExchangeRates(rdsPool, env, baseCurrency);

    logger.info('Exchange rates synced', {
      baseCurrency,
      updated: result.updated,
      failed: result.failed,
    });

    return new Response(
      JSON.stringify({
        baseCurrency,
        updated: result.updated,
        failed: result.failed,
        message: `Synced ${result.updated} exchange rates, ${result.failed} failed`,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const formattedError = formatError(error);
    logger.error('Failed to sync exchange rates', {
      error: formattedError.error,
      statusCode: formattedError.statusCode,
    });
    return new Response(JSON.stringify(formattedError), {
      status: formattedError.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
