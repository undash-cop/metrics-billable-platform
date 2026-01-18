import pg from 'pg';
import { Env } from '../types/env.js';
import { queryRds } from '../db/rds.js';
import { createLogger } from '../utils/logger.js';
import Decimal from 'decimal.js';
import { toDecimal, toFixedString } from '../utils/decimal.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

/**
 * Currency Conversion Service
 * 
 * Handles currency conversion using exchange rates.
 * Supports:
 * - Fetching exchange rates from database
 * - Fetching exchange rates from external API
 * - Converting amounts between currencies
 * - Updating exchange rates
 */

export interface ExchangeRate {
  id: string;
  baseCurrency: string;
  targetCurrency: string;
  rate: string; // Decimal string
  effectiveFrom: Date;
  effectiveTo?: Date;
  source: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Get exchange rate between two currencies
 */
export async function getExchangeRate(
  pool: pg.Pool,
  fromCurrency: string,
  toCurrency: string,
  atDate?: Date
): Promise<Decimal | null> {
  if (fromCurrency === toCurrency) {
    return new Decimal(1);
  }

  const date = atDate || new Date();

  // Try direct rate
  const result = await queryRds<{ rate: string }>(
    pool,
    `SELECT get_exchange_rate($1, $2, $3) as rate`,
    [fromCurrency, toCurrency, date]
  );

  const rate = result.rows[0]?.rate;
  if (!rate) {
    return null;
  }

  return toDecimal(rate);
}

/**
 * Convert amount from one currency to another
 */
export async function convertCurrency(
  pool: pg.Pool,
  amount: Decimal | string,
  fromCurrency: string,
  toCurrency: string,
  atDate?: Date
): Promise<Decimal | null> {
  const amountDecimal = typeof amount === 'string' ? toDecimal(amount) : amount;

  if (fromCurrency === toCurrency) {
    return amountDecimal;
  }

  const rate = await getExchangeRate(pool, fromCurrency, toCurrency, atDate);
  if (!rate) {
    return null;
  }

  return amountDecimal.mul(rate);
}

/**
 * Get organisation currency
 */
export async function getOrganisationCurrency(
  pool: pg.Pool,
  organisationId: string
): Promise<string> {
  const result = await queryRds<{ currency: string }>(
    pool,
    `SELECT currency FROM organisations WHERE id = $1`,
    [organisationId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError(`Organisation not found: ${organisationId}`);
  }

  return result.rows[0].currency || 'INR';
}

/**
 * Fetch exchange rate from external API
 */
export async function fetchExchangeRateFromAPI(
  env: Env,
  fromCurrency: string,
  toCurrency: string
): Promise<Decimal | null> {
  const logger = createLogger(env);

  if (!env.EXCHANGE_RATE_API_KEY) {
    logger.warn('Exchange rate API key not configured');
    return null;
  }

  const apiUrl = env.EXCHANGE_RATE_API_URL || 'https://api.exchangerate-api.com/v4/latest';

  try {
    // Example: Using exchangerate-api.com (free tier)
    // Format: GET https://api.exchangerate-api.com/v4/latest/{base_currency}
    const response = await fetch(`${apiUrl}/${fromCurrency}`, {
      headers: {
        'Authorization': `Bearer ${env.EXCHANGE_RATE_API_KEY}`,
      },
    });

    if (!response.ok) {
      logger.error('Failed to fetch exchange rate from API', {
        fromCurrency,
        toCurrency,
        statusCode: response.status,
      });
      return null;
    }

    const data = await response.json();
    const rate = data.rates?.[toCurrency];

    if (!rate) {
      logger.warn('Exchange rate not found in API response', {
        fromCurrency,
        toCurrency,
        availableRates: Object.keys(data.rates || {}),
      });
      return null;
    }

    return toDecimal(String(rate));
  } catch (error) {
    logger.error('Error fetching exchange rate from API', {
      fromCurrency,
      toCurrency,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Update exchange rate in database
 */
export async function updateExchangeRate(
  pool: pg.Pool,
  baseCurrency: string,
  targetCurrency: string,
  rate: Decimal | string,
  source: string = 'manual',
  metadata?: Record<string, unknown>
): Promise<string> {
  if (baseCurrency === targetCurrency) {
    throw new ValidationError('Base and target currency cannot be the same');
  }

  const rateDecimal = typeof rate === 'string' ? toDecimal(rate) : rate;

  if (rateDecimal.lessThanOrEqualTo(0)) {
    throw new ValidationError('Exchange rate must be greater than zero');
  }

  const result = await queryRds<{ id: string }>(
    pool,
    `SELECT update_exchange_rate($1, $2, $3, $4, $5) as id`,
    [
      baseCurrency,
      targetCurrency,
      toFixedString(rateDecimal, 8),
      source,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  return result.rows[0].id;
}

/**
 * Get all active exchange rates
 */
export async function getActiveExchangeRates(
  pool: pg.Pool,
  baseCurrency?: string
): Promise<ExchangeRate[]> {
  let query = `
    SELECT id, base_currency, target_currency, rate,
           effective_from, effective_to, source, metadata,
           created_at, updated_at
    FROM active_exchange_rates
  `;
  const params: unknown[] = [];

  if (baseCurrency) {
    query += ` WHERE base_currency = $1`;
    params.push(baseCurrency);
  }

  query += ` ORDER BY base_currency, target_currency`;

  const result = await queryRds<ExchangeRate>(pool, query, params);

  return result.rows.map((row) => ({
    id: row.id,
    baseCurrency: row.base_currency,
    targetCurrency: row.target_currency,
    rate: row.rate.toString(),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || undefined,
    source: row.source,
    metadata: row.metadata || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Sync exchange rates from external API
 * Updates rates for common currency pairs
 */
export async function syncExchangeRates(
  pool: pg.Pool,
  env: Env,
  baseCurrency: string = 'INR'
): Promise<{ updated: number; failed: number }> {
  const logger = createLogger(env);
  const commonCurrencies = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CNY', 'AUD', 'CAD', 'SGD'];

  let updated = 0;
  let failed = 0;

  for (const targetCurrency of commonCurrencies) {
    if (targetCurrency === baseCurrency) {
      continue;
    }

    try {
      const rate = await fetchExchangeRateFromAPI(env, baseCurrency, targetCurrency);
      if (rate) {
        await updateExchangeRate(
          pool,
          baseCurrency,
          targetCurrency,
          rate,
          'api',
          {
            syncedAt: new Date().toISOString(),
            source: 'external_api',
          }
        );
        updated++;
        logger.info('Exchange rate updated', {
          baseCurrency,
          targetCurrency,
          rate: rate.toString(),
        });
      } else {
        failed++;
      }
    } catch (error) {
      failed++;
      logger.error('Failed to sync exchange rate', {
        baseCurrency,
        targetCurrency,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { updated, failed };
}

/**
 * Convert pricing plan to organisation currency
 */
export async function convertPricingPlanToCurrency(
  pool: pg.Pool,
  pricingPlan: {
    pricePerUnit: string;
    currency: string;
  },
  targetCurrency: string,
  atDate?: Date
): Promise<{
  pricePerUnit: string;
  currency: string;
  originalCurrency: string;
  exchangeRate: string;
}> {
  if (pricingPlan.currency === targetCurrency) {
    return {
      pricePerUnit: pricingPlan.pricePerUnit,
      currency: targetCurrency,
      originalCurrency: pricingPlan.currency,
      exchangeRate: '1.0',
    };
  }

  const convertedPrice = await convertCurrency(
    pool,
    pricingPlan.pricePerUnit,
    pricingPlan.currency,
    targetCurrency,
    atDate
  );

  if (!convertedPrice) {
    throw new Error(
      `Exchange rate not found: ${pricingPlan.currency} to ${targetCurrency}`
    );
  }

  const rate = await getExchangeRate(
    pool,
    pricingPlan.currency,
    targetCurrency,
    atDate
  );

  return {
    pricePerUnit: toFixedString(convertedPrice, 8),
    currency: targetCurrency,
    originalCurrency: pricingPlan.currency,
    exchangeRate: rate ? toFixedString(rate, 8) : '1.0',
  };
}
