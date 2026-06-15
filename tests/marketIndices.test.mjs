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

test("binance account ratios build a Binance-only long short index", () => {
  const result = marketIndexMath.buildBinanceLongShortIndex({
    longAccount: 0.58,
    shortAccount: 0.42,
    longShortRatio: 1.381,
    timestamp: "2026-06-15T01:00:00.000Z"
  });

  assert.equal(result.selectedExchange, "Binance");
  assert.equal(result.mode, "binance-only");
  assert.deepEqual(result.availableExchanges, ["Binance"]);
  assert.deepEqual(result.includedExchanges, ["Binance"]);
  assert.deepEqual(result.failedExchanges, []);
  assert.equal(result.source, "Binance");
  assert.equal(result.timestamp, "2026-06-15T01:00:00.000Z");
  assertClose(result.longPct, 58);
  assertClose(result.shortPct, 42);
});

test("binance long short index rejects missing account ratios", () => {
  assert.equal(
    marketIndexMath.buildBinanceLongShortIndex({
      longShortRatio: 1.5,
      timestamp: "2026-06-15T01:00:00.000Z"
    }),
    null
  );
});

test("unavailable market indices use Binance-only long short messaging", () => {
  const result = marketIndexMath.createUnavailableMarketIndices();

  assert.equal(result.longShort.selectedExchange, "Binance");
  assert.equal(result.longShort.mode, "unavailable");
  assert.equal(result.longShort.source, null);
  assert.deepEqual(result.longShort.availableExchanges, ["Binance"]);
  assert.equal(result.longShort.error, "Binance long/short data temporarily unavailable.");
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
