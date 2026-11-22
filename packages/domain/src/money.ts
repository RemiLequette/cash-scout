/**
 * Money is stored as integer minor units with an ISO 4217 currency code.
 * Never use floating point for amounts.
 */
export interface Money {
  /** Amount in minor units (cents for EUR, sen for MYR, units for JPY). */
  readonly minor: bigint;
  /** ISO 4217 code, upper case. */
  readonly currency: string;
}

const CURRENCY_CODE = /^[A-Z]{3}$/;

/** Number of decimals of a currency, from the runtime's ISO 4217 data. */
export function currencyDigits(currency: string): number {
  if (!CURRENCY_CODE.test(currency)) {
    throw new RangeError(`Invalid currency code: ${currency}`);
  }
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits as number;
}

export function money(minor: bigint, currency: string): Money {
  currencyDigits(currency);
  return { minor, currency };
}

/**
 * Parses a decimal amount written with a dot ("-1234.5") into minor units.
 * Rejects more decimals than the currency allows.
 */
export function parseAmount(text: string, currency: string): Money {
  const digits = currencyDigits(currency);
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) {
    throw new RangeError(`Invalid amount: ${text}`);
  }
  const [, sign = "", whole = "0", fraction = ""] = match;
  if (fraction.length > digits) {
    throw new RangeError(`${currency} allows ${digits} decimals: ${text}`);
  }
  const minor = BigInt(whole + fraction.padEnd(digits, "0"));
  return { minor: sign === "-" ? -minor : minor, currency };
}

/** Exact decimal string of an amount ("-1234.50"), for display and APIs. */
export function toDecimalString(amount: Money): string {
  const digits = currencyDigits(amount.currency);
  const negative = amount.minor < 0n;
  const abs = (negative ? -amount.minor : amount.minor).toString().padStart(digits + 1, "0");
  const whole = abs.slice(0, abs.length - digits);
  const fraction = abs.slice(abs.length - digits);
  return `${negative ? "-" : ""}${whole}${digits > 0 ? `.${fraction}` : ""}`;
}

/** Formats an amount for a locale, without going through floating point. */
export function formatMoney(amount: Money, locale: string): string {
  const format = new Intl.NumberFormat(locale, { style: "currency", currency: amount.currency });
  // Intl accepts exact decimal strings (Intl.NumberFormat v3).
  return format.format(toDecimalString(amount) as unknown as number);
}

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new RangeError(`Cannot add ${a.currency} and ${b.currency}`);
  }
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function sum(amounts: readonly Money[], currency: string): Money {
  return amounts.reduce((total, amount) => add(total, amount), money(0n, currency));
}

/** Integer division rounding half away from zero. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n + d / 2n) / d;
  return negative ? -quotient : quotient;
}

/**
 * Converts an amount with a rate given as a decimal string
 * (1 unit of the source currency = rate units of the target currency).
 * The result is rounded half away from zero to the target's minor unit.
 */
export function convert(amount: Money, rate: string, target: string): Money {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!match) {
    throw new RangeError(`Invalid rate: ${rate}`);
  }
  const [, whole = "0", fraction = ""] = match;
  const rateUnits = BigInt(whole + fraction);
  const rateScale = 10n ** BigInt(fraction.length);
  const sourceScale = 10n ** BigInt(currencyDigits(amount.currency));
  const targetScale = 10n ** BigInt(currencyDigits(target));
  const minor = divideRounded(amount.minor * rateUnits * targetScale, rateScale * sourceScale);
  return { minor, currency: target };
}
