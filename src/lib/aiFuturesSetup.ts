import { AI_FUTURES_ENGINE_VERSION, AI_FUTURES_LIMITS, AI_FUTURES_SCORE_WEIGHTS } from "./aiFuturesConfig.ts";
import {
  decimalAbs,
  decimalAdd,
  decimalDivide,
  decimalMultiply,
  decimalQuantize,
  decimalSubtract,
  decimalToString,
  parseDecimal
} from "./aiFuturesDecimal.ts";
import type {
  AiCandidateSetup,
  AiMarketFeatures,
  AiNormalizedMarketSnapshot,
  AiPriceZone,
  AiScoreBreakdown,
  AiScoreWeights,
  AiSetupDirection,
  AiTakeProfitTarget,
  AiTimeframeFeatures
} from "./aiFuturesTypes.ts";

export interface AiSetupEnginePolicy {
  scoreWeights: AiScoreWeights;
  minimumQualityScore: number;
  minimumScoreDifference: number;
  minimumRewardRisk: number;
  maximumEntryDistanceAtr: number;
  setupLifetimeMinutes: number;
  engineVersion: string;
}

const defaultSetupPolicy: AiSetupEnginePolicy = {
  scoreWeights: AI_FUTURES_SCORE_WEIGHTS,
  minimumQualityScore: AI_FUTURES_LIMITS.minimumQualityScore,
  minimumScoreDifference: AI_FUTURES_LIMITS.minimumScoreDifference,
  minimumRewardRisk: AI_FUTURES_LIMITS.minimumRewardRisk,
  maximumEntryDistanceAtr: AI_FUTURES_LIMITS.maximumEntryDistanceAtr,
  setupLifetimeMinutes: AI_FUTURES_LIMITS.setupLifetimeMinutes,
  engineVersion: AI_FUTURES_ENGINE_VERSION
};

interface ScoredCandidate {
  direction: AiSetupDirection;
  breakdown: AiScoreBreakdown;
  entryZone: AiPriceZone;
  stopLoss: number;
  takeProfits: AiTakeProfitTarget[];
  projectedRewardRisk: number;
  entryDistanceAtr: number;
  supporting: string[];
  conflicts: string[];
}

