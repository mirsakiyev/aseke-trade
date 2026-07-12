import type { AiCandidateSetup, AiFuturesCandle, AiOutcomeState, AiSetupDirection } from "./aiFuturesTypes.ts";
import { calculateAllocatedTakeProfitR, calculateWeightedTakeProfitR } from "./aiFuturesSetup.ts";

export interface AiOutcomeEvent {
  key: string;
  type: "entry" | "take_profit" | "stop_loss" | "expired" | "invalidated";
  occurredAt: string;
  price: number;
  targetLabel: string | null;
  realizedR: number;
  wasAmbiguous: boolean;
}

export interface AiOutcomeReconciliation {
  state: AiOutcomeState;
  events: AiOutcomeEvent[];
  checkedThrough: string | null;
}

export function initialAiOutcomeState(): AiOutcomeState {
  return {
    status: "waiting_entry",
    enteredAt: null,
    completedAt: null,
    highestPrice: null,
    lowestPrice: null,
    mfeR: 0,
    maeR: 0,
    realizedR: 0,
    estimatedResultAfterCostsR: 0,
    hitTakeProfits: []
  };
}

export function reconcileAiSetupOutcome(
  setup: AiCandidateSetup,
  previous: AiOutcomeState,
  candles: AiFuturesCandle[],
  options: { estimatedRoundTripCostPercent?: number } = {}
): AiOutcomeReconciliation {
  if (!setup.direction || !setup.entryZone || !setup.stopLoss || !setup.takeProfits.length) {
    return { state: { ...previous }, events: [], checkedThrough: null };
  }
  const createdAt = Date.parse(setup.createdAt);
  const expiresAt = Date.parse(setup.expiresAt);
  const state = clone(previous);
  const events: AiOutcomeEvent[] = [];
  const ordered = candles
    .filter((candle) => Number.isFinite(candle.openTime) && Number.isFinite(candle.closeTime) && candle.openTime >= createdAt)
    .sort((left, right) => left.closeTime - right.closeTime);
  const entry = (setup.entryZone.low + setup.entryZone.high) / 2;
  const riskDistance = Math.abs(entry - setup.stopLoss);
  if (riskDistance <= 0) return { state, events, checkedThrough: null };

  let checkedThrough: string | null = null;
  for (const candle of ordered) {
    if (isTerminal(state.status)) break;
    checkedThrough = new Date(candle.closeTime).toISOString();

    if (state.status === "waiting_entry") {
      // If a one-minute candle straddles expiry, OHLC cannot prove that an
      // entry touch happened before the deadline. Expire conservatively.
      if (candle.closeTime > expiresAt) {
        state.status = "expired";
        state.completedAt = new Date(expiresAt).toISOString();
        events.push(event("expired", expiresAt, entry, null, 0));
        break;
      }

      if (touchesStop(candle, setup.direction, setup.stopLoss)) {
        const entryStopCollision = touchesEntry(candle, setup.entryZone.low, setup.entryZone.high);
        state.status = "invalidated";
        state.completedAt = checkedThrough;
        events.push(event("invalidated", candle.closeTime, setup.stopLoss, null, 0, entryStopCollision));
        break;
      }

      if (!touchesEntry(candle, setup.entryZone.low, setup.entryZone.high)) continue;
      state.status = "active";
      state.enteredAt = checkedThrough;
      state.highestPrice = entry;
      state.lowestPrice = entry;
      events.push(event("entry", candle.closeTime, entry, null, 0));
      // Entry timing within an OHLC candle is unknowable. Begin excursion and
      // exit evaluation on the next closed candle so pre-entry highs/lows
      // cannot inflate results or create a look-ahead target hit.
      continue;
    }

    state.highestPrice = Math.max(state.highestPrice ?? entry, candle.high);
    state.lowestPrice = Math.min(state.lowestPrice ?? entry, candle.low);
    updateExcursions(state, setup.direction, entry, riskDistance);

    // With OHLC candles the intrabar sequence is unknowable. Preserve the
    // project's conservative rule: a stop touched in the same candle wins.
    if (touchesStop(candle, setup.direction, setup.stopLoss)) {
      const stopTargetCollision = setup.takeProfits.some((target) =>
        !state.hitTakeProfits.includes(target.label) && touchesTarget(candle, setup.direction!, target.price)
      );
      const remainingPercent = Math.max(
        0,
        100 - setup.takeProfits
          .filter((target) => state.hitTakeProfits.includes(target.label))
          .reduce((total, target) => total + target.positionSizePercent, 0)
      );
      const stopR = -(remainingPercent / 100);
      const realizedTargets = calculateWeightedTakeProfitR(
        entry,
        setup.stopLoss,
        setup.takeProfits.filter((target) => state.hitTakeProfits.includes(target.label))
      );
      state.realizedR = round(realizedTargets + stopR, 6);
      state.status = "stopped";
      state.completedAt = checkedThrough;
      events.push(event("stop_loss", candle.closeTime, setup.stopLoss, null, stopR, stopTargetCollision));
      break;
    }

    for (const target of setup.takeProfits) {
      if (state.hitTakeProfits.includes(target.label) || !touchesTarget(candle, setup.direction, target.price)) continue;
      const targetR = calculateAllocatedTakeProfitR(
        entry,
        setup.stopLoss,
        target.price,
        target.positionSizePercent
      );
      state.hitTakeProfits.push(target.label);
      state.realizedR = calculateWeightedTakeProfitR(
        entry,
        setup.stopLoss,
        setup.takeProfits.filter((item) => state.hitTakeProfits.includes(item.label))
      );
      events.push(event("take_profit", candle.closeTime, target.price, target.label, targetR));
    }

    if (state.hitTakeProfits.length === setup.takeProfits.length) {
      state.status = "tp_hit";
      state.completedAt = checkedThrough;
    }
  }

  const costPercent = Math.max(0, options.estimatedRoundTripCostPercent ?? 0.18);
  const riskPercent = (riskDistance / entry) * 100;
  const costR = riskPercent > 0 ? costPercent / riskPercent : 0;
  state.estimatedResultAfterCostsR = round(state.realizedR - (state.enteredAt ? costR : 0), 6);

  return { state, events: dedupeEvents(events), checkedThrough };
}

