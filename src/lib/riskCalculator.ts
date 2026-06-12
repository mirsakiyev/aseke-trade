export type RiskDirection = "long" | "short";
export type RiskValueMode = "percentage" | "price";
export type PositionSizeMode = "auto" | "manual";

export interface RiskCalculatorInput {
  symbol: string;
  direction: RiskDirection;
  accountBalance: number;
  riskPercent: number;
  entryPrice: number;
  stopLossMode: RiskValueMode;
  stopLossValue: number;
  takeProfitMode: RiskValueMode;
  takeProfitValues: number[];
  leverage: number;
  positionSizeMode: PositionSizeMode;
  manualNotionalValue?: number;
}

export interface RiskTakeProfitResult {
  label: string;
  price: number;
  percent: number;
  profitAmount: number;
  riskReward: number;
}

export interface RiskCalculatorResult {
  symbol: string;
  direction: RiskDirection;
  accountBalance: number;
  riskAmount: number;
  selectedRiskAmount: number;
  selectedRiskPercent: number;
  actualRiskAmount: number;
  actualRiskPercent: number;
  accountRiskPercent: number;
  stopLossPrice: number;
  stopLossPercent: number;
  stopDistance: number;
  stopDistancePercent: number;
  positionRiskPercent: number;
  positionSizeUnits: number;
  notionalPositionValue: number;
  leverage: number;
  marginRequired: number;
  marginUsedPercent: number;
  marginShortfall: number;
  requiredLeverage: number;
  maxPositionValueAtSelectedLeverage: number;
  maxAffordablePositionValue: number;
  maxAffordableCoinQuantity: number;
  isExecutable: boolean;
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
  const symbol = input.symbol.trim();

  if (!symbol) errors.push("Symbol is required.");
  if (!isPositive(input.accountBalance)) errors.push("Account balance must be greater than zero.");
  if (!isPositive(input.riskPercent)) errors.push("Risk percent must be greater than zero.");
  if (!isPositive(input.entryPrice)) errors.push("Entry price must be greater than zero.");
  if (!isPositive(input.stopLossValue)) {
    errors.push(
      input.stopLossMode === "percentage"
        ? "Stop loss percentage must be greater than zero."
        : "Stop loss price must be greater than zero."
    );
  }
  if (!isPositive(input.leverage)) errors.push("Leverage must be greater than zero.");
  if (input.positionSizeMode === "manual" && !isPositive(input.manualNotionalValue)) {
    errors.push("Manual notional value must be greater than zero.");
  }

  if (errors.length) return { ok: false, errors };

  const stopLoss = deriveStopLoss(input.direction, input.entryPrice, input.stopLossMode, input.stopLossValue);

  if (!isPositive(stopLoss.price)) errors.push("Stop loss price must be greater than zero.");

  if (!errors.length) {
    if (input.direction === "long" && stopLoss.price >= input.entryPrice) {
      errors.push("For a long setup, stop loss must be below entry.");
    }

    if (input.direction === "short" && stopLoss.price <= input.entryPrice) {
      errors.push("For a short setup, stop loss must be above entry.");
    }
  }

  if (errors.length) return { ok: false, errors };

  const selectedRiskAmount = input.accountBalance * (input.riskPercent / 100);
  const stopLossDecimal = stopLoss.percent / 100;
  const notionalPositionValue =
    input.positionSizeMode === "manual" && input.manualNotionalValue
      ? input.manualNotionalValue
      : selectedRiskAmount / stopLossDecimal;
  const positionSizeUnits = notionalPositionValue / input.entryPrice;
  const actualRiskAmount = notionalPositionValue * stopLossDecimal;
  const actualRiskPercent = (actualRiskAmount / input.accountBalance) * 100;
  const marginRequired = notionalPositionValue / input.leverage;
  const marginUsedPercent = (marginRequired / input.accountBalance) * 100;
  const marginShortfall = Math.max(0, marginRequired - input.accountBalance);
  const requiredLeverage = notionalPositionValue / input.accountBalance;
  const maxPositionValueAtSelectedLeverage = input.accountBalance * input.leverage;
  const maxAffordablePositionValue = maxPositionValueAtSelectedLeverage;
  const maxAffordableCoinQuantity = maxAffordablePositionValue / input.entryPrice;
  const isExecutable = marginRequired <= input.accountBalance;
  const validTakeProfitValues = input.takeProfitValues.filter(isPositive);

