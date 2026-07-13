import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const moduleNames = [
  "aiFuturesTypes",
  "aiFuturesConfig",
  "aiFuturesDecimal",
  "aiFuturesRisk",
  "aiFuturesFeatures",
  "aiFuturesSetup",
  "aiFuturesValidator",
  "aiFuturesOutcome"
];
const tempDir = await mkdtemp(join(tmpdir(), "ai-futures-engine-"));
const outcomeEdgeSource = await readFile(
  new URL("../supabase/functions/ai-futures-outcomes/index.ts", import.meta.url),
  "utf8"
);

for (const moduleName of moduleNames) {
  const source = await readFile(new URL(`../src/lib/${moduleName}.ts`, import.meta.url), "utf8");
  await writeFile(join(tempDir, `${moduleName}.mjs`), rewriteImports(transpile(source)));
}

const config = await importModule("aiFuturesConfig");
const featuresEngine = await importModule("aiFuturesFeatures");
const setupEngine = await importModule("aiFuturesSetup");
const validator = await importModule("aiFuturesValidator");
const outcomes = await importModule("aiFuturesOutcome");

after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
}

function rewriteImports(source) {
  let output = source;
  for (const moduleName of moduleNames) {
    output = output
      .replaceAll(`"./${moduleName}.ts"`, `"./${moduleName}.mjs"`)
      .replaceAll(`"./${moduleName}"`, `"./${moduleName}.mjs"`)
      .replaceAll(`'./${moduleName}.ts'`, `'./${moduleName}.mjs'`)
      .replaceAll(`'./${moduleName}'`, `'./${moduleName}.mjs'`);
  }
  return output;
}

function importModule(moduleName) {
  return import(pathToFileURL(join(tempDir, `${moduleName}.mjs`)));
}

const NOW = Date.parse("2026-07-12T12:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();

function candle({ openTime, closeTime, open, high, low, close, volume = 100 }) {
  return {
    openTime,
    closeTime,
    open,
    high,
    low,
    close,
    volume,
    quoteVolume: volume * close,
    takerBuyBaseVolume: volume * 0.52,
    takerBuyQuoteVolume: volume * close * 0.52
  };
}

function candleSeries(intervalMs, direction = "up", count = 240) {
  const sign = direction === "down" ? -1 : 1;
  const start = NOW - count * intervalMs;
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const close = 100 + sign * index * 0.12 + Math.sin(index / 4) * 2;
    const open = close - sign * 0.1;
    result.push(candle({
      openTime: start + index * intervalMs,
      closeTime: start + (index + 1) * intervalMs - 1,
      open,
      high: Math.max(open, close) + 0.45,
      low: Math.min(open, close) - 0.45,
      close,
      volume: 100 + (index % 13) * 3
    }));
  }
  return result;
}

function sourceTimestamp(overrides = {}) {
  return {
    category: "candles_15m",
    source: "Binance USD-M Futures",
    observedAt: NOW_ISO,
    sourceAt: NOW_ISO,
    ageSeconds: 0,
    stale: false,
    ...overrides
  };
}

function marketSnapshot(overrides = {}) {
  const candles = {
    "15m": candleSeries(15 * 60_000),
    "1h": candleSeries(60 * 60_000),
    "4h": candleSeries(4 * 60 * 60_000)
  };
  return {
    symbol: "BTCUSDT",
    analysisTimeframe: "15m",
    candleCloseAt: NOW_ISO,
    capturedAt: NOW_ISO,
    currentPrice: candles["15m"].at(-1).close,
    candles,
    futures: {
      markPrice: candles["15m"].at(-1).close,
      priceKind: "exchange_mark",
      indexPrice: candles["15m"].at(-1).close - 0.02,
      fundingRate: 0,
      nextFundingAt: null,
      openInterest: 1_000_000,
      openInterestChangePercent: 2,
      globalLongShortRatio: 1.05,
      topTraderLongShortRatio: 1.05,
      takerBuySellRatio: 1.1,
      basisPercent: 0.01
    },
    sentiment: {
      fearGreedValue: 45,
      fearGreedClassification: "Fear",
      source: "Alternative.me",
      sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
      timestamp: NOW_ISO
    },
    filters: {
      tickSize: "0.01",
      stepSize: "0.001",
      minQuantity: "0.001",
      minNotional: "5",
      maxLeverage: 20
    },
    sourceTimestamps: [sourceTimestamp()],
    source: "Binance USD-M Futures",
    marketDataTransport: "binance_direct",
    ...overrides
  };
}

function timeframeFeatures(direction = "long", timeframe = "15m") {
  const bullish = direction === "long";
  return {
    timeframe,
    candleCount: 240,
    lastClosedAt: NOW_ISO,
    close: 100,
    ema20: 100,
    ema50: bullish ? 99 : 101,
    ema200: bullish ? 98 : 102,
    rsi14: bullish ? 60 : 40,
    macd: bullish ? 1 : -1,
    macdSignal: bullish ? 0.5 : -0.5,
    macdHistogram: bullish ? 0.5 : -0.5,
    atr14: 1,
    atrPercent: 1,
    adx14: 35,
    vwap: 99.5,
    volumeAverage20: 100,
    volumeZScore: 1,
    realizedVolatility: 25,
    averageBodyPercent: 0.3,
    averageUpperWickPercent: 0.1,
    averageLowerWickPercent: 0.1,
    trend: bullish ? "bullish" : "bearish",
    structure: bullish ? "uptrend" : "downtrend",
    swingHighs: [],
    swingLows: [],
    supports: [],
    resistances: []
  };
}

