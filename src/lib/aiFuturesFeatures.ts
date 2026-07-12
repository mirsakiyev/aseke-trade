import { AI_FUTURES_LIMITS } from "./aiFuturesConfig.ts";
import {
  AI_FUTURES_TIMEFRAMES,
  type AiFuturesCandle,
  type AiFuturesTimeframe,
  type AiMarketFeatures,
  type AiNormalizedMarketSnapshot,
  type AiPriceZone,
  type AiStructureDirection,
  type AiSwingPoint,
  type AiTimeframeFeatures,
  type AiTrendDirection
} from "./aiFuturesTypes.ts";

const annualizationByTimeframe: Record<AiFuturesTimeframe, number> = {
  "15m": Math.sqrt(365 * 24 * 4),
  "1h": Math.sqrt(365 * 24),
  "4h": Math.sqrt(365 * 6)
};

export function calculateMarketFeatures(
  snapshot: AiNormalizedMarketSnapshot,
  now = Date.parse(snapshot.capturedAt)
): AiMarketFeatures {
  const candleClose = Date.parse(snapshot.candleCloseAt);
  if (!Number.isFinite(candleClose) || !Number.isFinite(now)) {
    throw new Error("AI market snapshot timestamps are invalid.");
  }

  const timeframes = Object.fromEntries(
    AI_FUTURES_TIMEFRAMES.map((timeframe) => {
      const candles = normalizeClosedCandles(snapshot.candles[timeframe], candleClose);
      if (candles.length < AI_FUTURES_LIMITS.minimumCandles) {
        throw new Error(`${timeframe} requires at least ${AI_FUTURES_LIMITS.minimumCandles} closed candles.`);
      }
      return [timeframe, calculateTimeframeFeatures(timeframe, candles)];
    })
  ) as Record<AiFuturesTimeframe, AiTimeframeFeatures>;

  const trendVotes = [
    { direction: timeframes["15m"].trend, weight: 1 },
    { direction: timeframes["1h"].trend, weight: 2 },
    { direction: timeframes["4h"].trend, weight: 3 }
  ];
  const bullishWeight = sum(trendVotes.filter((vote) => vote.direction === "bullish").map((vote) => vote.weight));
  const bearishWeight = sum(trendVotes.filter((vote) => vote.direction === "bearish").map((vote) => vote.weight));
  const multiTimeframeTrend: AiTrendDirection =
    bullishWeight >= 5 ? "bullish" : bearishWeight >= 5 ? "bearish" : "neutral";
  const trendAlignmentScore = roundTo((Math.max(bullishWeight, bearishWeight) / 6) * 100, 2);
  const intraday = timeframes["15m"];
  const context = timeframes["1h"];
  const isHighVolatility =
    intraday.atrPercent >= AI_FUTURES_LIMITS.abnormalAtrPercent15m ||
    intraday.realizedVolatility > context.realizedVolatility * 1.75;
  const regime = isHighVolatility
    ? "high_volatility"
    : intraday.adx14 >= 25 && trendAlignmentScore >= 66
      ? "trending"
      : "ranging";

  const staleReasons = snapshot.sourceTimestamps
    .filter((timestamp) => timestamp.stale)
    .map((timestamp) => `${timestamp.category} is stale (${Math.round(timestamp.ageSeconds)}s old).`);
  const currentDistanceFromEma20Atr = intraday.atr14 > 0
    ? roundTo(Math.abs(snapshot.currentPrice - intraday.ema20) / intraday.atr14, 4)
    : Number.POSITIVE_INFINITY;
  const futures = snapshot.futures;

  return {
    calculatedAt: new Date(now).toISOString(),
    candleCloseAt: snapshot.candleCloseAt,
    timeframes,
    multiTimeframeTrend,
    trendAlignmentScore,
    regime,
    currentDistanceFromEma20Atr,
    markIndexBasisPercent: roundTo(futures.basisPercent, 6),
    fundingInterpretation: futures.fundingRate > 0.0001 ? "longs_pay" : futures.fundingRate < -0.0001 ? "shorts_pay" : "neutral",
    positioningCrowding:
      futures.globalLongShortRatio >= 1.35 || futures.topTraderLongShortRatio >= 1.45
        ? "long_crowded"
        : futures.globalLongShortRatio <= 0.74 || futures.topTraderLongShortRatio <= 0.69
          ? "short_crowded"
          : "balanced",
    openInterestDirection:
      futures.openInterestChangePercent > 1 ? "rising" : futures.openInterestChangePercent < -1 ? "falling" : "flat",
    takerFlow: futures.takerBuySellRatio > 1.05 ? "buying" : futures.takerBuySellRatio < 0.95 ? "selling" : "balanced",
    sourceTimestamps: snapshot.sourceTimestamps,
    stale: staleReasons.length > 0,
    staleReasons
  };
}