export function buildAiFuturesCandidate(
  snapshot: AiNormalizedMarketSnapshot,
  features: AiMarketFeatures,
  now = Date.parse(snapshot.capturedAt),
  policyInput: Partial<AiSetupEnginePolicy> = {}
): AiCandidateSetup {
  if (!Number.isFinite(now)) throw new Error("Candidate creation time is invalid.");
  const policy = resolveSetupPolicy(policyInput);
  const longCandidate = scoreCandidate("long", snapshot, features, policy);
  const shortCandidate = scoreCandidate("short", snapshot, features, policy);
  const best = longCandidate.breakdown.total >= shortCandidate.breakdown.total ? longCandidate : shortCandidate;
  const other = best.direction === "long" ? shortCandidate : longCandidate;
  const scoreDifference = best.breakdown.total - other.breakdown.total;
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + policy.setupLifetimeMinutes * 60_000).toISOString();
  const base = {
    currentPrice: snapshot.currentPrice,
    longScore: longCandidate.breakdown,
    shortScore: shortCandidate.breakdown,
    marketRegime: features.regime,
    createdAt,
    expiresAt,
    engineVersion: policy.engineVersion
  };

  if (features.stale) {
    return noTradeCandidate(base, longCandidate, shortCandidate, [
      "Required market data is stale.",
      ...features.staleReasons
    ]);
  }

  if (features.regime === "high_volatility") {
    return noTradeCandidate(base, longCandidate, shortCandidate, [
      "Abnormal intraday volatility makes entry and liquidation estimates unreliable.",
      "Reassess after volatility and candle ranges normalize."
    ]);
  }

  const hasRequiredScore = best.breakdown.total >= policy.minimumQualityScore;
  const hasSeparation = scoreDifference >= policy.minimumScoreDifference;
  const hasRewardRisk = best.projectedRewardRisk >= policy.minimumRewardRisk;
  const conflictingTimeframes = hasTimeframeConflict(features, best.direction);

  if (!hasRequiredScore || !hasSeparation || !hasRewardRisk) {
    const reasons = [
      !hasRequiredScore ? `Best confluence score ${best.breakdown.total}/100 is below the ${policy.minimumQualityScore} minimum.` : null,
      !hasSeparation ? `Long and short scores are separated by only ${scoreDifference} points.` : null,
      !hasRewardRisk ? `Projected reward-to-risk ${best.projectedRewardRisk.toFixed(2)} is below ${policy.minimumRewardRisk}.` : null
    ].filter((reason): reason is string => Boolean(reason));

    const minimumWaitQuality = policy.minimumQualityScore * AI_FUTURES_LIMITS.minimumWaitQualityRatio;
    const minimumWaitSeparation = policy.minimumScoreDifference * AI_FUTURES_LIMITS.minimumWaitSeparationRatio;
    if (conflictingTimeframes && best.breakdown.total >= minimumWaitQuality && scoreDifference >= minimumWaitSeparation && hasRewardRisk) {
      return setupCandidate("WAIT_FOR_ENTRY", best, base, [
        ...reasons,
        "The 15-minute trend conflicts with higher-timeframe context; wait for a confirming closed candle."
      ]);
    }

    return noTradeCandidate(base, longCandidate, shortCandidate, [
      ...reasons,
      "No directional edge is strong enough to justify a futures setup."
    ]);
  }

  if (best.entryDistanceAtr > policy.maximumEntryDistanceAtr) {
    return setupCandidate("WAIT_FOR_ENTRY", best, base, [
      `Price is ${best.entryDistanceAtr.toFixed(2)} ATR from the preferred entry zone.`,
      "Wait for price to return to the entry zone without invalidating market structure."
    ]);
  }

  if (conflictingTimeframes || !isCurrentPriceInZone(snapshot.currentPrice, best.entryZone)) {
    return setupCandidate("WAIT_FOR_ENTRY", best, base, [
      conflictingTimeframes ? "Timeframes are not fully aligned yet." : "Current price has not reached the preferred entry zone.",
      `Activation requires price inside ${formatZone(best.entryZone)} and confirming closed-candle momentum.`
    ]);
  }

  return setupCandidate(best.direction === "long" ? "LONG_SETUP" : "SHORT_SETUP", best, base, []);
}

function scoreCandidate(
  direction: AiSetupDirection,
  snapshot: AiNormalizedMarketSnapshot,
  features: AiMarketFeatures,
  policy: AiSetupEnginePolicy
): ScoredCandidate {
  const levels = buildLevels(direction, snapshot, features);
  const trend = rescaleScore(scoreTrend(direction, features), AI_FUTURES_SCORE_WEIGHTS.multiTimeframeTrend, policy.scoreWeights.multiTimeframeTrend);
  const structure = rescaleScore(scoreStructure(direction, features), AI_FUTURES_SCORE_WEIGHTS.marketStructure, policy.scoreWeights.marketStructure);
  const momentum = rescaleScore(scoreMomentum(direction, features), AI_FUTURES_SCORE_WEIGHTS.momentum, policy.scoreWeights.momentum);
  const volumeVolatility = rescaleScore(scoreVolumeVolatility(direction, features), AI_FUTURES_SCORE_WEIGHTS.volumeVolatility, policy.scoreWeights.volumeVolatility);
  const positioning = rescaleScore(scorePositioning(direction, snapshot, features), AI_FUTURES_SCORE_WEIGHTS.futuresPositioning, policy.scoreWeights.futuresPositioning);
  const sentiment = rescaleScore(scoreSentiment(direction, snapshot.sentiment.fearGreedValue), AI_FUTURES_SCORE_WEIGHTS.sentiment, policy.scoreWeights.sentiment);
  const entryQuality = rescaleScore(
    scoreEntryQuality(levels.projectedRewardRisk, levels.entryDistanceAtr, policy),
    AI_FUTURES_SCORE_WEIGHTS.entryQuality,
    policy.scoreWeights.entryQuality
  );
  const breakdown: AiScoreBreakdown = {
    multiTimeframeTrend: trend.score,
    marketStructure: structure.score,
    momentum: momentum.score,
    volumeVolatility: volumeVolatility.score,
    futuresPositioning: positioning.score,
    sentiment: sentiment.score,
    entryQuality: entryQuality.score,
    total: 0
  };
  breakdown.total = Math.round(
    breakdown.multiTimeframeTrend + breakdown.marketStructure + breakdown.momentum +
    breakdown.volumeVolatility + breakdown.futuresPositioning + breakdown.sentiment + breakdown.entryQuality
  );

  return {
    direction,
    breakdown,
    ...levels,
    supporting: [...trend.supporting, ...structure.supporting, ...momentum.supporting, ...volumeVolatility.supporting, ...positioning.supporting, ...sentiment.supporting],
    conflicts: [...trend.conflicts, ...structure.conflicts, ...momentum.conflicts, ...volumeVolatility.conflicts, ...positioning.conflicts, ...sentiment.conflicts]
  };
}