  if (actualRiskPercent > 5) {
    warnings.push("High risk: risking more than 5% of account balance on one trade.");
  }

  if (actualRiskPercent > 25) {
    warnings.push("Extreme risk: this trade could lose a large part of the account if stop loss is hit.");
  }

  if (actualRiskPercent >= 100) {
    warnings.push("Extreme risk: this trade risks the full account balance.");
  }

  if (input.positionSizeMode === "manual" && actualRiskAmount > selectedRiskAmount) {
    warnings.push("Manual notional value risks more than the selected account risk.");
  }

  if (!isExecutable) {
    warnings.push("Invalid plan: required margin is higher than account balance.");
    warnings.push(
      `This position requires ${formatDollarForWarning(marginRequired)} margin at ${formatCompactNumber(
        input.leverage
      )}x leverage, but your account balance is only ${formatDollarForWarning(input.accountBalance)}.`
    );
  }

  if (input.leverage >= 20) {
    warnings.push("High leverage increases liquidation risk.");
  }

  const takeProfits = validTakeProfitValues.map((value, index) => {
    const takeProfit = deriveTakeProfit(input.direction, input.entryPrice, input.takeProfitMode, value);
    const profitPerUnit =
      input.direction === "long" ? takeProfit.price - input.entryPrice : input.entryPrice - takeProfit.price;
    const profitAmount = profitPerUnit * positionSizeUnits;

    return {
      label: `TP${index + 1}`,
      price: takeProfit.price,
      percent: takeProfit.percent,
      profitAmount,
      riskReward: actualRiskAmount > 0 ? profitAmount / actualRiskAmount : 0
    };
  });

  if (takeProfits.some((takeProfit) => takeProfit.profitAmount <= 0)) {
    warnings.push("One or more take-profit prices are on the wrong side of entry.");
  }

  return {
    ok: true,
    result: {
      symbol: symbol.toUpperCase(),
      direction: input.direction,
      accountBalance: input.accountBalance,
      riskAmount: actualRiskAmount,
      selectedRiskAmount,
      selectedRiskPercent: input.riskPercent,
      actualRiskAmount,
      actualRiskPercent,
      accountRiskPercent: actualRiskPercent,
      stopLossPrice: stopLoss.price,
      stopLossPercent: stopLoss.percent,
      stopDistance: stopLoss.distance,
      stopDistancePercent: stopLoss.percent,
      positionRiskPercent: stopLoss.percent,
      positionSizeUnits,
      notionalPositionValue,
      leverage: input.leverage,
      marginRequired,
      marginUsedPercent,
      marginShortfall,
      requiredLeverage,
      maxPositionValueAtSelectedLeverage,
      maxAffordablePositionValue,
      maxAffordableCoinQuantity,
      isExecutable,
      estimatedLoss: actualRiskAmount,
      takeProfits,
      warnings
    }
  };
}

function deriveStopLoss(
  direction: RiskDirection,
  entryPrice: number,
  mode: RiskValueMode,
  value: number
): { price: number; percent: number; distance: number } {
  if (mode === "percentage") {
    const price = direction === "long" ? entryPrice * (1 - value / 100) : entryPrice * (1 + value / 100);
    return {
      price,
      percent: value,
      distance: Math.abs(entryPrice - price)
    };
  }

  return {
    price: value,
    percent: (Math.abs(entryPrice - value) / entryPrice) * 100,
    distance: Math.abs(entryPrice - value)
  };
}

function deriveTakeProfit(
  direction: RiskDirection,
  entryPrice: number,
  mode: RiskValueMode,
  value: number
): { price: number; percent: number } {
  if (mode === "percentage") {
    return {
      price: direction === "long" ? entryPrice * (1 + value / 100) : entryPrice * (1 - value / 100),
      percent: value
    };
  }

  return {
    price: value,
    percent: (Math.abs(value - entryPrice) / entryPrice) * 100
  };
}

function isPositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatDollarForWarning(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

function formatCompactNumber(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2
  });
}
