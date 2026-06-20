import type { TradingSignal, TradingSignalTakeProfit, TradingSignalUpdate } from "../types/content";
import {
  calculateWeightedRoi,
  formatSignalPrice,
  getSignalTakeProfits,
  getSignalUpdates
} from "./tradingSignals.ts";

export interface TradingSignalReconciliationCandle {
  timestamp: number;
  closeTimestamp?: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type TradingSignalExecutionType = "tp_hit" | "sl_hit";

export interface TradingSignalExecutionEvent {
  eventKey: string;
  signalId: string;
  eventType: TradingSignalExecutionType;
  takeProfitId: string | null;
  triggerPrice: number;
  executionPrice: number;
  occurredAt: string;
  source: "historical_candle";
  candleOpenTime: string;
  candleCloseTime: string;
  wasAmbiguous: boolean;
}

export interface TradingSignalReconciliationResult {
  signal: TradingSignal;
  events: TradingSignalExecutionEvent[];
  checkedThrough: string | null;
}

export type ReconciledTradingSignal = TradingSignal & {
  last_checked_at?: string | null;
  last_auto_update_price?: string | number | null;
  last_auto_update_source?: string | null;
};

export function reconcileTradingSignalWithCandles(
  signal: TradingSignal,
  candles: TradingSignalReconciliationCandle[],
  now = new Date().toISOString()
): TradingSignalReconciliationResult {
  if (signal.status !== "active" || !candles.length) {
    return { signal, events: [], checkedThrough: null };
  }

  const nextSignal: ReconciledTradingSignal = cloneSignal(signal);
  nextSignal.take_profits = getSignalTakeProfits(nextSignal);
  nextSignal.updates = getSignalUpdates(nextSignal);
  const events: TradingSignalExecutionEvent[] = [];
  let checkedThrough: string | null = null;
  let latestClosePrice: number | null = null;

  const sortedCandles = [...candles]
    .filter(isUsableCandle)
    .sort((first, second) => first.timestamp - second.timestamp);

  for (const candle of sortedCandles) {
    if (nextSignal.status !== "active") break;

    checkedThrough = candleCloseIso(candle);
    latestClosePrice = candle.close;

    const stopHit = isStopLossHit(nextSignal, candle);
    const takeProfitHits = getSignalTakeProfits(nextSignal).filter((takeProfit) =>
      !takeProfit.isHit && isTakeProfitHit(nextSignal, takeProfit, candle)
    );

    // With one-minute candles we cannot know intrabar order, so SL wins over new TP hits in the same candle.
    if (stopHit) {
      const event = applyStopLossHit(nextSignal, candle);
      if (event) events.push(event);
      break;
    }

    for (const takeProfit of takeProfitHits) {
      const event = applyTakeProfitHit(nextSignal, takeProfit.id, candle);
      if (event) events.push(event);
      if (nextSignal.status !== "active") break;
    }
  }

  if (checkedThrough) {
    nextSignal.last_checked_at = checkedThrough;
    nextSignal.last_auto_update_price = latestClosePrice ?? nextSignal.last_auto_update_price ?? null;
    nextSignal.last_auto_update_source = "historical_candle";
    nextSignal.updated_at = now;
  }

  return { signal: nextSignal, events, checkedThrough };
}

function applyTakeProfitHit(
  signal: ReconciledTradingSignal,
  takeProfitId: string,
  candle: TradingSignalReconciliationCandle
): TradingSignalExecutionEvent | null {
  const now = candleIso(candle);
  const takeProfits = getSignalTakeProfits(signal).map((takeProfit) =>
    takeProfit.id === takeProfitId ? { ...takeProfit, isHit: true, hitAt: takeProfit.hitAt ?? now } : takeProfit
  );
  const hitTakeProfit = takeProfits.find((takeProfit) => takeProfit.id === takeProfitId);
  if (!hitTakeProfit) return null;

  const takeProfitIndex = takeProfits.findIndex((takeProfit) => takeProfit.id === takeProfitId);
  const allTakeProfitsHit = takeProfits.every((takeProfit) => takeProfit.isHit);
  const eventKey = `auto:${signal.id}:${takeProfitId}:tp_hit`;
  signal.take_profits = takeProfits;
  signal.status = allTakeProfitsHit ? "hit_tp" : "active";
  signal.closed_at = allTakeProfitsHit ? signal.closed_at ?? now : signal.closed_at;
  signal.final_price = allTakeProfitsHit ? hitTakeProfit.price : signal.final_price;
  signal.final_roi = allTakeProfitsHit
    ? calculateWeightedRoi({
        direction: signal.direction,
        entryPrice: signal.entry_price,
        leverage: signal.leverage ?? 1,
        takeProfits
      })
    : null;
  signal.updates = appendAutoSignalUpdate(signal.updates, {
    id: eventKey,
    type: "tp_hit",
    message: `TP${takeProfitIndex + 1} hit at ${formatSignalPrice(hitTakeProfit.price)}`,
    createdAt: now,
    metadata: {
      source: "auto",
      takeProfitId,
      price: hitTakeProfit.price,
      positionSizePercent: hitTakeProfit.positionSizePercent,
      candleOpenTime: candleIso(candle),
      candleCloseTime: candleCloseIso(candle)
    }
  });

  return {
    eventKey,
    signalId: signal.id,
    eventType: "tp_hit",
    takeProfitId,
    triggerPrice: Number(hitTakeProfit.price),
    executionPrice: Number(hitTakeProfit.price),
    occurredAt: now,
    source: "historical_candle",
    candleOpenTime: candleIso(candle),
    candleCloseTime: candleCloseIso(candle),
    wasAmbiguous: false
  };
}

function applyStopLossHit(
  signal: ReconciledTradingSignal,
  candle: TradingSignalReconciliationCandle
): TradingSignalExecutionEvent | null {
  const now = candleIso(candle);
  const stopLoss = Number(signal.stop_loss);
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) return null;

