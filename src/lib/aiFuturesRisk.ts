import {
  decimalAbs,
  decimalAdd,
  decimalDivide,
  decimalFromInteger,
  decimalMin,
  decimalMultiply,
  decimalQuantize,
  decimalSubtract,
  decimalToString,
  parseDecimal,
  type DecimalInput,
  type DecimalString
} from "./aiFuturesDecimal.ts";

export type AiFuturesDirection = "long" | "short";

export interface AiFuturesRiskInput {
  direction: AiFuturesDirection;
  planningBalance: DecimalInput;
  riskPercent: DecimalInput;
  entryPrice: DecimalInput;
  stopLossPrice: DecimalInput;
  entryFeePercent?: DecimalInput;
  exitFeePercent?: DecimalInput;
  slippageBufferPercent?: DecimalInput;
  maximumMarginPercent: DecimalInput;
  leverage: string | number;
  maximumLeverage?: string | number;
  quantityStep: DecimalInput;
  priceTickSize: DecimalInput;
  minimumQuantity?: DecimalInput;
  minimumNotional?: DecimalInput;
  maintenanceMarginPercent?: DecimalInput;
}

export type AiFuturesRiskLimitReason =
  | "QUANTITY_ROUNDED_TO_ZERO"
  | "BELOW_MINIMUM_QUANTITY"
  | "BELOW_MINIMUM_NOTIONAL"
  | "RISK_BUDGET_EXCEEDED_AFTER_ROUNDING"
  | "MARGIN_LIMIT_EXCEEDED_AFTER_ROUNDING"
  | "LIQUIDATION_BEFORE_STOP";

export interface AiFuturesRiskPlan {
  direction: AiFuturesDirection;
  planningBalance: DecimalString;
  riskPercent: DecimalString;
  riskBudget: DecimalString;
  entryPrice: DecimalString;
  stopLossPrice: DecimalString;
  stopDistance: DecimalString;
  stopDistancePercent: DecimalString;
  entryFeePercent: DecimalString;
  exitFeePercent: DecimalString;
  slippageBufferPercent: DecimalString;
  lossFraction: DecimalString;
  maximumMarginPercent: DecimalString;
  maximumMarginAmount: DecimalString;
  riskLimitedNotional: DecimalString;
  marginLimitedNotional: DecimalString;
  quantity: DecimalString;
  positionNotional: DecimalString;
  requiredIsolatedMargin: DecimalString;
  stopLossAmount: DecimalString;
  estimatedEntryFee: DecimalString;
  estimatedExitFee: DecimalString;
  estimatedSlippageLoss: DecimalString;
  maximumPlannedLoss: DecimalString;
  estimatedLiquidationPrice: DecimalString | null;
  leverage: number;
  quantityStep: DecimalString;
  priceTickSize: DecimalString;
}

export type AiFuturesRiskCalculation =
  | { status: "OK"; plan: AiFuturesRiskPlan }
  | { status: "INVALID_INPUT"; errors: string[] }
  | { status: "RISK_LIMIT_EXCEEDED"; reason: AiFuturesRiskLimitReason; message: string };

const ONE_HUNDRED = parseRequiredConstant("100");
const DEFAULT_MAINTENANCE_MARGIN_PERCENT = "0.5";
const ABSOLUTE_MAX_LEVERAGE = 100;

interface ParsedRiskInput {
  planningBalance: bigint;
  riskPercent: bigint;
  entryPrice: bigint;
  stopLossPrice: bigint;
  entryFeePercent: bigint;
  exitFeePercent: bigint;
  slippageBufferPercent: bigint;
  maximumMarginPercent: bigint;
  quantityStep: bigint;
  priceTickSize: bigint;
  minimumQuantity: bigint;
  minimumNotional: bigint;
  maintenanceMarginPercent: bigint;
  leverage: number;
  maximumLeverage: number;
}

interface LossAmounts {
  stopLossAmount: bigint;
  entryFee: bigint;
  exitFee: bigint;
  slippage: bigint;
  total: bigint;
}