function scoredFeatures(direction = "long", overrides = {}) {
  const bullish = direction === "long";
  return {
    calculatedAt: NOW_ISO,
    candleCloseAt: NOW_ISO,
    timeframes: {
      "15m": timeframeFeatures(direction, "15m"),
      "1h": timeframeFeatures(direction, "1h"),
      "4h": timeframeFeatures(direction, "4h")
    },
    multiTimeframeTrend: bullish ? "bullish" : "bearish",
    trendAlignmentScore: 100,
    regime: "trending",
    currentDistanceFromEma20Atr: 0,
    markIndexBasisPercent: 0,
    fundingInterpretation: "neutral",
    positioningCrowding: "balanced",
    openInterestDirection: "rising",
    takerFlow: bullish ? "buying" : "selling",
    sourceTimestamps: [sourceTimestamp()],
    stale: false,
    staleReasons: [],
    ...overrides
  };
}

function scoredSnapshot(direction = "long", overrides = {}) {
  const bullish = direction === "long";
  return marketSnapshot({
    currentPrice: 100,
    futures: {
      ...marketSnapshot().futures,
      takerBuySellRatio: bullish ? 1.2 : 0.8
    },
    sentiment: {
      ...marketSnapshot().sentiment,
      fearGreedValue: bullish ? 25 : 75
    },
    ...overrides
  });
}

function neutralFeatures() {
  const neutral = timeframeFeatures("long");
  neutral.trend = "neutral";
  neutral.structure = "mixed";
  neutral.rsi14 = 50;
  neutral.macd = 0;
  neutral.macdSignal = 0;
  neutral.macdHistogram = 0;
  neutral.volumeZScore = -1;
  return scoredFeatures("long", {
    timeframes: {
      "15m": { ...neutral, timeframe: "15m" },
      "1h": { ...neutral, timeframe: "1h" },
      "4h": { ...neutral, timeframe: "4h" }
    },
    multiTimeframeTrend: "neutral",
    trendAlignmentScore: 0,
    regime: "ranging",
    openInterestDirection: "flat",
    takerFlow: "balanced"
  });
}

function validReview(verdict = "APPROVE") {
  return {
    verdict,
    market_summary: "Trend and structure agree without removing uncertainty.",
    primary_thesis: "Momentum supports the deterministic thesis.",
    supporting_factors: ["Structure is aligned."],
    conflicting_factors: ["Crowding can change."],
    invalidation_explanation: "The structural stop invalidates the thesis.",
    risk_notes: ["Use isolated margin and respect the planned stop."],
    educational_explanation: "This is an educational scenario, not financial advice."
  };
}

function riskProfile(overrides = {}) {
  return {
    preset: "balanced",
    planningBalance: "1000",
    riskPercent: "1",
    maxLeverage: 5,
    maxMarginPercent: "30",
    saveProfile: false,
    ...overrides
  };
}

function validationInput(candidate, featureSet = scoredFeatures("long"), overrides = {}) {
  return {
    candidate,
    features: featureSet,
    review: null,
    riskProfile: riskProfile(),
    filters: scoredSnapshot().filters,
    subscriptionAuthorized: true,
    intendedSnapshotCloseAt: NOW_ISO,
    currentSnapshotCloseAt: NOW_ISO,
    deterministicOnlyAllowed: true,
    currentMarketPrice: 100,
    setupOutcomeStatus: "awaiting_entry",
    now: NOW,
    ...overrides
  };
}

function outcomeSetup(direction = "long", overrides = {}) {
  const isLong = direction === "long";
  return {
    status: isLong ? "LONG_SETUP" : "SHORT_SETUP",
    direction,
    currentPrice: 100,
    entryZone: { low: 99, high: 101, strength: 80, touches: 3 },
    stopLoss: isLong ? 95 : 105,
    invalidationLevel: isLong ? 95 : 105,
    takeProfits: isLong
      ? [
          { label: "TP1", price: 106, positionSizePercent: 50, rMultiple: 1.2 },
          { label: "TP2", price: 110, positionSizePercent: 50, rMultiple: 2 }
        ]
      : [
          { label: "TP1", price: 94, positionSizePercent: 50, rMultiple: 1.2 },
          { label: "TP2", price: 90, positionSizePercent: 50, rMultiple: 2 }
        ],
    suggestedLeverage: 3,
    projectedRewardRisk: 1.6,
    qualityScore: 90,
    longScore: {},
    shortScore: {},
    scoreBreakdown: {},
    marketRegime: "trending",
    supportingEvidence: [],
    conflictingEvidence: [],
    invalidationConditions: [],
    activationConditions: [],
    reasons: [],
    createdAt: NOW_ISO,
    expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
    engineVersion: "test",
    ...overrides
  };
}