  const eventKey = `auto:${signal.id}:sl_hit`;
  const takeProfits = getSignalTakeProfits(signal);
  signal.take_profits = takeProfits;
  signal.status = "hit_sl";
  signal.closed_at = signal.closed_at ?? now;
  signal.final_price = signal.stop_loss;
  signal.final_roi = calculateWeightedRoi({
    direction: signal.direction,
    entryPrice: signal.entry_price,
    leverage: signal.leverage ?? 1,
    takeProfits,
    fallbackExitPrice: signal.stop_loss
  });
  signal.updates = appendAutoSignalUpdate(signal.updates, {
    id: eventKey,
    type: "sl_hit",
    message: `Stop Loss hit at ${formatSignalPrice(signal.stop_loss)}`,
    createdAt: now,
    metadata: {
      source: "auto",
      price: signal.stop_loss,
      candleOpenTime: candleIso(candle),
      candleCloseTime: candleCloseIso(candle)
    }
  });

  return {
    eventKey,
    signalId: signal.id,
    eventType: "sl_hit",
    takeProfitId: null,
    triggerPrice: stopLoss,
    executionPrice: stopLoss,
    occurredAt: now,
    source: "historical_candle",
    candleOpenTime: candleIso(candle),
    candleCloseTime: candleCloseIso(candle),
    wasAmbiguous: didCandleTouchAnyTakeProfit(signal, candle)
  };
}

function appendAutoSignalUpdate(
  updates: TradingSignalUpdate[] | null | undefined,
  update: TradingSignalUpdate
): TradingSignalUpdate[] {
  const currentUpdates = Array.isArray(updates) ? updates : [];
  if (currentUpdates.some((item) => item.id === update.id)) return currentUpdates;
  return [...currentUpdates, update];
}

function isStopLossHit(signal: TradingSignal, candle: TradingSignalReconciliationCandle): boolean {
  const stopLoss = Number(signal.stop_loss);
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) return false;
  return signal.direction === "long" ? candle.low <= stopLoss : candle.high >= stopLoss;
}

function isTakeProfitHit(
  signal: TradingSignal,
  takeProfit: TradingSignalTakeProfit,
  candle: TradingSignalReconciliationCandle
): boolean {
  const takeProfitPrice = Number(takeProfit.price);
  if (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0) return false;
  return signal.direction === "long" ? candle.high >= takeProfitPrice : candle.low <= takeProfitPrice;
}

function didCandleTouchAnyTakeProfit(signal: TradingSignal, candle: TradingSignalReconciliationCandle): boolean {
  return getSignalTakeProfits(signal).some((takeProfit) => !takeProfit.isHit && isTakeProfitHit(signal, takeProfit, candle));
}

function isUsableCandle(candle: TradingSignalReconciliationCandle): boolean {
  return [candle.timestamp, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
    && candle.high >= candle.low
    && candle.high > 0
    && candle.low > 0;
}

function candleIso(candle: TradingSignalReconciliationCandle): string {
  return new Date(candle.timestamp).toISOString();
}

function candleCloseIso(candle: TradingSignalReconciliationCandle): string {
  return new Date(candle.closeTimestamp ?? candle.timestamp).toISOString();
}

function cloneSignal(signal: TradingSignal): ReconciledTradingSignal {
  return JSON.parse(JSON.stringify(signal)) as ReconciledTradingSignal;
}