export function calculateAiFuturesRiskPlan(input: AiFuturesRiskInput): AiFuturesRiskCalculation {
  const parsed = parseRiskInput(input);
  if ("errors" in parsed) return { status: "INVALID_INPUT", errors: parsed.errors };

  const entryPrice = quantizePrice(
    parsed.entryPrice,
    parsed.priceTickSize,
    input.direction === "long" ? "ceil" : "floor"
  );
  const stopLossPrice = quantizePrice(
    parsed.stopLossPrice,
    parsed.priceTickSize,
    input.direction === "long" ? "floor" : "ceil"
  );

  if (entryPrice <= 0n || stopLossPrice <= 0n) {
    return { status: "INVALID_INPUT", errors: ["Entry and stop loss must remain greater than zero after tick rounding."] };
  }
  if (input.direction === "long" && stopLossPrice >= entryPrice) {
    return { status: "INVALID_INPUT", errors: ["For a long setup, stop loss must be below entry after tick rounding."] };
  }
  if (input.direction === "short" && stopLossPrice <= entryPrice) {
    return { status: "INVALID_INPUT", errors: ["For a short setup, stop loss must be above entry after tick rounding."] };
  }

  const riskFraction = percentToFraction(parsed.riskPercent, "floor");
  const marginFraction = percentToFraction(parsed.maximumMarginPercent, "floor");
  const entryFeeFraction = percentToFraction(parsed.entryFeePercent, "ceil");
  const exitFeeFraction = percentToFraction(parsed.exitFeePercent, "ceil");
  const slippageFraction = percentToFraction(parsed.slippageBufferPercent, "ceil");
  const stopDistance = decimalAbs(decimalSubtract(entryPrice, stopLossPrice));
  const stopDistanceFraction = decimalDivide(stopDistance, entryPrice, "ceil");
  if (stopDistanceFraction === null) {
    return { status: "INVALID_INPUT", errors: ["Entry price must be greater than zero."] };
  }

  const lossFraction = decimalAdd(
    decimalAdd(stopDistanceFraction, entryFeeFraction),
    decimalAdd(exitFeeFraction, slippageFraction)
  );
  if (lossFraction <= 0n) {
    return { status: "INVALID_INPUT", errors: ["The planned loss fraction must be greater than zero."] };
  }

  const riskBudget = decimalMultiply(parsed.planningBalance, riskFraction, "floor");
  const maximumMarginAmount = decimalMultiply(parsed.planningBalance, marginFraction, "floor");
  const riskLimitedNotional = decimalDivide(riskBudget, lossFraction, "floor");
  const leverageDecimal = decimalFromInteger(parsed.leverage);
  if (riskLimitedNotional === null || leverageDecimal === null) {
    return { status: "INVALID_INPUT", errors: ["Risk inputs could not be calculated."] };
  }
  const marginLimitedNotional = decimalMultiply(maximumMarginAmount, leverageDecimal, "floor");
  const finalNotional = decimalMin(riskLimitedNotional, marginLimitedNotional);
  const rawQuantity = decimalDivide(finalNotional, entryPrice, "floor");
  let quantity = rawQuantity === null ? 0n : decimalQuantize(rawQuantity, parsed.quantityStep, "floor") ?? 0n;

  if (quantity <= 0n) return riskLimit("QUANTITY_ROUNDED_TO_ZERO");

  // Conservative rounding of individual loss components can add a few final
  // fixed-point units. Reduce by one exchange step until all hard limits hold.
  let positionNotional = 0n;
  let requiredMargin = 0n;
  let losses: LossAmounts = emptyLossAmounts();
  let attempts = 0;
  while (quantity > 0n && attempts < 4) {
    positionNotional = decimalMultiply(quantity, entryPrice, "floor");
    const margin = decimalDivide(positionNotional, leverageDecimal, "ceil");
    requiredMargin = margin ?? 0n;
    losses = calculateLossAmounts(
      quantity,
      stopDistance,
      positionNotional,
      entryFeeFraction,
      exitFeeFraction,
      slippageFraction
    );

    if (losses.total <= riskBudget && requiredMargin <= maximumMarginAmount) break;
    quantity = decimalSubtract(quantity, parsed.quantityStep);
    attempts += 1;
  }

  if (quantity <= 0n) return riskLimit("QUANTITY_ROUNDED_TO_ZERO");
  if (losses.total > riskBudget) return riskLimit("RISK_BUDGET_EXCEEDED_AFTER_ROUNDING");
  if (requiredMargin > maximumMarginAmount) return riskLimit("MARGIN_LIMIT_EXCEEDED_AFTER_ROUNDING");
  if (quantity < parsed.minimumQuantity) return riskLimit("BELOW_MINIMUM_QUANTITY");
  if (positionNotional < parsed.minimumNotional) return riskLimit("BELOW_MINIMUM_NOTIONAL");

  const maintenanceMarginFraction = percentToFraction(parsed.maintenanceMarginPercent, "ceil");
  const liquidationPrice = estimateLiquidationPrice({
    direction: input.direction,
    entryPrice,
    quantity,
    isolatedMargin: requiredMargin,
    maintenanceMarginFraction,
    priceTickSize: parsed.priceTickSize
  });
  const liquidationBeforeStop = liquidationPrice !== null && (
    input.direction === "long" ? liquidationPrice >= stopLossPrice : liquidationPrice <= stopLossPrice
  );
  if (liquidationBeforeStop) return riskLimit("LIQUIDATION_BEFORE_STOP");

  return {
    status: "OK",
    plan: {
      direction: input.direction,
      planningBalance: decimalToString(parsed.planningBalance),
      riskPercent: decimalToString(parsed.riskPercent),
      riskBudget: decimalToString(riskBudget),
      entryPrice: decimalToString(entryPrice),
      stopLossPrice: decimalToString(stopLossPrice),
      stopDistance: decimalToString(stopDistance),
      stopDistancePercent: decimalToString(decimalMultiply(stopDistanceFraction, ONE_HUNDRED, "ceil")),
      entryFeePercent: decimalToString(parsed.entryFeePercent),
      exitFeePercent: decimalToString(parsed.exitFeePercent),
      slippageBufferPercent: decimalToString(parsed.slippageBufferPercent),
      lossFraction: decimalToString(lossFraction),
      maximumMarginPercent: decimalToString(parsed.maximumMarginPercent),
      maximumMarginAmount: decimalToString(maximumMarginAmount),
      riskLimitedNotional: decimalToString(riskLimitedNotional),
      marginLimitedNotional: decimalToString(marginLimitedNotional),
      quantity: decimalToString(quantity),
      positionNotional: decimalToString(positionNotional),
      requiredIsolatedMargin: decimalToString(requiredMargin),
      stopLossAmount: decimalToString(losses.stopLossAmount),
      estimatedEntryFee: decimalToString(losses.entryFee),
      estimatedExitFee: decimalToString(losses.exitFee),
      estimatedSlippageLoss: decimalToString(losses.slippage),
      maximumPlannedLoss: decimalToString(losses.total),
      estimatedLiquidationPrice: liquidationPrice === null ? null : decimalToString(liquidationPrice),
      leverage: parsed.leverage,
      quantityStep: decimalToString(parsed.quantityStep),
      priceTickSize: decimalToString(parsed.priceTickSize)
    }
  };
}