function outcomeCandle(minute, { open = 100, high = 101, low = 99, close = 100 } = {}) {
  const openTime = NOW + minute * 60_000;
  return candle({
    openTime,
    closeTime: openTime + 59_999,
    open,
    high,
    low,
    close
  });
}

function assertClose(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

test("score weights remain a complete one-hundred-point model", () => {
  assert.equal(config.scoreWeightsTotal(config.AI_FUTURES_SCORE_WEIGHTS), 100);
  assert.deepEqual(config.AI_FUTURES_SCORE_WEIGHTS, {
    multiTimeframeTrend: 20,
    marketStructure: 20,
    momentum: 15,
    volumeVolatility: 10,
    futuresPositioning: 15,
    sentiment: 5,
    entryQuality: 15
  });
});

test("fixed indicator fixtures produce deterministic EMA, RSI, ATR, VWAP, and swing points", () => {
  const ema = featuresEngine.ema([1, 2, 3], 2);
  assertClose(ema[0], 1);
  assertClose(ema[1], 5 / 3);
  assertClose(ema[2], 23 / 9);
  assert.equal(featuresEngine.rsi(Array.from({ length: 20 }, (_, index) => index + 1), 14).at(-1), 100);

  const fixedCandles = [
    candle({ openTime: 0, closeTime: 1, open: 10, high: 12, low: 9, close: 11, volume: 2 }),
    candle({ openTime: 2, closeTime: 3, open: 11, high: 13, low: 10, close: 12, volume: 1 }),
    candle({ openTime: 4, closeTime: 5, open: 12, high: 14, low: 11, close: 13, volume: 3 })
  ];
  assert.deepEqual(featuresEngine.atr(fixedCandles, 2), [3, 3, 3]);
  assertClose(featuresEngine.calculateVwap(fixedCandles), 11.833333333333334);

  const swingCandles = [10, 12, 9, 13, 8, 11, 10].map((close, index) =>
    candle({ openTime: index * 2, closeTime: index * 2 + 1, open: close, high: close + 1, low: close - 1, close })
  );
  assert.deepEqual(
    featuresEngine.findSwingPoints(swingCandles, 1).map(({ index, kind }) => ({ index, kind })),
    [
      { index: 1, kind: "high" },
      { index: 2, kind: "low" },
      { index: 3, kind: "high" },
      { index: 4, kind: "low" },
      { index: 5, kind: "high" }
    ]
  );
});

test("feature calculation is repeatable and ignores candles that have not closed", () => {
  const snapshot = marketSnapshot();
  const first = featuresEngine.calculateMarketFeatures(snapshot, NOW);
  const second = featuresEngine.calculateMarketFeatures(structuredClone(snapshot), NOW);
  assert.deepEqual(second, first);

  const futureShock = candle({
    openTime: NOW,
    closeTime: NOW + 15 * 60_000 - 1,
    open: snapshot.currentPrice,
    high: snapshot.currentPrice * 20,
    low: snapshot.currentPrice / 20,
    close: snapshot.currentPrice * 10,
    volume: 1_000_000
  });
  const withOpenCandle = structuredClone(snapshot);
  withOpenCandle.candles["15m"].push(futureShock);
  assert.deepEqual(featuresEngine.calculateMarketFeatures(withOpenCandle, NOW), first);

  assert.equal(first.timeframes["15m"].candleCount, 240);
  assert.equal(first.timeframes["15m"].trend, "bullish");
  assert.equal(first.timeframes["15m"].rsi14 > 50, true);
  assert.equal(first.timeframes["15m"].ema20 > first.timeframes["15m"].ema50, true);
  assert.equal(first.timeframes["15m"].ema50 > first.timeframes["15m"].ema200, true);
  assert.equal(first.timeframes["15m"].structure, "uptrend");
  assert.ok(first.timeframes["15m"].swingHighs.length >= 2);
  assert.ok(first.timeframes["15m"].swingLows.length >= 2);
  assert.ok(first.timeframes["15m"].supports.length >= 1);
  assert.equal(first.multiTimeframeTrend, "bullish");
  assert.equal(first.trendAlignmentScore, 100);
  assert.equal(first.stale, false);
});

test("fixed fixtures resolve market structure, zones, and weighted multi-timeframe alignment", () => {
  const rising = featuresEngine.calculateTimeframeFeatures("15m", candleSeries(15 * 60_000, "up"));
  const falling = featuresEngine.calculateTimeframeFeatures("15m", candleSeries(15 * 60_000, "down"));
  assert.equal(rising.structure, "uptrend");
  assert.ok(rising.supports.length > 0);
  assert.equal(falling.structure, "downtrend");
  assert.ok(falling.resistances.length > 0);

  const mixedSnapshot = marketSnapshot();
  mixedSnapshot.candles["1h"] = candleSeries(60 * 60_000, "down");
  mixedSnapshot.candles["4h"] = candleSeries(4 * 60 * 60_000, "down");
  const mixed = featuresEngine.calculateMarketFeatures(mixedSnapshot, NOW);
  assert.equal(mixed.timeframes["15m"].trend, "bullish");
  assert.equal(mixed.timeframes["1h"].trend, "bearish");
  assert.equal(mixed.timeframes["4h"].trend, "bearish");
  assert.equal(mixed.multiTimeframeTrend, "bearish");
  assertClose(mixed.trendAlignmentScore, 83.33);
});

test("abnormal closed-candle ranges are classified as high volatility", () => {
  const snapshot = marketSnapshot();
  for (const item of snapshot.candles["15m"].slice(-30)) {
    item.high = Math.max(item.open, item.close) + 10;
    item.low = Math.min(item.open, item.close) - 10;
  }
  const result = featuresEngine.calculateMarketFeatures(snapshot, NOW);
  assert.ok(result.timeframes["15m"].atrPercent >= config.AI_FUTURES_LIMITS.abnormalAtrPercent15m);
  assert.equal(result.regime, "high_volatility");
});

test("feature calculation fails closed for insufficient, duplicate, and malformed candles", () => {
  const insufficient = marketSnapshot();
  insufficient.candles["1h"] = insufficient.candles["1h"].slice(-219);
  assert.throws(
    () => featuresEngine.calculateMarketFeatures(insufficient, NOW),
    /1h requires at least 220 closed candles/
  );

  const duplicate = marketSnapshot();
  duplicate.candles["15m"][5] = structuredClone(duplicate.candles["15m"][4]);
  assert.throws(() => featuresEngine.calculateMarketFeatures(duplicate, NOW), /Duplicate or unordered/);

  const malformed = marketSnapshot();
  malformed.candles["4h"][10].low = malformed.candles["4h"][10].high + 1;
  assert.throws(() => featuresEngine.calculateMarketFeatures(malformed, NOW), /Malformed Binance futures candle/);
});

test("stale source metadata and futures positioning are normalized deterministically", () => {
  const snapshot = marketSnapshot({
    futures: {
      ...marketSnapshot().futures,
      fundingRate: 0.0002,
      openInterestChangePercent: -2,
      globalLongShortRatio: 1.5,
      topTraderLongShortRatio: 1.1,
      takerBuySellRatio: 0.9
    },
    sourceTimestamps: [sourceTimestamp({ category: "positioning", stale: true, ageSeconds: 1_500 })]
  });
  const result = featuresEngine.calculateMarketFeatures(snapshot, NOW);
  assert.equal(result.stale, true);
  assert.deepEqual(result.staleReasons, ["positioning is stale (1500s old)."]);
  assert.equal(result.fundingInterpretation, "longs_pay");
  assert.equal(result.positioningCrowding, "long_crowded");
  assert.equal(result.openInterestDirection, "falling");
  assert.equal(result.takerFlow, "selling");
});

test("aligned fixtures create deterministic long and short setups", () => {
  const longSnapshot = scoredSnapshot("long");
  const longFeatures = scoredFeatures("long");
  const firstLong = setupEngine.buildAiFuturesCandidate(longSnapshot, longFeatures, NOW);
  const secondLong = setupEngine.buildAiFuturesCandidate(structuredClone(longSnapshot), structuredClone(longFeatures), NOW);
  assert.deepEqual(secondLong, firstLong);
  assert.equal(firstLong.status, "LONG_SETUP");
  assert.equal(firstLong.direction, "long");
  assert.equal(firstLong.qualityScore, 100);

  const short = setupEngine.buildAiFuturesCandidate(scoredSnapshot("short"), scoredFeatures("short"), NOW);
  assert.equal(short.status, "SHORT_SETUP");
  assert.equal(short.direction, "short");
  assert.equal(short.qualityScore, 100);
});

test("setup levels obey direction, exchange ticks, reward ordering, and exact allocation", () => {
  for (const direction of ["long", "short"]) {
    const candidate = setupEngine.buildAiFuturesCandidate(scoredSnapshot(direction), scoredFeatures(direction), NOW);
    const midpoint = (candidate.entryZone.low + candidate.entryZone.high) / 2;
    assert.equal(candidate.takeProfits.reduce((total, target) => total + target.positionSizePercent, 0), 100);
    assert.deepEqual(candidate.takeProfits.map((target) => target.positionSizePercent), [30, 40, 30]);
    assert.deepEqual(
      candidate.takeProfits.map((target) => target.rMultiple),
      candidate.takeProfits.map((target) => setupEngine.calculatePostRoundingRMultiple(
        midpoint,
        candidate.stopLoss,
        target.price
      ))
    );
    assert.equal(candidate.takeProfits[0].rMultiple, 1.189189);
    assert.equal(candidate.takeProfits[1].rMultiple, 2);
    assert.equal(candidate.takeProfits[2].rMultiple, 3);
    assert.equal(candidate.projectedRewardRisk, 2.056756);
    assert.ok(candidate.projectedRewardRisk < 2.06, "tick rounding must not preserve the optimistic nominal RR");
    for (const level of [candidate.entryZone.low, candidate.entryZone.high, candidate.stopLoss, ...candidate.takeProfits.map((target) => target.price)]) {
      assertClose(level / 0.01, Math.round(level / 0.01), 1e-6);
    }
    if (direction === "long") {
      assert.ok(candidate.stopLoss < candidate.entryZone.low);
      assert.ok(candidate.takeProfits.every((target) => target.price > candidate.entryZone.high));
      assert.deepEqual(candidate.takeProfits.map((target) => target.price), [...candidate.takeProfits].map((target) => target.price).sort((a, b) => a - b));
    } else {
      assert.ok(candidate.stopLoss > candidate.entryZone.high);
      assert.ok(candidate.takeProfits.every((target) => target.price < candidate.entryZone.low));
      assert.deepEqual(candidate.takeProfits.map((target) => target.price), [...candidate.takeProfits].map((target) => target.price).sort((a, b) => b - a));
    }
    assert.ok(midpoint > 0);
  }
});

test("extended price and conflicting timeframes downgrade otherwise strong candidates to wait", () => {
  const distant = scoredFeatures("long");
  distant.timeframes["15m"].supports = [{ low: 98.9, high: 99.1, strength: 75, touches: 3 }];
  const distantCandidate = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), distant, NOW);
  assert.equal(distantCandidate.status, "WAIT_FOR_ENTRY");
  assert.ok(distantCandidate.reasons.some((reason) => reason.includes("preferred entry zone") || reason.includes("Activation requires")));

  const conflict = scoredFeatures("long");
  conflict.timeframes["15m"].trend = "bearish";
  const conflictCandidate = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), conflict, NOW);
  assert.equal(conflictCandidate.status, "WAIT_FOR_ENTRY");
  assert.ok(conflictCandidate.reasons.some((reason) => reason.includes("not fully aligned") || reason.includes("conflicts")));
});

