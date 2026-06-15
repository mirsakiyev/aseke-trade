import type {
  TradingSignal,
  TradingSignalDirection,
  TradingSignalStatus,
  TradingSignalTakeProfit,
  TradingSignalUpdate
} from "../types/content";

export const TRADING_SIGNAL_DIRECTIONS: TradingSignalDirection[] = ["long", "short"];
export const TRADING_SIGNAL_STATUSES: TradingSignalStatus[] = ["active", "hit_tp", "hit_sl", "manually_closed"];
export const TRADING_SIGNAL_FINAL_STATUSES: TradingSignalStatus[] = ["hit_tp", "hit_sl", "manually_closed"];

export interface TakeProfitValidationResult {
  ok: boolean;
  message: string | null;
  totalPercent: number;
}

export interface WeightedRoiInput {
  direction: TradingSignalDirection;
  entryPrice: string | number;
  leverage: string | number;
  takeProfits: TradingSignalTakeProfit[];
  fallbackExitPrice?: string | number | null;
}

export function generateSignalTitle(direction: TradingSignalDirection, leverage: string | number): string {
  return `${direction.toUpperCase()} ${normalizeLeverage(leverage) ?? 1}X`;
}

export function getSignalDisplayTitle(
  signal: Pick<TradingSignal, "direction" | "leverage" | "generated_title" | "title">
): string {
  return generateSignalTitle(signal.direction, signal.leverage ?? 1);
}

export function normalizeLeverage(value: string | number): number | null {
  const leverage = Number(value);
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > 100) return null;

  return leverage;
}

export function normalizePositiveDecimal(value: string): string | null {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,10})?$/.test(normalized)) return null;
  if (Number(normalized) <= 0) return null;

  return normalized;
}

export function normalizePercent(value: string | number): number | null {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) return null;

  const percent = Number(normalized);
  if (!Number.isFinite(percent) || percent < 0) return null;

  return roundTo(percent, 4);
}

export function splitTakeProfitPercentages(count: number): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];

  const totalTenths = 1000;
  const base = Math.floor(totalTenths / count);
  const remainder = totalTenths - base * count;

  return Array.from({ length: count }, (_, index) => (base + (index === count - 1 ? remainder : 0)) / 10);
}

export function redistributeTakeProfitSizes<T extends Pick<TradingSignalTakeProfit, "positionSizePercent">>(
  takeProfits: T[]
): T[] {
  const percentages = splitTakeProfitPercentages(takeProfits.length);

  return takeProfits.map((takeProfit, index) => ({
    ...takeProfit,
    positionSizePercent: percentages[index] ?? 0
  }));
}

export function validateTakeProfits(
  takeProfits: Array<Pick<TradingSignalTakeProfit, "price" | "positionSizePercent">>
): TakeProfitValidationResult {
  if (!takeProfits.length) {
    return { ok: false, message: "Add at least one Take Profit.", totalPercent: 0 };
  }

  for (const takeProfit of takeProfits) {
    if (!normalizePositiveDecimal(String(takeProfit.price))) {
      return { ok: false, message: "Every Take Profit needs a valid price.", totalPercent: calculateTpPercentTotal(takeProfits) };
    }

    if (normalizePercent(takeProfit.positionSizePercent) === null) {
      return {
        ok: false,
        message: "Take Profit percentages cannot be empty or negative.",
        totalPercent: calculateTpPercentTotal(takeProfits)
      };
    }
  }

  const totalPercent = calculateTpPercentTotal(takeProfits);
  if (Math.abs(totalPercent - 100) > 0.0001) {
    return {
      ok: false,
      message: `Take Profit position sizes must total exactly 100%. Current total is ${formatPercent(totalPercent)}%.`,
      totalPercent
    };
  }

  return { ok: true, message: null, totalPercent };
}

export function calculateTpPercentTotal(
  takeProfits: Array<Pick<TradingSignalTakeProfit, "positionSizePercent">>
): number {
  return roundTo(
    takeProfits.reduce((total, takeProfit) => {
      const percent = normalizePercent(takeProfit.positionSizePercent);
      return total + (percent ?? 0);
    }, 0),
    4
  );
}

export function calculatePortionRoi(
  direction: TradingSignalDirection,
  entryPrice: string | number,
  exitPrice: string | number,
  leverage: string | number
): number {
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  const normalizedLeverage = Number(leverage);

  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(exit) || !Number.isFinite(normalizedLeverage)) {
    return 0;
  }

  const priceMove = direction === "long" ? exit - entry : entry - exit;
  return roundTo((priceMove / entry) * normalizedLeverage * 100, 4);
}