function parseRiskInput(input: AiFuturesRiskInput): ParsedRiskInput | { errors: string[] } {
  const errors: string[] = [];
  if (input.direction !== "long" && input.direction !== "short") errors.push("Direction must be long or short.");

  const values = {
    planningBalance: parseDecimalField(input.planningBalance, "Planning balance", errors),
    riskPercent: parseDecimalField(input.riskPercent, "Risk percent", errors),
    entryPrice: parseDecimalField(input.entryPrice, "Entry price", errors),
    stopLossPrice: parseDecimalField(input.stopLossPrice, "Stop loss price", errors),
    entryFeePercent: parseDecimalField(input.entryFeePercent ?? "0", "Entry fee percent", errors),
    exitFeePercent: parseDecimalField(input.exitFeePercent ?? "0", "Exit fee percent", errors),
    slippageBufferPercent: parseDecimalField(input.slippageBufferPercent ?? "0", "Slippage buffer percent", errors),
    maximumMarginPercent: parseDecimalField(input.maximumMarginPercent, "Maximum margin percent", errors),
    quantityStep: parseDecimalField(input.quantityStep, "Quantity step", errors),
    priceTickSize: parseDecimalField(input.priceTickSize, "Price tick size", errors),
    minimumQuantity: parseDecimalField(input.minimumQuantity ?? input.quantityStep, "Minimum quantity", errors),
    minimumNotional: parseDecimalField(input.minimumNotional ?? "0", "Minimum notional", errors),
    maintenanceMarginPercent: parseDecimalField(
      input.maintenanceMarginPercent ?? DEFAULT_MAINTENANCE_MARGIN_PERCENT,
      "Maintenance margin percent",
      errors
    )
  };
  const leverage = parseInteger(input.leverage);
  const maximumLeverage = parseInteger(input.maximumLeverage ?? ABSOLUTE_MAX_LEVERAGE);

  if (leverage === null) errors.push("Leverage must be a whole number.");
  if (maximumLeverage === null || maximumLeverage < 1 || maximumLeverage > ABSOLUTE_MAX_LEVERAGE) {
    errors.push(`Maximum leverage must be a whole number from 1 to ${ABSOLUTE_MAX_LEVERAGE}.`);
  } else if (leverage !== null && (leverage < 1 || leverage > maximumLeverage)) {
    errors.push(`Leverage must be from 1 to ${maximumLeverage}.`);
  }

  requireGreaterThanZero(values.planningBalance, "Planning balance", errors);
  requirePercentAboveZero(values.riskPercent, "Risk percent", errors);
  requireGreaterThanZero(values.entryPrice, "Entry price", errors);
  requireGreaterThanZero(values.stopLossPrice, "Stop loss price", errors);
  requireNonNegativePercent(values.entryFeePercent, "Entry fee percent", errors);
  requireNonNegativePercent(values.exitFeePercent, "Exit fee percent", errors);
  requireNonNegativePercent(values.slippageBufferPercent, "Slippage buffer percent", errors);
  requirePercentAboveZero(values.maximumMarginPercent, "Maximum margin percent", errors);
  requireGreaterThanZero(values.quantityStep, "Quantity step", errors);
  requireGreaterThanZero(values.priceTickSize, "Price tick size", errors);
  requireGreaterThanZero(values.minimumQuantity, "Minimum quantity", errors);
  requireNonNegative(values.minimumNotional, "Minimum notional", errors);
  requireNonNegativePercent(values.maintenanceMarginPercent, "Maintenance margin percent", errors);

  if (errors.length || leverage === null || maximumLeverage === null || Object.values(values).some((value) => value === null)) {
    return { errors: [...new Set(errors)] };
  }

  return {
    planningBalance: values.planningBalance!,
    riskPercent: values.riskPercent!,
    entryPrice: values.entryPrice!,
    stopLossPrice: values.stopLossPrice!,
    entryFeePercent: values.entryFeePercent!,
    exitFeePercent: values.exitFeePercent!,
    slippageBufferPercent: values.slippageBufferPercent!,
    maximumMarginPercent: values.maximumMarginPercent!,
    quantityStep: values.quantityStep!,
    priceTickSize: values.priceTickSize!,
    minimumQuantity: values.minimumQuantity!,
    minimumNotional: values.minimumNotional!,
    maintenanceMarginPercent: values.maintenanceMarginPercent!,
    leverage,
    maximumLeverage
  };
}

