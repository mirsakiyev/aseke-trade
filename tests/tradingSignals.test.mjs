import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/tradingSignals.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const tradingSignals = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

test("generated signal title uses direction and leverage", () => {
  assert.equal(tradingSignals.generateSignalTitle("long", 10), "LONG 10X");
  assert.equal(tradingSignals.generateSignalTitle("short", 25), "SHORT 25X");
});

test("signal display title follows current direction and leverage", () => {
  assert.equal(
    tradingSignals.getSignalDisplayTitle({
      direction: "long",
      leverage: 7,
      generated_title: "LONG 1X",
      title: "LONG 1X"
    }),
    "LONG 7X"
  );
});

test("take profit percentages split evenly and total 100", () => {
  assert.deepEqual(tradingSignals.splitTakeProfitPercentages(1), [100]);
  assert.deepEqual(tradingSignals.splitTakeProfitPercentages(2), [50, 50]);
  assert.deepEqual(tradingSignals.splitTakeProfitPercentages(3), [33.3, 33.3, 33.4]);
  const sevenTpTotal = tradingSignals.splitTakeProfitPercentages(7).reduce((total, value) => total + value, 0);
  assert.equal(Math.round(sevenTpTotal * 10) / 10, 100);
});

test("take profit validation requires prices and exactly 100 percent allocation", () => {
  assert.equal(
    tradingSignals.validateTakeProfits([{ price: "105", positionSizePercent: "100" }]).ok,
    true
  );
  assert.equal(
    tradingSignals.validateTakeProfits([{ price: "", positionSizePercent: "100" }]).ok,
    false
  );
  assert.equal(
    tradingSignals.validateTakeProfits([
      { price: "105", positionSizePercent: "60" },
      { price: "110", positionSizePercent: "20" }
    ]).ok,
    false
  );
  assert.equal(
    tradingSignals.validateTakeProfits([{ price: "105", positionSizePercent: "-1" }]).ok,
    false
  );
});

test("signal price formatting keeps low-price coin decimals while rounding BTC-like prices", () => {
  assert.equal(tradingSignals.formatSignalPrice("1.2137"), "1.2137");
  assert.equal(tradingSignals.formatSignalPrice("1.203"), "1.203");
  assert.equal(tradingSignals.formatSignalPrice("0.0000123456"), "0.0000123456");
  assert.equal(tradingSignals.formatSignalPrice("65978.1234"), "65,978.12");
});

test("ROI calculation handles long, short, and weighted partial exits", () => {
  assert.equal(tradingSignals.calculatePortionRoi("long", 100, 110, 10), 100);
  assert.equal(tradingSignals.calculatePortionRoi("short", 100, 90, 5), 50);

  const weightedRoi = tradingSignals.calculateWeightedRoi({
    direction: "long",
    entryPrice: 100,
    leverage: 10,
    takeProfits: [
      { id: "tp-1", price: 110, positionSizePercent: 50, isHit: true, hitAt: "2026-01-01T00:00:00.000Z" },
      { id: "tp-2", price: 120, positionSizePercent: 50, isHit: false, hitAt: null }
    ],
    fallbackExitPrice: 95
  });

  assert.equal(weightedRoi, 25);
});
