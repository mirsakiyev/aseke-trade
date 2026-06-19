import {
  applyMarketPrice,
  markDemoPositionPrice,
  type DemoOpenPosition,
  type DemoPendingLimitOrder,
  type DemoTakeProfit,
  type DemoTradeState
} from "./demoTradeMath.ts";

export interface DemoTradeReconciliationCandle {
  timestamp: number;
  closeTimestamp?: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type DemoTradeExecutionType = "limit_fill" | "stop_loss" | "take_profit" | "liquidation";

export interface DemoTradeExecutionEvent {
  eventKey: string;
  tradeId: string;
  eventType: DemoTradeExecutionType;
  symbol: string;
  side: DemoOpenPosition["side"];
  takeProfitId: string | null;
  triggerPrice: number;
  executionPrice: number;
  closePercent: number | null;
  quantityClosed: number;
  realizedPnl: number;
  occurredAt: string;
  source: "historical_candle" | "live_candle";
  candleOpenTime: string;
  candleCloseTime: string;
  wasAmbiguous: boolean;
}

export interface DemoTradeReconciliationResult {
  state: DemoTradeState;
  events: DemoTradeExecutionEvent[];
  checkedThrough: string | null;
}

interface TriggerCandidate {
  type: DemoTradeExecutionType;
  price: number;
  takeProfit?: DemoTakeProfit;
  ambiguous: boolean;
}

export function reconcileDemoTradeStateWithCandles(
  state: DemoTradeState,
  candles: DemoTradeReconciliationCandle[],
  now = new Date().toISOString()
): DemoTradeReconciliationResult {
  if ((!state.openPosition && !state.pendingLimitOrder) || !candles.length) {
    return { state, events: [], checkedThrough: null };
  }

  let nextState = cloneState(state);
  const events: DemoTradeExecutionEvent[] = [];
  const sortedCandles = candles
    .filter(isUsableCandle)
    .sort((first, second) => first.timestamp - second.timestamp);

  for (const candle of sortedCandles) {
    if (!nextState.openPosition && nextState.pendingLimitOrder) {
      const order = nextState.pendingLimitOrder;
      if (isLimitOrderHit(order, candle)) {
        const beforeState = nextState;
        nextState = applyMarketPrice(beforeState, order.limitPrice, candleIso(candle));
        const openedPosition = nextState.openPosition;
        if (openedPosition) {
          events.push({
            eventKey: `${order.orderId}:limit_fill`,
            tradeId: openedPosition.tradeId,
            eventType: "limit_fill",
            symbol: order.symbol,
            side: order.side,
            takeProfitId: null,
            triggerPrice: order.limitPrice,
            executionPrice: order.limitPrice,
            closePercent: null,
            quantityClosed: 0,
            realizedPnl: 0,
            occurredAt: candleIso(candle),
            source: "historical_candle",
            candleOpenTime: candleIso(candle),
            candleCloseTime: candleCloseIso(candle),
            wasAmbiguous: didCandleTouchAnyBracket(openedPosition, candle)
          });
        }
      }
    }

    const position = nextState.openPosition;
    if (!position) continue;

    const triggers = chooseCandleTriggers(position, candle);
    for (const trigger of triggers) {
      const beforeState = nextState;
      const beforePosition = beforeState.openPosition;
      if (!beforePosition) break;

      nextState = applyMarketPrice(beforeState, trigger.price, candleIso(candle));
      const afterPosition = nextState.openPosition;
      const latestAction = nextState.actionHistory[nextState.actionHistory.length - 1];
      const quantityClosed = beforePosition.remainingQuantity - (afterPosition?.remainingQuantity ?? 0);

      if (quantityClosed <= 0) continue;

      events.push({
        eventKey: trigger.takeProfit
          ? `${beforePosition.tradeId}:tp:${trigger.takeProfit.id}`
          : `${beforePosition.tradeId}:${trigger.type}`,
        tradeId: beforePosition.tradeId,
        eventType: trigger.type,
        symbol: beforePosition.symbol,
        side: beforePosition.side,
        takeProfitId: trigger.takeProfit?.id ?? null,
        triggerPrice: trigger.price,
        executionPrice: trigger.price,
        closePercent: trigger.takeProfit?.closePercent ?? null,
        quantityClosed,
        realizedPnl: latestAction?.realizedPnl ?? 0,
        occurredAt: candleIso(candle),
        source: "historical_candle",
        candleOpenTime: candleIso(candle),
        candleCloseTime: candleCloseIso(candle),
        wasAmbiguous: trigger.ambiguous
      });
    }
  }

  const checkedThrough = sortedCandles.length
    ? candleCloseIso(sortedCandles[sortedCandles.length - 1])
    : now;
  nextState = markStateChecked(nextState, sortedCandles[sortedCandles.length - 1], checkedThrough);

  return { state: nextState, events, checkedThrough };
}

function chooseCandleTriggers(
  position: DemoOpenPosition,
  candle: DemoTradeReconciliationCandle
): TriggerCandidate[] {
  const liquidationHit = isLiquidationHit(position, candle);
  const stopLossHit = isStopLossHit(position, candle);
  const takeProfitHits = sortedTakeProfits(position)
    .filter((takeProfit) => !takeProfit.isHit && isTakeProfitHit(position, takeProfit, candle));
  const hasMixedBracketHit = stopLossHit && takeProfitHits.length > 0;

  // Binance public klines only give high/low ranges, so a candle can contain both a loss-side and profit-side
  // level without revealing which happened first. When smaller data is unavailable, Demo Trade uses a
  // deterministic conservative fallback: liquidation first, then stop loss, then take profits.
  if (liquidationHit && position.liquidationPrice) {
    return [{
      type: "liquidation",
      price: position.liquidationPrice,
      ambiguous: stopLossHit || takeProfitHits.length > 0
    }];
  }

  if (stopLossHit) {
    return [{
      type: "stop_loss",
      price: position.stopLoss,
      ambiguous: hasMixedBracketHit
    }];
  }

  return takeProfitHits.map((takeProfit) => ({
    type: "take_profit",
    price: takeProfit.price,
    takeProfit,
    ambiguous: false
  }));
}

function sortedTakeProfits(position: DemoOpenPosition): DemoTakeProfit[] {
  return [...position.takeProfits].sort((first, second) =>
    position.side === "long" ? first.price - second.price : second.price - first.price
  );
}

function isLimitOrderHit(order: DemoPendingLimitOrder, candle: DemoTradeReconciliationCandle): boolean {
  return order.side === "long" ? candle.low <= order.limitPrice : candle.high >= order.limitPrice;
}

function didCandleTouchAnyBracket(position: DemoOpenPosition, candle: DemoTradeReconciliationCandle): boolean {
  return isLiquidationHit(position, candle)
    || isStopLossHit(position, candle)
    || position.takeProfits.some((takeProfit) => !takeProfit.isHit && isTakeProfitHit(position, takeProfit, candle));
}

function isStopLossHit(position: DemoOpenPosition, candle: DemoTradeReconciliationCandle): boolean {
  if (!Number.isFinite(position.stopLoss) || position.stopLoss <= 0) return false;
  return position.side === "long" ? candle.low <= position.stopLoss : candle.high >= position.stopLoss;
}

function isTakeProfitHit(
  position: DemoOpenPosition,
  takeProfit: DemoTakeProfit,
  candle: DemoTradeReconciliationCandle
): boolean {
  return position.side === "long" ? candle.high >= takeProfit.price : candle.low <= takeProfit.price;
}

function isLiquidationHit(position: DemoOpenPosition, candle: DemoTradeReconciliationCandle): boolean {
  if (!position.liquidationPrice) return false;
  return position.side === "long" ? candle.low <= position.liquidationPrice : candle.high >= position.liquidationPrice;
}

function markStateChecked(
  state: DemoTradeState,
  candle: DemoTradeReconciliationCandle | undefined,
  checkedAt: string
): DemoTradeState {
  if (!state.openPosition && !state.pendingLimitOrder) return state;

  const nextState = candle && state.openPosition ? markDemoPositionPrice(state, candle.close, checkedAt) : cloneState(state);
  if (nextState.openPosition) {
    nextState.openPosition.lastCheckedAt = checkedAt;
    nextState.openPosition.updatedAt = checkedAt;
  }
  if (nextState.pendingLimitOrder) {
    nextState.pendingLimitOrder.updatedAt = checkedAt;
  }
  nextState.updatedAt = checkedAt;
  return nextState;
}

function isUsableCandle(candle: DemoTradeReconciliationCandle): boolean {
  return Number.isFinite(candle.timestamp)
    && Number.isFinite(candle.open)
    && Number.isFinite(candle.high)
    && Number.isFinite(candle.low)
    && Number.isFinite(candle.close)
    && candle.high >= candle.low
    && candle.high > 0
    && candle.low > 0;
}

function candleIso(candle: DemoTradeReconciliationCandle): string {
  return new Date(candle.timestamp).toISOString();
}

function candleCloseIso(candle: DemoTradeReconciliationCandle): string {
  return new Date(candle.closeTimestamp ?? candle.timestamp).toISOString();
}

function cloneState(state: DemoTradeState): DemoTradeState {
  return JSON.parse(JSON.stringify(state)) as DemoTradeState;
}