test("weak confluence, stale data, and abnormal volatility fail closed to no trade", () => {
  const weak = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), neutralFeatures(), NOW);
  assert.equal(weak.status, "NO_TRADE");
  assert.equal(weak.direction, null);
  assert.ok(weak.reasons.some((reason) => reason.includes("No directional edge")));

  const stale = scoredFeatures("long", { stale: true, staleReasons: ["candles are stale"] });
  const staleCandidate = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), stale, NOW);
  assert.equal(staleCandidate.status, "NO_TRADE");
  assert.ok(staleCandidate.reasons.includes("Required market data is stale."));

  const volatile = scoredFeatures("long", { regime: "high_volatility" });
  const volatileCandidate = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), volatile, NOW);
  assert.equal(volatileCandidate.status, "NO_TRADE");
  assert.ok(volatileCandidate.reasons.some((reason) => reason.includes("Abnormal intraday volatility")));
});

test("same-side crowding is a visible scoring penalty rather than a hidden override", () => {
  const balanced = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), scoredFeatures("long"), NOW);
  const crowdedFeatures = scoredFeatures("long", { positioningCrowding: "long_crowded" });
  const crowded = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), crowdedFeatures, NOW);
  assert.equal(balanced.longScore.futuresPositioning, 15);
  assert.equal(crowded.longScore.futuresPositioning, 8);
  assert.equal(crowded.qualityScore, balanced.qualityScore - 7);
  assert.ok(crowded.conflictingEvidence.some((reason) => reason.includes("positioning is crowded")));
});