function calculateLossAmounts(
  quantity: bigint,
  stopDistance: bigint,
  notional: bigint,
  entryFeeFraction: bigint,
  exitFeeFraction: bigint,
  slippageFraction: bigint
): LossAmounts {
  const stopLossAmount = decimalMultiply(quantity, stopDistance, "ceil");
  const entryFee = decimalMultiply(notional, entryFeeFraction, "ceil");
  const exitFee = decimalMultiply(notional, exitFeeFraction, "ceil");
  const slippage = decimalMultiply(notional, slippageFraction, "ceil");
  return {
    stopLossAmount,
    entryFee,
    exitFee,
    slippage,
    total: decimalAdd(decimalAdd(stopLossAmount, entryFee), decimalAdd(exitFee, slippage))
  };
}

function estimateLiquidationPrice(input: {
  direction: AiFuturesDirection;
  entryPrice: bigint;
  quantity: bigint;
  isolatedMargin: bigint;
  maintenanceMarginFraction: bigint;
  priceTickSize: bigint;
}): bigint | null {
  const entryNotional = decimalMultiply(input.entryPrice, input.quantity, "floor");
  const one = parseRequiredConstant("1");
  const maintenanceAdjustment = input.direction === "long"
    ? decimalSubtract(one, input.maintenanceMarginFraction)
    : decimalAdd(one, input.maintenanceMarginFraction);
  const denominator = decimalMultiply(input.quantity, maintenanceAdjustment, "floor");
  if (denominator <= 0n) return null;

  const numerator = input.direction === "long"
    ? decimalSubtract(entryNotional, input.isolatedMargin)
    : decimalAdd(entryNotional, input.isolatedMargin);
  if (numerator <= 0n) return null;

  const rawPrice = decimalDivide(
    numerator,
    denominator,
    input.direction === "long" ? "ceil" : "floor"
  );
  if (rawPrice === null || rawPrice <= 0n) return null;
  return decimalQuantize(rawPrice, input.priceTickSize, input.direction === "long" ? "ceil" : "floor");
}

