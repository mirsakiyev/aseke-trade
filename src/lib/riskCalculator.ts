export type RiskDirection = "long" | "short";
export type PositionSizeMode = "auto" | "manual";

export interface RiskCalculatorInput {
  symbol: string;
  direction: RiskDirection;
  accountBalance: number;
  riskPercent: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrices: number[];
  leverage: number;
  positionSizeMode: PositionSizeMode;
  manualPositionSize?: number;
}

export interface RiskTakeProfitResult {
  label: string;
  price: number;
  profitAmount: number;
  riskReward: number;
}

export interface RiskCalculatorResult {
  symbol: string;
  direction: RiskDirection;
  riskAmount: number;
  stopDistance: number;
  stopDistancePercent: number;
  positionSizeUnits: number;
  notionalPositionValue: number;
  marginRequired: number;
  estimatedLoss: number;
  takeProfits: RiskTakeProfitResult[];
  warnings: string[];
}

export type RiskCalculation =
  | { ok: true; result: RiskCalculatorResult }
  | { ok: false; errors: string[] };

export function calculateRisk(input: RiskCalculatorInput): RiskCalculation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.symbol.trim()) errors.push("Symbol is required.");
  if (!isPositive(input.accountBalance)) errors.push("Account balance must be greater than zero.");
  if (!isPositive(input.riskPercent)) errors.push("Risk percent must be greater than zero.");
  if (!isPositive(input.entryPrice)) errors.push("Entry price must be greater than zero.");
  if (!isPositive(input.stopLossPrice)) errors.push("Stop loss must be greater than zero.");
  if (!isPositive(input.leverage)) errors.push("Leverage must be greater than zero.");
  if (input.positionSizeMode === "manual" && !isPositive(input.manualPositionSize)) {
    errors.push("Manual position size must be greater than zero.");
  }

  if (!errors.length) {
    if (input.direction === "long" && input.stopLossPrice >= input.entryPrice) {
      errors.push("For a long setup, stop loss must be below entry.");
    }

    if (input.direction === "short" && input.stopLossPrice <= input.entryPrice) {
      errors.push("For a short setup, stop loss must be above entry.");
    }
  }

  if (errors.length) return { ok: false, errors };

  const stopDistance = Math.abs(input.entryPrice - input.stopLossPrice);
  const riskAmount = input.accountBalance * (input.riskPercent / 100);
  const positionSizeUnits =
    input.positionSizeMode === "manual" && input.manualPositionSize
      ? input.manualPositionSize
      : riskAmount / stopDistance;
  const notionalPositionValue = positionSizeUnits * input.entryPrice;
  const marginRequired = notionalPositionValue / input.leverage;
  const estimatedLoss = positionSizeUnits * stopDistance;
  const stopDistancePercent = (stopDistance / input.entryPrice) * 100;
  const validTakeProfitPrices = input.takeProfitPrices.filter(isPositive);

  if (input.riskPercent > 3) {
    warnings.push("Risk is above 3% of account balance.");
  }

  if (input.positionSizeMode === "manual" && estimatedLoss > riskAmount) {
    warnings.push("Manual size risks more than the selected account risk.");
  }

  if (marginRequired > input.accountBalance) {
    warnings.push("Required margin is higher than account balance.");
  }

  const takeProfits = validTakeProfitPrices.map((price, index) => {
    const profitPerUnit = input.direction === "long" ? price - input.entryPrice : input.entryPrice - price;
    const profitAmount = profitPerUnit * positionSizeUnits;
    return {
      label: `TP${index + 1}`,
      price,
      profitAmount,
      riskReward: profitAmount / estimatedLoss
    };
  });

  if (takeProfits.some((takeProfit) => takeProfit.profitAmount <= 0)) {
    warnings.push("One or more take-profit prices are on the wrong side of entry.");
  }

  return {
    ok: true,
    result: {
      symbol: input.symbol.trim().toUpperCase(),
      direction: input.direction,
      riskAmount,
      stopDistance,
      stopDistancePercent,
      positionSizeUnits,
      notionalPositionValue,
      marginRequired,
      estimatedLoss,
      takeProfits,
      warnings
    }
  };
}

function isPositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