export function calculateTimeframeFeatures(
  timeframe: AiFuturesTimeframe,
  candles: AiFuturesCandle[]
): AiTimeframeFeatures {
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const ema200Series = ema(closes, 200);
  const macdFast = ema(closes, 12);
  const macdSlow = ema(closes, 26);
  const macdSeries = macdFast.map((value, index) => value - macdSlow[index]);
  const macdSignalSeries = ema(macdSeries, 9);
  const atrSeries = atr(candles, 14);
  const rsiSeries = rsi(closes, 14);
  const adxSeries = adx(candles, 14);
  const swingPoints = findSwingPoints(candles, 3);
  const last = candles[candles.length - 1];
  const lastAtr = lastValue(atrSeries);
  const swingHighs = swingPoints.filter((point) => point.kind === "high");
  const swingLows = swingPoints.filter((point) => point.kind === "low");
  const supports = buildPriceZones(swingLows, lastAtr, last.close, "support");
  const resistances = buildPriceZones(swingHighs, lastAtr, last.close, "resistance");
  const structure = resolveStructure(swingHighs, swingLows);
  const lastEma20 = lastValue(ema20Series);
  const lastEma50 = lastValue(ema50Series);
  const lastEma200 = lastValue(ema200Series);
  const trend: AiTrendDirection =
    last.close > lastEma20 && lastEma20 > lastEma50 && lastEma50 > lastEma200
      ? "bullish"
      : last.close < lastEma20 && lastEma20 < lastEma50 && lastEma50 < lastEma200
        ? "bearish"
        : "neutral";
  const recent = candles.slice(-20);
  const averageBodyPercent = average(
    recent.map((candle) => candle.open > 0 ? (Math.abs(candle.close - candle.open) / candle.open) * 100 : 0)
  );
  const averageUpperWickPercent = average(
    recent.map((candle) => candle.close > 0
      ? ((candle.high - Math.max(candle.open, candle.close)) / candle.close) * 100
      : 0)
  );
  const averageLowerWickPercent = average(
    recent.map((candle) => candle.close > 0
      ? ((Math.min(candle.open, candle.close) - candle.low) / candle.close) * 100
      : 0)
  );
  const volumeAverage20 = average(volumes.slice(-20));

  return {
    timeframe,
    candleCount: candles.length,
    lastClosedAt: new Date(last.closeTime).toISOString(),
    close: roundTo(last.close, 8),
    ema20: roundTo(lastEma20, 8),
    ema50: roundTo(lastEma50, 8),
    ema200: roundTo(lastEma200, 8),
    rsi14: roundTo(lastValue(rsiSeries), 4),
    macd: roundTo(lastValue(macdSeries), 8),
    macdSignal: roundTo(lastValue(macdSignalSeries), 8),
    macdHistogram: roundTo(lastValue(macdSeries) - lastValue(macdSignalSeries), 8),
    atr14: roundTo(lastAtr, 8),
    atrPercent: roundTo(last.close > 0 ? (lastAtr / last.close) * 100 : 0, 4),
    adx14: roundTo(lastValue(adxSeries), 4),
    vwap: roundTo(calculateVwap(candles.slice(-96)), 8),
    volumeAverage20: roundTo(volumeAverage20, 8),
    volumeZScore: roundTo(zScore(volumes.slice(-50), last.volume), 4),
    realizedVolatility: roundTo(realizedVolatility(closes.slice(-50), annualizationByTimeframe[timeframe]), 4),
    averageBodyPercent: roundTo(averageBodyPercent, 4),
    averageUpperWickPercent: roundTo(averageUpperWickPercent, 4),
    averageLowerWickPercent: roundTo(averageLowerWickPercent, 4),
    trend,
    structure,
    swingHighs: swingHighs.slice(-8),
    swingLows: swingLows.slice(-8),
    supports,
    resistances
  };
}