function buildLevels(direction: AiSetupDirection, snapshot: AiNormalizedMarketSnapshot, features: AiMarketFeatures) {
  const intraday = features.timeframes["15m"];
  const price = snapshot.currentPrice;
  const atr = intraday.atr14;
  const tick = snapshot.filters.tickSize;
  const preferredZone = direction === "long" ? intraday.supports[0] : intraday.resistances[0];
  const fallbackCenter = direction === "long"
    ? Math.min(price, intraday.ema20)
    : Math.max(price, intraday.ema20);
  const center = preferredZone ? (preferredZone.low + preferredZone.high) / 2 : fallbackCenter;
  const halfWidth = Math.max(atr * 0.12, price * 0.0005);
  const entryZone: AiPriceZone = {
    low: roundPrice(center - halfWidth, tick, "down"),
    high: roundPrice(center + halfWidth, tick, "up"),
    strength: preferredZone?.strength ?? 30,
    touches: preferredZone?.touches ?? 0
  };
  const entry = (entryZone.low + entryZone.high) / 2;
  const structuralPoint = direction === "long"
    ? nearestStructuralLow(intraday, entry) ?? entryZone.low
    : nearestStructuralHigh(intraday, entry) ?? entryZone.high;
  const rawStop = direction === "long"
    ? Math.min(entryZone.low, structuralPoint) - atr * 0.25
    : Math.max(entryZone.high, structuralPoint) + atr * 0.25;
  const stopLoss = roundPrice(rawStop, tick, direction === "long" ? "down" : "up");
  const riskDistance = Math.abs(entry - stopLoss);
  const targets = [1.2, 2, 3];
  const allocations = [30, 40, 30];
  const takeProfits = targets.map((multiple, index) => {
    const targetPrice = roundPrice(
      direction === "long" ? entry + riskDistance * multiple : entry - riskDistance * multiple,
      tick,
      direction === "long" ? "down" : "up"
    );
    return {
      label: `TP${index + 1}`,
      price: targetPrice,
      positionSizePercent: allocations[index],
      rMultiple: calculatePostRoundingRMultiple(entry, stopLoss, targetPrice)
    };
  });
  const projectedRewardRisk = calculateWeightedTakeProfitR(entry, stopLoss, takeProfits);
  const distanceFromZone = price < entryZone.low ? entryZone.low - price : price > entryZone.high ? price - entryZone.high : 0;

  return {
    entryZone,
    stopLoss,
    takeProfits,
    projectedRewardRisk,
    entryDistanceAtr: atr > 0 ? round(distanceFromZone / atr, 4) : Number.POSITIVE_INFINITY
  };
}

/**
 * Derives R from the prices that remain after exchange tick rounding. Flooring
 * at the persisted precision prevents a rounded display value from making a
 * candidate appear to clear a configured minimum that its actual levels miss.
 */
export function calculatePostRoundingRMultiple(
  entryPrice: number,
  stopLossPrice: number,
  targetPrice: number
): number {
  const scaled = calculatePostRoundingRScaled(entryPrice, stopLossPrice, targetPrice);
  if (scaled === null) return 0;
  const quantized = decimalQuantize(scaled, rewardRiskQuantum, "floor");
  return quantized === null ? 0 : Number(decimalToString(quantized));
}

