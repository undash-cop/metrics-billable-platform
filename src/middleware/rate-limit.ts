/**
 * Rate Limiting Middleware
 * 
 * Implements rate limiting for admin endpoints to prevent brute force attacks.
 * Uses in-memory storage (D1 or KV could be used for distributed rate limiting).
 */

import { Env } from '../types/env.js';
import { ValidationError } from '../utils/errors.js';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyPrefix: string; // Prefix for rate limit key
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60, // 60 requests per minute
  keyPrefix: 'rate_limit',
};

/**
 * Rate limit storage (in-memory for now)
 * In production, use D1 or KV for distributed rate limiting
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Check rate limit for a request
 */
export async function checkRateLimit(
  env: Env,
  key: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
): Promise<void> {
  const now = Date.now();
  const storeKey = `${config.keyPrefix}:${key}`;

  // Get current rate limit state
  let state = rateLimitStore.get(storeKey);

  // Reset if window expired
  if (!state || now > state.resetAt) {
    state = {
      count: 0,
      resetAt: now + config.windowMs,
    };
  }

  // Increment count
  state.count++;

  // Check if limit exceeded
  if (state.count > config.maxRequests) {
    const retryAfter = Math.ceil((state.resetAt - now) / 1000);
    throw new ValidationError(
      `Rate limit exceeded. Maximum ${config.maxRequests} requests per ${config.windowMs / 1000} seconds. Retry after ${retryAfter} seconds.`,
      {
        retryAfter,
        limit: config.maxRequests,
        window: config.windowMs / 1000,
      }
    );
  }

  // Store updated state
  rateLimitStore.set(storeKey, state);

  // Clean up expired entries periodically (every 1000 requests)
  if (rateLimitStore.size > 1000) {
    for (const [key, value] of rateLimitStore.entries()) {
      if (now > value.resetAt) {
        rateLimitStore.delete(key);
      }
    }
  }
}

/**
 * Get rate limit key from request
 */
export function getRateLimitKey(
  request: Request,
  authContext?: { userId: string; ipAddress?: string }
): string {
  // Use user ID if available, otherwise use IP address
  if (authContext?.userId) {
    return `user:${authContext.userId}`;
  }

  const ipAddress =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0] ||
    'unknown';

  return `ip:${ipAddress}`;
}

/**
 * Admin endpoint rate limit config (stricter)
 */
export const ADMIN_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 requests per minute for admin endpoints
  keyPrefix: 'admin_rate_limit',
};

/**
 * Authentication endpoint rate limit config (very strict)
 */
export const AUTH_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 requests per 15 minutes for auth endpoints
  keyPrefix: 'auth_rate_limit',
};