test("setup policy overrides weights, thresholds, lifetime, entry distance, and engine version", () => {
  const snapshot = scoredSnapshot("long");
  const featureSet = scoredFeatures("long");
  const trendOnlyWeights = {
    multiTimeframeTrend: 100,
    marketStructure: 0,
    momentum: 0,
    volumeVolatility: 0,
    futuresPositioning: 0,
    sentiment: 0,
    entryQuality: 0
  };
  const configured = setupEngine.buildAiFuturesCandidate(snapshot, featureSet, NOW, {
    scoreWeights: trendOnlyWeights,
    minimumQualityScore: 90,
    minimumScoreDifference: 10,
    minimumRewardRisk: 1.5,
    setupLifetimeMinutes: 15,
    engineVersion: "configured-engine"
  });
  assert.equal(configured.status, "LONG_SETUP");
  assert.equal(configured.longScore.multiTimeframeTrend, 100);
  assert.equal(configured.longScore.marketStructure, 0);
  assert.equal(configured.longScore.total, 100);
  assert.equal(configured.engineVersion, "configured-engine");
  assert.equal(Date.parse(configured.expiresAt) - Date.parse(configured.createdAt), 15 * 60_000);

  const strictScore = setupEngine.buildAiFuturesCandidate(snapshot, featureSet, NOW, { minimumQualityScore: 101 });
  assert.equal(strictScore.status, "NO_TRADE");
  assert.ok(strictScore.reasons.some((reason) => reason.includes("101 minimum")));

  const strictReward = setupEngine.buildAiFuturesCandidate(snapshot, featureSet, NOW, { minimumRewardRisk: 2.1 });
  assert.equal(strictReward.status, "NO_TRADE");
  assert.ok(strictReward.reasons.some((reason) => reason.includes("below 2.1")));

  const exactPostRoundingReward = setupEngine.buildAiFuturesCandidate(snapshot, featureSet, NOW, { minimumRewardRisk: 2.06 });
  assert.equal(exactPostRoundingReward.status, "NO_TRADE");
  assert.ok(exactPostRoundingReward.reasons.some((reason) => reason.includes("below 2.06")));

  const distant = scoredFeatures("long");
  distant.timeframes["15m"].supports = [{ low: 98.9, high: 99.1, strength: 75, touches: 3 }];
  const strictDistance = setupEngine.buildAiFuturesCandidate(snapshot, distant, NOW, { maximumEntryDistanceAtr: 0.5 });
  assert.equal(strictDistance.status, "WAIT_FOR_ENTRY");
  assert.ok(strictDistance.reasons.some((reason) => reason.includes("ATR from the preferred entry zone")));

  assert.throws(
    () => setupEngine.buildAiFuturesCandidate(snapshot, featureSet, NOW, {
      scoreWeights: { ...trendOnlyWeights, multiTimeframeTrend: 99 }
    }),
    /score weights must be finite, non-negative, and total 100/
  );
});