export function calculateAllocatedTakeProfitR(
  entryPrice: number,
  stopLossPrice: number,
  targetPrice: number,
  allocationPercent: number
): number {
  const multiple = calculatePostRoundingRScaled(entryPrice, stopLossPrice, targetPrice);
  const allocation = parseDecimal(allocationPercent);
  if (multiple === null || allocation === null || allocation <= 0n) return 0;
  const weighted = decimalDivide(decimalMultiply(multiple, allocation, "floor"), oneHundredDecimal, "floor");
  const quantized = weighted === null ? null : decimalQuantize(weighted, rewardRiskQuantum, "floor");
  return quantized === null ? 0 : Number(decimalToString(quantized));
}

export function calculateWeightedTakeProfitR(
  entryPrice: number,
  stopLossPrice: number,
  targets: Array<{ price: number; positionSizePercent: number }>
): number {
  let total = 0n;
  for (const target of targets) {
    const multiple = calculatePostRoundingRScaled(entryPrice, stopLossPrice, target.price);
    const allocation = parseDecimal(target.positionSizePercent);
    if (multiple === null || allocation === null || allocation <= 0n) return 0;
    const weighted = decimalDivide(decimalMultiply(multiple, allocation, "floor"), oneHundredDecimal, "floor");
    if (weighted === null) return 0;
    total = decimalAdd(total, weighted);
  }
  const quantized = decimalQuantize(total, rewardRiskQuantum, "floor");
  return quantized === null ? 0 : Number(decimalToString(quantized));
}

const rewardRiskQuantum = parseDecimal("0.000001")!;
const oneHundredDecimal = parseDecimal("100")!;

function calculatePostRoundingRScaled(
  entryPrice: number,
  stopLossPrice: number,
  targetPrice: number
): bigint | null {
  const entry = parseDecimal(entryPrice);
  const stop = parseDecimal(stopLossPrice);
  const target = parseDecimal(targetPrice);
  if (entry === null || stop === null || target === null) return null;
  const riskDistance = decimalAbs(decimalSubtract(entry, stop));
  if (riskDistance <= 0n) return null;
  return decimalDivide(decimalAbs(decimalSubtract(target, entry)), riskDistance, "floor");
}

function scoreTrend(direction: AiSetupDirection, features: AiMarketFeatures) {
  const weights: Array<["15m" | "1h" | "4h", number]> = [["15m", 5], ["1h", 7], ["4h", 8]];
  let score = 0;
  const supporting: string[] = [];
  const conflicts: string[] = [];
  for (const [timeframe, weight] of weights) {
    const trend = features.timeframes[timeframe].trend;
    const desired = direction === "long" ? "bullish" : "bearish";
    if (trend === desired) {
      score += weight;
      supporting.push(`${timeframe} EMA trend is ${desired}.`);
    } else if (trend === "neutral") {
      score += weight * 0.35;
      conflicts.push(`${timeframe} EMA trend is neutral.`);
    } else {
      conflicts.push(`${timeframe} EMA trend opposes the ${direction} case.`);
    }
  }
  return scored(score, AI_FUTURES_SCORE_WEIGHTS.multiTimeframeTrend, supporting, conflicts);
}

function scoreStructure(direction: AiSetupDirection, features: AiMarketFeatures) {
  const desired = direction === "long" ? "uptrend" : "downtrend";
  const weights: Array<["15m" | "1h" | "4h", number]> = [["15m", 5], ["1h", 7], ["4h", 8]];
  let score = 0;
  const supporting: string[] = [];
  const conflicts: string[] = [];
  for (const [timeframe, weight] of weights) {
    const structure = features.timeframes[timeframe].structure;
    if (structure === desired) {
      score += weight;
      supporting.push(`${timeframe} swing structure is ${desired}.`);
    } else if (structure === "mixed") {
      score += weight * 0.3;
      conflicts.push(`${timeframe} swing structure is mixed.`);
    } else {
      conflicts.push(`${timeframe} structure opposes the ${direction} candidate.`);
    }
  }
  return scored(score, AI_FUTURES_SCORE_WEIGHTS.marketStructure, supporting, conflicts);
}