function quantizePrice(value: bigint, tick: bigint, rounding: "floor" | "ceil"): bigint {
  return decimalQuantize(value, tick, rounding) ?? 0n;
}

function percentToFraction(value: bigint, rounding: "floor" | "ceil"): bigint {
  return decimalDivide(value, ONE_HUNDRED, rounding) ?? 0n;
}

function parseDecimalField(value: unknown, label: string, errors: string[]): bigint | null {
  const parsed = parseDecimal(value);
  if (parsed === null) errors.push(`${label} must be a finite base-10 number with no more than 18 decimal places.`);
  return parsed;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function requireGreaterThanZero(value: bigint | null, label: string, errors: string[]): void {
  if (value !== null && value <= 0n) errors.push(`${label} must be greater than zero.`);
}

function requireNonNegative(value: bigint | null, label: string, errors: string[]): void {
  if (value !== null && value < 0n) errors.push(`${label} cannot be negative.`);
}

function requirePercentAboveZero(value: bigint | null, label: string, errors: string[]): void {
  if (value !== null && (value <= 0n || value > ONE_HUNDRED)) {
    errors.push(`${label} must be greater than zero and no more than 100.`);
  }
}

function requireNonNegativePercent(value: bigint | null, label: string, errors: string[]): void {
  if (value !== null && (value < 0n || value >= ONE_HUNDRED)) {
    errors.push(`${label} must be at least zero and less than 100.`);
  }
}

function emptyLossAmounts(): LossAmounts {
  return { stopLossAmount: 0n, entryFee: 0n, exitFee: 0n, slippage: 0n, total: 0n };
}

function riskLimit(reason: AiFuturesRiskLimitReason): AiFuturesRiskCalculation {
  const messages: Record<AiFuturesRiskLimitReason, string> = {
    QUANTITY_ROUNDED_TO_ZERO: "The risk and margin limits are too small to create one valid quantity step.",
    BELOW_MINIMUM_QUANTITY: "The calculated quantity is below the exchange minimum.",
    BELOW_MINIMUM_NOTIONAL: "The calculated position notional is below the exchange minimum.",
    RISK_BUDGET_EXCEEDED_AFTER_ROUNDING: "A step-rounded quantity could not stay within the risk budget.",
    MARGIN_LIMIT_EXCEEDED_AFTER_ROUNDING: "A step-rounded quantity could not stay within the margin allocation limit.",
    LIQUIDATION_BEFORE_STOP: "Estimated liquidation would occur before the planned stop loss."
  };
  return { status: "RISK_LIMIT_EXCEEDED", reason, message: messages[reason] };
}

function parseRequiredConstant(value: string): bigint {
  const parsed = parseDecimal(value);
  if (parsed === null) throw new Error(`Invalid decimal constant: ${value}`);
  return parsed;
}
