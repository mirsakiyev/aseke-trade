export type DecimalInput = string | number;
export type DecimalString = string & { readonly __decimalString: unique symbol };
export type DecimalRoundingMode = "toward-zero" | "floor" | "ceil" | "half-up";

export const AI_FUTURES_DECIMAL_PLACES = 18;
export const AI_FUTURES_DECIMAL_SCALE = 10n ** BigInt(AI_FUTURES_DECIMAL_PLACES);

const MAX_WHOLE_DIGITS = 48;
const decimalPattern = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/**
 * Parses a base-10 value into the fixed-point representation used by the AI
 * futures engines. Financial callers should pass strings so no precision has
 * already been lost to an IEEE-754 conversion.
 */
export function parseDecimal(value: unknown): bigint | null {
  const text = decimalInputToPlainString(value);
  if (text === null) return null;

  const match = decimalPattern.exec(text);
  if (!match) return null;

  const [, signText, wholeText, fractionText = ""] = match;
  if (wholeText.length > MAX_WHOLE_DIGITS || fractionText.length > AI_FUTURES_DECIMAL_PLACES) return null;

  const sign = signText === "-" ? -1n : 1n;
  const whole = BigInt(wholeText) * AI_FUTURES_DECIMAL_SCALE;
  const fraction = BigInt(fractionText.padEnd(AI_FUTURES_DECIMAL_PLACES, "0") || "0");
  return sign * (whole + fraction);
}

export function decimalToString(value: bigint): DecimalString {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / AI_FUTURES_DECIMAL_SCALE;
  const fraction = (absolute % AI_FUTURES_DECIMAL_SCALE)
    .toString()
    .padStart(AI_FUTURES_DECIMAL_PLACES, "0")
    .replace(/0+$/, "");

  return `${sign}${whole}${fraction ? `.${fraction}` : ""}` as DecimalString;
}

export function decimalAdd(first: bigint, second: bigint): bigint {
  return first + second;
}

export function decimalSubtract(first: bigint, second: bigint): bigint {
  return first - second;
}

export function decimalMultiply(
  first: bigint,
  second: bigint,
  rounding: DecimalRoundingMode = "toward-zero"
): bigint {
  return divideIntegers(first * second, AI_FUTURES_DECIMAL_SCALE, rounding);
}

export function decimalDivide(
  numerator: bigint,
  denominator: bigint,
  rounding: DecimalRoundingMode = "toward-zero"
): bigint | null {
  if (denominator === 0n) return null;
  return divideIntegers(numerator * AI_FUTURES_DECIMAL_SCALE, denominator, rounding);
}

export function decimalQuantize(
  value: bigint,
  step: bigint,
  rounding: DecimalRoundingMode = "floor"
): bigint | null {
  if (step <= 0n) return null;
  return divideIntegers(value, step, rounding) * step;
}

export function decimalAbs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function decimalMin(first: bigint, second: bigint): bigint {
  return first <= second ? first : second;
}

export function decimalMax(first: bigint, second: bigint): bigint {
  return first >= second ? first : second;
}

export function decimalFromInteger(value: number): bigint | null {
  return Number.isSafeInteger(value) ? BigInt(value) * AI_FUTURES_DECIMAL_SCALE : null;
}

export function decimalIsStepMultiple(value: bigint, step: bigint): boolean {
  return step > 0n && value % step === 0n;
}

function divideIntegers(numerator: bigint, denominator: bigint, rounding: DecimalRoundingMode): bigint {
  if (denominator === 0n) throw new Error("Cannot divide by zero.");

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || rounding === "toward-zero") return quotient;

  const sameSign = (numerator < 0n) === (denominator < 0n);
  if (rounding === "floor") return sameSign ? quotient : quotient - 1n;
  if (rounding === "ceil") return sameSign ? quotient + 1n : quotient;

  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  return absoluteRemainder * 2n >= absoluteDenominator
    ? quotient + (sameSign ? 1n : -1n)
    : quotient;
}

function decimalInputToPlainString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  return expandScientificNotation(text);
}

function expandScientificNotation(value: string): string | null {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(value);
  if (!match) return null;

  const [, sign, whole, fraction = "", exponentText] = match;
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent)) return null;

  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;
  const expanded = decimalIndex <= 0
    ? `0.${"0".repeat(-decimalIndex)}${digits}`
    : decimalIndex >= digits.length
      ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
      : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;

  return `${sign}${expanded}`;
}