test("final validation creates a bounded fixed-point plan for a valid candidate", () => {
  const candidate = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), scoredFeatures("long"), NOW);
  const result = validator.validateFinalAiAnalysis(validationInput(candidate));
  assert.equal(result.status, "LONG_SETUP");
  assert.equal(result.errors.length, 0);
  assert.equal(result.deterministicOnly, true);
  assert.equal(result.plan.direction, "long");
  assert.ok(Number(result.plan.plannedMaximumLoss) <= Number(result.plan.riskBudget));
  assert.ok(Number(result.plan.marginPercent) <= 30);
  assert.ok(result.plan.leverage <= 5);
});

test("final validation rejects missing access, stale/changed snapshots, and expired setups", () => {
  const candidate = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), scoredFeatures("long"), NOW);
  const cases = [
    {
      overrides: { subscriptionAuthorized: false },
      expected: "Active Trading Academy access is required."
    },
    {
      overrides: { currentSnapshotCloseAt: new Date(NOW + 15 * 60_000).toISOString() },
      expected: "Analysis snapshot identity changed during generation."
    },
    {
      overrides: { now: Date.parse(candidate.expiresAt) },
      expected: "The setup has expired."
    },
    {
      featureSet: scoredFeatures("long", { stale: true, staleReasons: ["funding is stale"] }),
      expected: "funding is stale"
    }
  ];
  for (const scenario of cases) {
    const result = validator.validateFinalAiAnalysis(
      validationInput(candidate, scenario.featureSet ?? scoredFeatures("long"), scenario.overrides ?? {})
    );
    assert.equal(result.status, "DATA_UNAVAILABLE");
    assert.ok(result.errors.includes(scenario.expected));
    assert.equal(result.plan, null);
  }
});

test("final validation applies live setup lifecycle state without ever upgrading a wait", () => {
  const candidate = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), scoredFeatures("long"), NOW);

  let result = validator.validateFinalAiAnalysis(validationInput(candidate, scoredFeatures("long"), {
    currentMarketPrice: candidate.entryZone.high + 0.01
  }));
  assert.equal(result.status, "WAIT_FOR_ENTRY");
  assert.equal(result.plan.direction, "long");
  assert.ok(result.candidate.reasons.some((reason) => reason.includes("outside the approved entry zone")));

  result = validator.validateFinalAiAnalysis(validationInput(candidate, scoredFeatures("long"), {
    currentMarketPrice: candidate.invalidationLevel
  }));
  assert.equal(result.status, "NO_TRADE");
  assert.equal(result.plan, null);
  assert.equal(result.candidate.direction, null);

  result = validator.validateFinalAiAnalysis(validationInput(candidate, scoredFeatures("long"), {
    setupOutcomeStatus: "tp_partial"
  }));
  assert.equal(result.status, "NO_TRADE");
  assert.ok(result.candidate.reasons.some((reason) => reason.includes("no longer a fresh entry")));

  const waiting = structuredClone(candidate);
  waiting.status = "WAIT_FOR_ENTRY";
  result = validator.validateFinalAiAnalysis(validationInput(waiting));
  assert.equal(result.status, "WAIT_FOR_ENTRY");
});

test("final validation rejects invalid reward, target ordering, allocation, and risk bounds", () => {
  const base = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), scoredFeatures("long"), NOW);

  const lowReward = structuredClone(base);
  const entry = (lowReward.entryZone.low + lowReward.entryZone.high) / 2;
  [100.13, 100.14, 100.15].forEach((price, index) => {
    lowReward.takeProfits[index].price = price;
    lowReward.takeProfits[index].rMultiple = setupEngine.calculatePostRoundingRMultiple(entry, lowReward.stopLoss, price);
  });
  lowReward.projectedRewardRisk = setupEngine.calculateWeightedTakeProfitR(entry, lowReward.stopLoss, lowReward.takeProfits);
  let result = validator.validateFinalAiAnalysis(validationInput(lowReward));
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.ok(result.errors.includes("Reward-to-risk is below the configured minimum."));

  const invalidTarget = structuredClone(base);
  invalidTarget.takeProfits[0].price = invalidTarget.entryZone.high;
  result = validator.validateFinalAiAnalysis(validationInput(invalidTarget));
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.ok(result.errors.some((error) => error.includes("must be above long entry")));

  const invalidAllocation = structuredClone(base);
  invalidAllocation.takeProfits[0].positionSizePercent = 29;
  result = validator.validateFinalAiAnalysis(validationInput(invalidAllocation));
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.ok(result.errors.includes("Take-profit allocations must total exactly 100%."));

  result = validator.validateFinalAiAnalysis(validationInput(base, scoredFeatures("long"), {
    riskProfile: riskProfile({ riskPercent: "3.01" })
  }));
  assert.equal(result.status, "RISK_LIMIT_EXCEEDED");
  assert.ok(result.errors.includes("Risk per trade is outside server safety bounds."));
});

