import Decimal from 'decimal.js';

/**
 * Utilities for safe decimal arithmetic.
 * All monetary calculations MUST use these utilities.
 */

/**
 * Parse a string or number to Decimal safely
 */
export function toDecimal(value: string | number | Decimal): Decimal {
  if (value instanceof Decimal) {
    return value;
  }
  return new Decimal(value);
}

/**
 * Add two decimal values
 */
export function add(a: string | number | Decimal, b: string | number | Decimal): Decimal {
  return toDecimal(a).plus(toDecimal(b));
}

/**
 * Subtract two decimal values
 */
export function subtract(a: string | number | Decimal, b: string | number | Decimal): Decimal {
  return toDecimal(a).minus(toDecimal(b));
}

/**
 * Multiply two decimal values
 */
export function multiply(a: string | number | Decimal, b: string | number | Decimal): Decimal {
  return toDecimal(a).times(toDecimal(b));
}

/**
 * Divide two decimal values
 */
export function divide(a: string | number | Decimal, b: string | number | Decimal): Decimal {
  const divisor = toDecimal(b);
  if (divisor.isZero()) {
    throw new Error('Division by zero');
  }
  return toDecimal(a).div(divisor);
}

/**
 * Format decimal as string with fixed precision (for storage)
 */
export function toFixedString(value: Decimal | string | number, precision: number = 2): string {
  return toDecimal(value).toFixed(precision);
}

/**
 * Compare two decimal values
 */
export function compare(a: string | number | Decimal, b: string | number | Decimal): number {
  return toDecimal(a).comparedTo(toDecimal(b));
}

/**
 * Check if value is zero
 */
export function isZero(value: string | number | Decimal): boolean {
  return toDecimal(value).isZero();
}

/**
 * Check if value is negative
 */
export function isNegative(value: string | number | Decimal): boolean {
  return toDecimal(value).isNegative();
}

/**
 * Get maximum of two decimal values
 */
export function max(a: string | number | Decimal, b: string | number | Decimal): Decimal {
  const aDec = toDecimal(a);
  const bDec = toDecimal(b);
  return aDec.gte(bDec) ? aDec : bDec;
}