export function ema(values: number[], period: number): number[] {
  if (!values.length || period <= 0) return [];
  const multiplier = 2 / (period + 1);
  const output = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    output.push(values[index] * multiplier + output[index - 1] * (1 - multiplier));
  }
  return output;
}

export function rsi(values: number[], period = 14): number[] {
  if (!values.length) return [];
  const output = Array(values.length).fill(50) as number[];
  if (values.length <= period) return output;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  let averageGain = gain / period;
  let averageLoss = loss / period;
  output[period] = rsiValue(averageGain, averageLoss);
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = ((averageGain * (period - 1)) + Math.max(change, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-change, 0)) / period;
    output[index] = rsiValue(averageGain, averageLoss);
  }
  return output;
}

export function atr(candles: AiFuturesCandle[], period = 14): number[] {
  if (!candles.length) return [];
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  return wilderAverage(trueRanges, period);
}

export function adx(candles: AiFuturesCandle[], period = 14): number[] {
  if (!candles.length) return [];
  const trueRanges: number[] = [candles[0].high - candles[0].low];
  const plusDm: number[] = [0];
  const minusDm: number[] = [0];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trueRanges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
  }
  const smoothTr = wilderAverage(trueRanges, period);
  const smoothPlus = wilderAverage(plusDm, period);
  const smoothMinus = wilderAverage(minusDm, period);
  const dx = smoothTr.map((range, index) => {
    if (range <= 0) return 0;
    const plus = (smoothPlus[index] / range) * 100;
    const minus = (smoothMinus[index] / range) * 100;
    const total = plus + minus;
    return total > 0 ? (Math.abs(plus - minus) / total) * 100 : 0;
  });
  return wilderAverage(dx, period);
}

export function findSwingPoints(candles: AiFuturesCandle[], radius = 3): AiSwingPoint[] {
  const points: AiSwingPoint[] = [];
  for (let index = radius; index < candles.length - radius; index += 1) {
    const current = candles[index];
    const window = candles.slice(index - radius, index + radius + 1);
    if (window.every((candle, offset) => offset === radius || current.high > candle.high)) {
      points.push({ index, timestamp: current.closeTime, price: current.high, kind: "high" });
    }
    if (window.every((candle, offset) => offset === radius || current.low < candle.low)) {
      points.push({ index, timestamp: current.closeTime, price: current.low, kind: "low" });
    }
  }
  return points;
}

export function calculateVwap(candles: AiFuturesCandle[]): number {
  const totals = candles.reduce(
    (result, candle) => {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      return { value: result.value + typicalPrice * candle.volume, volume: result.volume + candle.volume };
    },
    { value: 0, volume: 0 }
  );
  return totals.volume > 0 ? totals.value / totals.volume : lastValue(candles.map((candle) => candle.close));
}