test("final validation honors stricter runtime policy but never loosens absolute safety caps", () => {
  const candidate = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), scoredFeatures("long"), NOW);

  let result = validator.validateFinalAiAnalysis(validationInput(candidate, scoredFeatures("long"), {
    policy: { minimumSetupScore: 101 }
  }));
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.ok(result.errors.includes("Setup Quality Score is below the configured minimum."));

  result = validator.validateFinalAiAnalysis(validationInput(candidate, scoredFeatures("long"), {
    policy: { minimumRewardRisk: 2.1 }
  }));
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.ok(result.errors.includes("Reward-to-risk is below the configured minimum."));

  const riskPolicyCases = [
    {
      policy: { maximumRiskPercent: 0.5 },
      profile: riskProfile(),
      message: "Risk per trade is outside server safety bounds."
    },
    {
      policy: { maximumLeverage: 3 },
      profile: riskProfile(),
      message: "Maximum leverage is outside server safety bounds."
    },
    {
      policy: { maximumMarginPercent: 20 },
      profile: riskProfile(),
      message: "Maximum margin allocation is outside server safety bounds."
    },
    {
      policy: { maximumRiskPercent: 100, maximumLeverage: 100, maximumMarginPercent: 100 },
      profile: riskProfile({ riskPercent: "3.01", maxLeverage: 11, maxMarginPercent: "51" }),
      message: "Risk per trade is outside server safety bounds."
    }
  ];
  for (const scenario of riskPolicyCases) {
    result = validator.validateFinalAiAnalysis(validationInput(candidate, scoredFeatures("long"), {
      policy: scenario.policy,
      riskProfile: scenario.profile
    }));
    assert.equal(result.status, "RISK_LIMIT_EXCEEDED");
    assert.ok(result.errors.includes(scenario.message));
  }
});

test("independent review can only approve, downgrade, or reject deterministic levels", () => {
  const candidate = setupEngine.buildAiFuturesCandidate(scoredSnapshot("long"), scoredFeatures("long"), NOW);

  let result = validator.validateFinalAiAnalysis(validationInput(candidate, scoredFeatures("long"), {
    review: null,
    deterministicOnlyAllowed: false
  }));
  assert.equal(result.status, "DATA_UNAVAILABLE");

  result = validator.validateFinalAiAnalysis(validationInput(candidate, scoredFeatures("long"), {
    review: validReview("DOWNGRADE_TO_WAIT")
  }));
  assert.equal(result.status, "WAIT_FOR_ENTRY");
  assert.deepEqual(result.candidate.entryZone, candidate.entryZone);
  assert.equal(result.candidate.stopLoss, candidate.stopLoss);
  assert.deepEqual(result.candidate.takeProfits, candidate.takeProfits);

  result = validator.validateFinalAiAnalysis(validationInput(candidate, scoredFeatures("long"), {
    review: validReview("REJECT")
  }));
  assert.equal(result.status, "NO_TRADE");
  assert.equal(result.candidate.direction, null);
  assert.equal(result.plan, null);

  const numericReview = validReview("APPROVE");
  numericReview.market_summary = "Momentum is stronger by 10 percent.";
  result = validator.validateFinalAiAnalysis(validationInput(candidate, scoredFeatures("long"), {
    review: numericReview
  }));
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.ok(result.errors.includes("AI review introduced unapproved numeric content."));
});

test("outcome reconciliation ignores all candles from before setup creation", () => {
  const before = outcomeCandle(-2, { high: 120, low: 80, close: 100 });
  const straddling = candle({
    openTime: NOW - 30_000,
    closeTime: NOW + 29_999,
    open: 100,
    high: 120,
    low: 80,
    close: 100
  });
  const after = outcomeCandle(1, { high: 101, low: 99, close: 100 });
  const result = outcomes.reconcileAiSetupOutcome(
    outcomeSetup("long"),
    outcomes.initialAiOutcomeState(),
    [before, straddling, after]
  );
  assert.equal(result.state.status, "active");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, "entry");
  assert.equal(result.state.hitTakeProfits.length, 0);
});

test("long and short outcomes reconcile entries and allocated targets deterministically", () => {
  for (const direction of ["long", "short"]) {
    const isLong = direction === "long";
    const candles = [
      outcomeCandle(1, { high: 101, low: 99, close: 100 }),
      outcomeCandle(2, isLong
        ? { open: 100, high: 106, low: 99, close: 105 }
        : { open: 100, high: 101, low: 94, close: 95 }),
      outcomeCandle(3, isLong
        ? { open: 105, high: 110, low: 104, close: 109 }
        : { open: 95, high: 96, low: 90, close: 91 })
    ];
    const result = outcomes.reconcileAiSetupOutcome(outcomeSetup(direction), outcomes.initialAiOutcomeState(), candles);
    assert.equal(result.state.status, "tp_hit");
    assert.deepEqual(result.state.hitTakeProfits, ["TP1", "TP2"]);
    assert.equal(result.state.realizedR, 1.6);
    assert.ok(result.state.estimatedResultAfterCostsR < result.state.realizedR);
    assert.deepEqual(result.events.map((event) => event.type), ["entry", "take_profit", "take_profit"]);
    assert.equal(result.events.every((event) => event.wasAmbiguous === false), true);
    assert.ok(result.state.mfeR >= 2);
    assert.equal(result.checkedThrough, new Date(candles[2].closeTime).toISOString());
  }
});