function scoreMomentum(direction: AiSetupDirection, features: AiMarketFeatures) {
  const intraday = features.timeframes["15m"];
  const hourly = features.timeframes["1h"];
  let score = 0;
  const supporting: string[] = [];
  const conflicts: string[] = [];
  const rsiSupports = direction === "long" ? intraday.rsi14 >= 50 && intraday.rsi14 <= 72 : intraday.rsi14 <= 50 && intraday.rsi14 >= 28;
  const macdSupports = direction === "long" ? intraday.macdHistogram > 0 : intraday.macdHistogram < 0;
  const hourlyMacdSupports = direction === "long" ? hourly.macdHistogram >= 0 : hourly.macdHistogram <= 0;
  if (rsiSupports) { score += 6; supporting.push(`15m RSI ${intraday.rsi14.toFixed(1)} supports ${direction} momentum.`); }
  else conflicts.push(`15m RSI ${intraday.rsi14.toFixed(1)} does not support a clean ${direction} entry.`);
  if (macdSupports) { score += 5; supporting.push("15m MACD histogram confirms momentum."); }
  else conflicts.push("15m MACD histogram conflicts with the candidate.");
  if (hourlyMacdSupports) { score += 4; supporting.push("1h MACD context agrees."); }
  else conflicts.push("1h MACD context disagrees.");
  return scored(score, AI_FUTURES_SCORE_WEIGHTS.momentum, supporting, conflicts);
}

function scoreVolumeVolatility(direction: AiSetupDirection, features: AiMarketFeatures) {
  const intraday = features.timeframes["15m"];
  let score = features.regime === "high_volatility" ? 0 : 4;
  const supporting: string[] = features.regime !== "high_volatility" ? ["Volatility is within the configured intraday range."] : [];
  const conflicts: string[] = features.regime === "high_volatility" ? ["Intraday volatility is abnormal."] : [];
  if (intraday.volumeZScore >= 0) {
    score += 3;
    supporting.push("Recent volume is at or above its moving baseline.");
  } else {
    conflicts.push("Recent volume is below its moving baseline.");
  }
  const flowAgrees = direction === "long" ? features.takerFlow === "buying" : features.takerFlow === "selling";
  if (flowAgrees) { score += 3; supporting.push(`Taker flow favors ${direction === "long" ? "buyers" : "sellers"}.`); }
  else if (features.takerFlow !== "balanced") conflicts.push("Taker flow opposes the candidate.");
  return scored(score, AI_FUTURES_SCORE_WEIGHTS.volumeVolatility, supporting, conflicts);
}

function scorePositioning(direction: AiSetupDirection, snapshot: AiNormalizedMarketSnapshot, features: AiMarketFeatures) {
  let score = 0;
  const supporting: string[] = [];
  const conflicts: string[] = [];
  const crowdingAgainst = direction === "long" ? features.positioningCrowding === "long_crowded" : features.positioningCrowding === "short_crowded";
  const crowdingOpposite = direction === "long" ? features.positioningCrowding === "short_crowded" : features.positioningCrowding === "long_crowded";
  if (features.positioningCrowding === "balanced") { score += 5; supporting.push("Long/short positioning is balanced."); }
  else if (crowdingOpposite) { score += 4; supporting.push("Opposite-side crowding supports a contrarian setup."); }
  else conflicts.push(`${direction === "long" ? "Long" : "Short"} positioning is crowded.`);
  const flowAgrees = direction === "long" ? snapshot.futures.takerBuySellRatio > 1 : snapshot.futures.takerBuySellRatio < 1;
  if (flowAgrees) { score += 4; supporting.push("Futures taker imbalance confirms direction."); }
  else conflicts.push("Futures taker imbalance opposes direction.");
  if (features.openInterestDirection === "rising") { score += 3; supporting.push("Open interest is rising with the move."); }
  else if (features.openInterestDirection === "flat") score += 1.5;
  else conflicts.push("Open interest is falling.");
  const fundingAgainst = direction === "long" ? features.fundingInterpretation === "longs_pay" : features.fundingInterpretation === "shorts_pay";
  if (!fundingAgainst) { score += 3; supporting.push("Funding is not excessively against the setup."); }
  else conflicts.push("Funding shows same-side positioning pressure.");
  if (crowdingAgainst) score = Math.min(score, 8);
  return scored(score, AI_FUTURES_SCORE_WEIGHTS.futuresPositioning, supporting, conflicts);
}