function normalizeClosedCandles(candles: AiFuturesCandle[], closedThrough: number): AiFuturesCandle[] {
  const normalized = candles
    .filter((candle) => candle.closeTime <= closedThrough)
    .map((candle) => {
      if (!isValidCandle(candle)) throw new Error("Malformed Binance futures candle received.");
      return candle;
    })
    .sort((left, right) => left.openTime - right.openTime);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].openTime <= normalized[index - 1].openTime) {
      throw new Error("Duplicate or unordered futures candles received.");
    }
  }
  return normalized;
}

function isValidCandle(candle: AiFuturesCandle): boolean {
  const values = [candle.openTime, candle.closeTime, candle.open, candle.high, candle.low, candle.close, candle.volume];
  return values.every(Number.isFinite) &&
    candle.openTime >= 0 && candle.closeTime > candle.openTime && candle.open > 0 && candle.close > 0 &&
    candle.low > 0 && candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close) &&
    candle.volume >= 0;
}

function buildPriceZones(
  points: AiSwingPoint[],
  atrValue: number,
  currentPrice: number,
  kind: "support" | "resistance"
): AiPriceZone[] {
  const tolerance = Math.max(atrValue * 0.35, currentPrice * 0.001);
  const zones: AiPriceZone[] = [];
  for (const point of points.slice(-24)) {
    const existing = zones.find((zone) => point.price >= zone.low - tolerance && point.price <= zone.high + tolerance);
    if (existing) {
      existing.low = Math.min(existing.low, point.price - tolerance * 0.2);
      existing.high = Math.max(existing.high, point.price + tolerance * 0.2);
      existing.touches += 1;
      existing.strength = Math.min(100, existing.strength + 15);
    } else {
      zones.push({ low: point.price - tolerance * 0.2, high: point.price + tolerance * 0.2, strength: 35, touches: 1 });
    }
  }
  return zones
    .filter((zone) => kind === "support" ? zone.low <= currentPrice : zone.high >= currentPrice)
    .sort((left, right) => {
      const distance = Math.abs(((left.low + left.high) / 2) - currentPrice) - Math.abs(((right.low + right.high) / 2) - currentPrice);
      return distance || right.strength - left.strength;
    })
    .slice(0, 4)
    .map((zone) => ({ ...zone, low: roundTo(zone.low, 8), high: roundTo(zone.high, 8) }));
}

function resolveStructure(highs: AiSwingPoint[], lows: AiSwingPoint[]): AiStructureDirection {
  if (highs.length < 2 || lows.length < 2) return "mixed";
  const latestHighs = highs.slice(-2);
  const latestLows = lows.slice(-2);
  if (latestHighs[1].price > latestHighs[0].price && latestLows[1].price > latestLows[0].price) return "uptrend";
  if (latestHighs[1].price < latestHighs[0].price && latestLows[1].price < latestLows[0].price) return "downtrend";
  return "mixed";
}

function wilderAverage(values: number[], period: number): number[] {
  if (!values.length) return [];
  const output = Array(values.length).fill(values[0]) as number[];
  let running = values[0];
  for (let index = 1; index < values.length; index += 1) {
    running = index < period
      ? ((running * index) + values[index]) / (index + 1)
      : ((running * (period - 1)) + values[index]) / period;
    output[index] = running;
  }
  return output;
}

function rsiValue(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - (100 / (1 + relativeStrength));
}

function realizedVolatility(values: number[], annualization: number): number {
  const returns: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] > 0 && values[index] > 0) returns.push(Math.log(values[index] / values[index - 1]));
  }
  if (returns.length < 2) return 0;
  const mean = average(returns);
  const variance = sum(returns.map((value) => (value - mean) ** 2)) / (returns.length - 1);
  return Math.sqrt(Math.max(0, variance)) * annualization * 100;
}

function zScore(values: number[], value: number): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = sum(values.map((item) => (item - mean) ** 2)) / values.length;
  const deviation = Math.sqrt(Math.max(0, variance));
  return deviation > 0 ? (value - mean) / deviation : 0;
}

function average(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function lastValue(values: number[]): number {
  return values.length ? values[values.length - 1] : 0;
}

function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