test("ambiguous candles use the conservative stop-first rule", () => {
  const entry = outcomeCandle(1, { high: 101, low: 99, close: 100 });
  const ambiguous = outcomeCandle(2, { high: 110, low: 94, close: 100 });
  const result = outcomes.reconcileAiSetupOutcome(
    outcomeSetup("long"),
    outcomes.initialAiOutcomeState(),
    [entry, ambiguous]
  );
  assert.equal(result.state.status, "stopped");
  assert.equal(result.state.realizedR, -1);
  assert.deepEqual(result.state.hitTakeProfits, []);
  assert.deepEqual(result.events.map((event) => event.type), ["entry", "stop_loss"]);
  assert.equal(result.events[0].wasAmbiguous, false);
  assert.equal(result.events[1].wasAmbiguous, true);
});

test("pre-entry entry-and-stop collisions invalidate conservatively and remain auditable", () => {
  const collision = outcomeCandle(1, { high: 100, low: 94, close: 98 });
  const result = outcomes.reconcileAiSetupOutcome(
    outcomeSetup("long"),
    outcomes.initialAiOutcomeState(),
    [collision]
  );
  assert.equal(result.state.status, "invalidated");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, "invalidated");
  assert.equal(result.events[0].wasAmbiguous, true);
});

test("outcome Edge persistence preserves the engine ambiguity flag", () => {
  assert.match(outcomeEdgeSource, /was_ambiguous:\s*event\.wasAmbiguous/);
  assert.doesNotMatch(outcomeEdgeSource, /was_ambiguous:\s*false/);
});

test("outcome R derives from final prices even when nominal target metadata is wrong", () => {
  const setup = outcomeSetup("long");
  setup.takeProfits[0].rMultiple = 99;
  setup.takeProfits[1].rMultiple = 99;
  const result = outcomes.reconcileAiSetupOutcome(
    setup,
    outcomes.initialAiOutcomeState(),
    [
      outcomeCandle(1, { high: 101, low: 99, close: 100 }),
      outcomeCandle(2, { high: 106, low: 99, close: 105 })
    ]
  );
  assert.equal(result.state.status, "active");
  assert.equal(result.state.realizedR, 0.6);
  assert.equal(result.events[1].realizedR, 0.6);
  assert.equal(result.events[1].wasAmbiguous, false);
});

test("pre-entry stops invalidate, unfilled setups expire, and terminal replays are idempotent", () => {
  const invalidated = outcomes.reconcileAiSetupOutcome(
    outcomeSetup("long"),
    outcomes.initialAiOutcomeState(),
    [outcomeCandle(1, { high: 98, low: 94, close: 96 })]
  );
  assert.equal(invalidated.state.status, "invalidated");
  assert.equal(invalidated.events[0].type, "invalidated");
  assert.equal(invalidated.events[0].wasAmbiguous, false);

  const expiredCandle = outcomeCandle(61, { high: 110, low: 90, close: 100 });
  const expired = outcomes.reconcileAiSetupOutcome(
    outcomeSetup("long"),
    outcomes.initialAiOutcomeState(),
    [expiredCandle]
  );
  assert.equal(expired.state.status, "expired");
  assert.equal(expired.events[0].occurredAt, outcomeSetup("long").expiresAt);

  const completed = outcomes.reconcileAiSetupOutcome(
    outcomeSetup("long"),
    outcomes.initialAiOutcomeState(),
    [
      outcomeCandle(1, { high: 101, low: 99, close: 100 }),
      outcomeCandle(2, { high: 111, low: 99, close: 110 })
    ]
  );
  const replay = outcomes.reconcileAiSetupOutcome(
    outcomeSetup("long"),
    completed.state,
    [
      outcomeCandle(1, { high: 101, low: 99, close: 100 }),
      outcomeCandle(2, { high: 111, low: 99, close: 110 })
    ]
  );
  assert.deepEqual(replay.state, completed.state);
  assert.deepEqual(replay.events, []);
});

test("duplicate candles cannot create duplicate outcome events", () => {
  const entry = outcomeCandle(1, { high: 101, low: 99, close: 100 });
  const firstTarget = outcomeCandle(2, { high: 106, low: 99, close: 105 });
  const result = outcomes.reconcileAiSetupOutcome(
    outcomeSetup("long"),
    outcomes.initialAiOutcomeState(),
    [entry, structuredClone(entry), firstTarget, structuredClone(firstTarget)]
  );
  assert.deepEqual(result.events.map((event) => event.type), ["entry", "take_profit"]);
  assert.deepEqual(result.state.hitTakeProfits, ["TP1"]);
  assert.equal(result.state.realizedR, 0.6);
});
