import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/marketIndexMath.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const marketIndexMath = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

function assertClose(actual, expected, tolerance = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be close to ${expected}`);
}

test("long short ratio converts to normalized long and short percentages", () => {
  const result = marketIndexMath.ratioToLongShortPercent(1.5);

  assert.equal(result.shortPct + result.longPct, 100);
  assertClose(result.longPct, 60);
  assertClose(result.shortPct, 40);
});

test("long short averaging ignores invalid exchanges and keeps included exchange names", () => {
  const result = marketIndexMath.averageLongShortExchanges([
    { exchange: "Binance", longShortRatio: 1.5, timestamp: "2026-06-15T01:00:00.000Z" },
    { exchange: "OKX", longPct: 0.7, shortPct: 0.3, timestamp: "2026-06-15T01:05:00.000Z" },
    { exchange: "Bybit", longShortRatio: null },
    { exchange: "Gate", longPct: 0, shortPct: 0 }
  ]);

  assert.deepEqual(result.includedExchanges, ["Binance", "OKX"]);
  assertClose(result.longPct, 65);
  assertClose(result.shortPct, 35);
  assert.equal(result.timestamp, "2026-06-15T01:05:00.000Z");
});

test("single exchange long short index returns only the selected exchange", () => {
  const result = marketIndexMath.buildSingleExchangeLongShortIndex({
    exchange: "OKX",
    longShortRatio: 1.5,
    timestamp: "2026-06-15T01:00:00.000Z"
  });

  assert.equal(result.selectedExchange, "OKX");
  assert.equal(result.mode, "single-exchange");
  assert.deepEqual(result.includedExchanges, ["OKX"]);
  assert.equal(result.source, "CoinGlass");
  assertClose(result.longPct, 60);
  assertClose(result.shortPct, 40);
});

test("major cex average averages valid exchanges and tracks failed exchanges", () => {
  const result = marketIndexMath.buildMajorLongShortIndex(
    [
      { exchange: "Binance", longShortRatio: 1.5 },
      { exchange: "OKX", longPct: 70, shortPct: 30 },
      { exchange: "Bybit", longShortRatio: null }
    ],
    ["Binance", "OKX", "Bybit"]
  );

  assert.equal(result.selectedExchange, "major-average");
  assert.equal(result.mode, "major-average");
  assert.deepEqual(result.includedExchanges, ["Binance", "OKX"]);
  assert.deepEqual(result.failedExchanges, ["Bybit"]);
  assertClose(result.longPct, 65);
  assertClose(result.shortPct, 35);
});

test("major cex average is not used when fewer than two exchanges are valid", () => {
  const result = marketIndexMath.buildMajorLongShortIndex(
    [
      { exchange: "Binance", longShortRatio: 1.5 },
      { exchange: "OKX", longShortRatio: null }
    ],
    ["Binance", "OKX"]
  );

  assert.equal(result, null);
});

test("binance fallback is explicitly labeled as binance fallback only", () => {
  const result = marketIndexMath.buildBinanceFallbackLongShortIndex({
    exchange: "Binance",
    longShortRatio: 1.5,
    timestamp: "2026-06-15T01:00:00.000Z"
  });

  assert.equal(result.selectedExchange, "Binance");
  assert.equal(result.mode, "binance-fallback");
  assert.deepEqual(result.availableExchanges, ["Binance"]);
  assert.equal(result.source, "Binance");
});

test("fear and greed score maps to the expected classification band", () => {
  assert.equal(marketIndexMath.getFearGreedBand(12).label, "Extreme Fear");
  assert.equal(marketIndexMath.getFearGreedBand(44).label, "Fear");
  assert.equal(marketIndexMath.getFearGreedBand(50).label, "Neutral");
  assert.equal(marketIndexMath.getFearGreedBand(68).label, "Greed");
  assert.equal(marketIndexMath.getFearGreedBand(90).label, "Extreme Greed");
});

test("volatility risk classification follows dashboard thresholds", () => {
  assert.equal(marketIndexMath.classifyVolatilityRisk(32).label, "Low volatility");
  assert.equal(marketIndexMath.classifyVolatilityRisk(55).label, "Moderate volatility");
  assert.equal(marketIndexMath.classifyVolatilityRisk(88).label, "High volatility");
  assert.equal(marketIndexMath.classifyVolatilityRisk(125).label, "Extreme volatility");
});