function touchesEntry(candle: AiFuturesCandle, low: number, high: number): boolean {
  return candle.high >= low && candle.low <= high;
}

function touchesStop(candle: AiFuturesCandle, direction: AiSetupDirection, stop: number): boolean {
  return direction === "long" ? candle.low <= stop : candle.high >= stop;
}

function touchesTarget(candle: AiFuturesCandle, direction: AiSetupDirection, target: number): boolean {
  return direction === "long" ? candle.high >= target : candle.low <= target;
}

function updateExcursions(state: AiOutcomeState, direction: AiSetupDirection, entry: number, riskDistance: number): void {
  const favorable = direction === "long"
    ? (state.highestPrice ?? entry) - entry
    : entry - (state.lowestPrice ?? entry);
  const adverse = direction === "long"
    ? entry - (state.lowestPrice ?? entry)
    : (state.highestPrice ?? entry) - entry;
  state.mfeR = round(Math.max(state.mfeR, favorable / riskDistance), 6);
  state.maeR = round(Math.max(state.maeR, adverse / riskDistance), 6);
}

function event(
  type: AiOutcomeEvent["type"],
  timestamp: number,
  price: number,
  targetLabel: string | null,
  realizedR: number,
  wasAmbiguous = false
): AiOutcomeEvent {
  const occurredAt = new Date(timestamp).toISOString();
  return {
    key: `${type}:${targetLabel ?? "none"}:${occurredAt}`,
    type,
    occurredAt,
    price,
    targetLabel,
    realizedR: round(realizedR, 6),
    wasAmbiguous
  };
}

function dedupeEvents(events: AiOutcomeEvent[]): AiOutcomeEvent[] {
  return [...new Map(events.map((item) => [item.key, item])).values()];
}

function isTerminal(status: AiOutcomeState["status"]): boolean {
  return ["tp_hit", "stopped", "expired", "invalidated"].includes(status);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