export function calculateWeightedRoi({
  direction,
  entryPrice,
  leverage,
  takeProfits,
  fallbackExitPrice
}: WeightedRoiInput): number {
  let totalRoi = 0;
  let closedPercent = 0;

  for (const takeProfit of takeProfits) {
    if (!takeProfit.isHit) continue;

    const positionSizePercent = normalizePercent(takeProfit.positionSizePercent) ?? 0;
    totalRoi += calculatePortionRoi(direction, entryPrice, takeProfit.price, leverage) * (positionSizePercent / 100);
    closedPercent += positionSizePercent;
  }

  const remainingPercent = Math.max(0, roundTo(100 - closedPercent, 4));
  if (remainingPercent > 0 && fallbackExitPrice !== undefined && fallbackExitPrice !== null) {
    totalRoi += calculatePortionRoi(direction, entryPrice, fallbackExitPrice, leverage) * (remainingPercent / 100);
  }

  return roundTo(totalRoi, 4);
}

export function calculateSignalFinalRoi(signal: TradingSignal): number | null {
  if (!TRADING_SIGNAL_FINAL_STATUSES.includes(signal.status)) return null;

  const takeProfits = getSignalTakeProfits(signal);
  const fallbackExitPrice =
    signal.status === "hit_sl"
      ? signal.stop_loss
      : signal.status === "manually_closed"
        ? signal.manual_close_price ?? signal.final_price
        : null;

  return calculateWeightedRoi({
    direction: signal.direction,
    entryPrice: signal.entry_price,
    leverage: signal.leverage ?? 1,
    takeProfits,
    fallbackExitPrice
  });
}

export function getSignalTakeProfits(signal: TradingSignal): TradingSignalTakeProfit[] {
  if (Array.isArray(signal.take_profits) && signal.take_profits.length) {
    return signal.take_profits.map((takeProfit, index) => normalizeTakeProfit(takeProfit, index));
  }

  const legacyPrices = [
    signal.take_profit_1,
    signal.take_profit_2,
    signal.take_profit_3,
    ...(Array.isArray(signal.additional_take_profits) ? signal.additional_take_profits : [])
  ].filter((price): price is string | number => price !== undefined && price !== null && String(price).trim() !== "");

  const percentages = splitTakeProfitPercentages(legacyPrices.length || 1);

  return (legacyPrices.length ? legacyPrices : [""]).map((price, index) => ({
    id: `tp-${index + 1}`,
    price,
    positionSizePercent: percentages[index] ?? 100,
    isHit: false,
    hitAt: null
  }));
}

export function getSignalUpdates(signal: TradingSignal): TradingSignalUpdate[] {
  if (Array.isArray(signal.updates) && signal.updates.length) {
    return signal.updates;
  }

  return [
    {
      id: `${signal.id}-created`,
      type: "signal_created",
      message: "Signal created",
      createdAt: signal.created_at,
      metadata: null
    }
  ];
}

export function appendSignalUpdate(
  updates: TradingSignalUpdate[] | null | undefined,
  update: Omit<TradingSignalUpdate, "id" | "createdAt"> & { id?: string; createdAt?: string }
): TradingSignalUpdate[] {
  return [
    ...(Array.isArray(updates) ? updates : []),
    {
      id: update.id ?? crypto.randomUUID(),
      createdAt: update.createdAt ?? new Date().toISOString(),
      type: update.type,
      message: update.message,
      metadata: update.metadata ?? null
    }
  ];
}

export function formatSignalStatus(status: TradingSignalStatus): string {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "hit_tp":
      return "HIT TP";
    case "hit_sl":
      return "HIT SL";
    case "manually_closed":
      return "MANUALLY CLOSED";
    default:
      return String(status).toUpperCase();
  }
}

export function formatPercent(value: string | number): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value);

  return numericValue.toLocaleString("en-US", {
    maximumFractionDigits: 4
  });
}

function normalizeTakeProfit(takeProfit: TradingSignalTakeProfit, index: number): TradingSignalTakeProfit {
  return {
    id: takeProfit.id || `tp-${index + 1}`,
    price: takeProfit.price ?? "",
    positionSizePercent: takeProfit.positionSizePercent ?? takeProfit.position_size_percent ?? 0,
    isHit: Boolean(takeProfit.isHit ?? takeProfit.is_hit),
    hitAt: takeProfit.hitAt ?? takeProfit.hit_at ?? null
  };
}

function roundTo(value: number, precision: number): number {
  const multiplier = 10 ** precision;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}