function scoreSentiment(direction: AiSetupDirection, fearGreed: number) {
  let score = 2.5;
  const supporting: string[] = [];
  const conflicts: string[] = [];
  if (direction === "long" && fearGreed <= 35) { score = 5; supporting.push("Contextual fear is compatible with a contrarian long."); }
  else if (direction === "short" && fearGreed >= 65) { score = 5; supporting.push("Contextual greed is compatible with a contrarian short."); }
  else if ((direction === "long" && fearGreed >= 80) || (direction === "short" && fearGreed <= 20)) {
    score = 0;
    conflicts.push("Extreme contextual sentiment is crowded in the candidate direction.");
  } else supporting.push("Fear & Greed is treated as slow context, not an entry trigger.");
  return scored(score, AI_FUTURES_SCORE_WEIGHTS.sentiment, supporting, conflicts);
}

function scoreEntryQuality(rewardRisk: number, distanceAtr: number, policy: AiSetupEnginePolicy) {
  let score = 0;
  const supporting: string[] = [];
  const conflicts: string[] = [];
  if (rewardRisk >= policy.minimumRewardRisk) { score += 9; supporting.push(`Projected weighted reward-to-risk is ${rewardRisk.toFixed(2)}.`); }
  else conflicts.push("Projected reward-to-risk is insufficient.");
  if (distanceAtr <= 0.25) { score += 6; supporting.push("Price is inside or near the preferred entry zone."); }
  else if (distanceAtr <= policy.maximumEntryDistanceAtr) { score += 3; conflicts.push("Price has not reached the ideal entry zone."); }
  else conflicts.push("Price is excessively extended from the entry zone.");
  return scored(score, AI_FUTURES_SCORE_WEIGHTS.entryQuality, supporting, conflicts);
}

function setupCandidate(
  status: "WAIT_FOR_ENTRY" | "LONG_SETUP" | "SHORT_SETUP",
  candidate: ScoredCandidate,
  base: ReturnType<typeof baseShape>,
  additionalReasons: string[]
): AiCandidateSetup {
  const side = candidate.direction === "long" ? "below" : "above";
  return {
    ...base,
    status,
    direction: candidate.direction,
    entryZone: candidate.entryZone,
    stopLoss: candidate.stopLoss,
    invalidationLevel: candidate.stopLoss,
    takeProfits: candidate.takeProfits,
    suggestedLeverage: suggestedLeverage(base.marketRegime, candidate.entryDistanceAtr),
    projectedRewardRisk: candidate.projectedRewardRisk,
    qualityScore: candidate.breakdown.total,
    scoreBreakdown: candidate.breakdown,
    supportingEvidence: unique(candidate.supporting).slice(0, 10),
    conflictingEvidence: unique(candidate.conflicts).slice(0, 10),
    invalidationConditions: [
      `A closed 15-minute candle beyond the structural stop ${candidate.stopLoss}.`,
      `Market structure fails ${side} the planned entry before activation.`,
      "Required market data becomes stale or unavailable."
    ],
    activationConditions: status === "WAIT_FOR_ENTRY" ? [
      `Price trades inside ${formatZone(candidate.entryZone)}.`,
      `A closed 15-minute candle preserves the ${candidate.direction} structure.`,
      "Momentum and futures positioning remain non-contradictory."
    ] : [],
    reasons: additionalReasons
  };
}

function noTradeCandidate(
  base: ReturnType<typeof baseShape>,
  longCandidate: ScoredCandidate,
  shortCandidate: ScoredCandidate,
  reasons: string[]
): AiCandidateSetup {
  const best = longCandidate.breakdown.total >= shortCandidate.breakdown.total ? longCandidate : shortCandidate;
  return {
    ...base,
    status: "NO_TRADE",
    direction: null,
    entryZone: null,
    stopLoss: null,
    invalidationLevel: null,
    takeProfits: [],
    suggestedLeverage: null,
    projectedRewardRisk: null,
    qualityScore: best.breakdown.total,
    scoreBreakdown: best.breakdown,
    supportingEvidence: [],
    conflictingEvidence: unique([...longCandidate.conflicts, ...shortCandidate.conflicts]).slice(0, 10),
    invalidationConditions: [],
    activationConditions: [],
    reasons: unique(reasons)
  };
}

function baseShape(base: {
  currentPrice: number;
  longScore: AiScoreBreakdown;
  shortScore: AiScoreBreakdown;
  marketRegime: AiCandidateSetup["marketRegime"];
  createdAt: string;
  expiresAt: string;
  engineVersion: string;
}) {
  return base;
}

function scored(score: number, maximum: number, supporting: string[], conflicts: string[]) {
  return { score: round(Math.max(0, Math.min(maximum, score)), 2), supporting, conflicts };
}

function rescaleScore<T extends { score: number }>(result: T, originalMaximum: number, configuredMaximum: number): T {
  return {
    ...result,
    score: round(originalMaximum > 0 ? (result.score / originalMaximum) * configuredMaximum : 0, 2)
  };
}

function resolveSetupPolicy(input: Partial<AiSetupEnginePolicy>): AiSetupEnginePolicy {
  const policy: AiSetupEnginePolicy = {
    ...defaultSetupPolicy,
    ...input,
    scoreWeights: input.scoreWeights ?? defaultSetupPolicy.scoreWeights
  };
  const weights = Object.values(policy.scoreWeights);
  if (weights.some((value) => !Number.isFinite(value) || value < 0) || Math.abs(weights.reduce((sum, value) => sum + value, 0) - 100) > 0.000001) {
    throw new Error("AI Futures score weights must be finite, non-negative, and total 100.");
  }
  for (const value of [
    policy.minimumQualityScore,
    policy.minimumScoreDifference,
    policy.minimumRewardRisk,
    policy.maximumEntryDistanceAtr,
    policy.setupLifetimeMinutes
  ]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("AI Futures setup policy is invalid.");
  }
  if (!policy.engineVersion.trim()) throw new Error("AI Futures engine version is required.");
  return policy;
}

function hasTimeframeConflict(features: AiMarketFeatures, direction: AiSetupDirection): boolean {
  const desired = direction === "long" ? "bullish" : "bearish";
  const opposite = direction === "long" ? "bearish" : "bullish";
  return features.timeframes["15m"].trend === opposite ||
    (features.timeframes["1h"].trend !== desired && features.timeframes["4h"].trend !== desired);
}

function nearestStructuralLow(features: AiTimeframeFeatures, entry: number): number | null {
  const values = [
    ...features.swingLows.map((point) => point.price),
    ...features.supports.map((zone) => zone.low)
  ].filter((price) => price < entry).sort((left, right) => right - left);
  return values[0] ?? null;
}

function nearestStructuralHigh(features: AiTimeframeFeatures, entry: number): number | null {
  const values = [
    ...features.swingHighs.map((point) => point.price),
    ...features.resistances.map((zone) => zone.high)
  ].filter((price) => price > entry).sort((left, right) => left - right);
  return values[0] ?? null;
}

function suggestedLeverage(regime: AiCandidateSetup["marketRegime"], entryDistanceAtr: number): number {
  if (regime === "high_volatility") return 2;
  if (entryDistanceAtr > 0.75) return 3;
  return 5;
}

function isCurrentPriceInZone(price: number, zone: AiPriceZone): boolean {
  return price >= zone.low && price <= zone.high;
}

function formatZone(zone: AiPriceZone): string {
  return `${zone.low.toLocaleString("en-US")}–${zone.high.toLocaleString("en-US")}`;
}

function roundPrice(value: number, tickText: string, mode: "up" | "down"): number {
  const tick = Number(tickText);
  if (!Number.isFinite(value) || !Number.isFinite(tick) || tick <= 0) throw new Error("Invalid Binance price filter.");
  const units = value / tick;
  const rounded = mode === "up" ? Math.ceil(units - Number.EPSILON) : Math.floor(units + Number.EPSILON);
  return round(rounded * tick, decimalPlaces(tickText));
}

function decimalPlaces(value: string): number {
  const fraction = value.split(".")[1]?.replace(/0+$/, "") ?? "";
  return fraction.length;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
