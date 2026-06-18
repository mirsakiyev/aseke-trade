import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const mathSource = await readFile(new URL("../src/lib/demoTradeMath.ts", import.meta.url), "utf8");
const reconciliationSource = await readFile(new URL("../src/lib/demoTradeReconciliation.ts", import.meta.url), "utf8");
const tempDir = await mkdtemp(join(tmpdir(), "demo-trade-reconciliation-"));
const mathPath = join(tempDir, "demoTradeMath.mjs");
const reconciliationPath = join(tempDir, "demoTradeReconciliation.mjs");

await writeFile(mathPath, transpile(mathSource));
await writeFile(
  reconciliationPath,
  transpile(reconciliationSource).replace(/from "\.\/demoTradeMath(?:\.ts)?"/g, 'from "./demoTradeMath.mjs"')
);

const demoTrade = await import(pathToFileURL(mathPath));
const reconciliation = await import(pathToFileURL(reconciliationPath));

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
}

function assertClose(actual, expected, tolerance = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be close to ${expected}`);
}

function createState(balance = 1000) {
  return demoTrade.createInitialDemoTradeState({
    startingBalance: balance,
    sessionId: "offline-session",
    userId: "10000000-0000-4000-8000-000000000001",
    now: "2026-06-16T12:00:00.000Z"
  });
}

function openPosition(overrides = {}) {
  const result = demoTrade.openDemoPosition(createState(), {
    sessionId: "offline-session",
    userId: "10000000-0000-4000-8000-000000000001",
    symbol: "BTCUSDT",
    side: "long",
    sizeMode: "margin",
    amount: 100,
    leverage: 1,
    entryPrice: 100,
    stopLoss: 90,
    takeProfits: [{ id: "tp-1", price: 110, closePercent: 100 }],
    ...overrides
  }, "2026-06-16T12:01:00.000Z");

  assert.equal(result.ok, true);
  return result.state;
}

function candle(minute, { high, low, close = 100, open = 100 }) {
  const timestamp = Date.parse(`2026-06-16T12:${String(minute).padStart(2, "0")}:00.000Z`);
  return {
    timestamp,
    closeTimestamp: timestamp + 59_999,
    open,
    high,
    low,
    close
  };
}

function reconcile(state, candles) {
  return reconciliation.reconcileDemoTradeStateWithCandles(state, candles, "2026-06-16T13:00:00.000Z");
}

test("long trade hits SL while offline even if price later returns above entry", () => {
  const result = reconcile(openPosition(), [
    candle(2, { high: 101, low: 89, close: 100 }),
    candle(3, { high: 105, low: 99, close: 104 })
  ]);

  assert.equal(result.state.openPosition, null);
  assert.equal(result.state.tradeHistory[0].status, "STOP_LOSS_HIT");
  assert.equal(result.state.tradeHistory[0].closeReason, "stop_loss");
  assert.equal(result.state.tradeHistory[0].exitPrice, 90);
  assert.equal(result.events[0].eventType, "stop_loss");
  assertClose(result.state.currentBalance, 990);
});

test("long trade hits TP while offline even if price later returns below entry", () => {
  const result = reconcile(openPosition(), [
    candle(2, { high: 111, low: 95, close: 95 })
  ]);

  assert.equal(result.state.openPosition, null);
  assert.equal(result.state.tradeHistory[0].status, "TAKE_PROFIT_HIT");
  assert.equal(result.state.tradeHistory[0].closeReason, "take_profit");
  assert.equal(result.state.tradeHistory[0].exitPrice, 110);
  assert.equal(result.events[0].eventType, "take_profit");
  assertClose(result.state.currentBalance, 1010);
});

test("short trade hits SL while offline", () => {
  const result = reconcile(
    openPosition({ side: "short", stopLoss: 110, takeProfits: [{ id: "tp-1", price: 90, closePercent: 100 }] }),
    [candle(2, { high: 111, low: 99, close: 100 })]
  );

  assert.equal(result.state.openPosition, null);
  assert.equal(result.state.tradeHistory[0].status, "STOP_LOSS_HIT");
  assert.equal(result.state.tradeHistory[0].exitPrice, 110);
  assertClose(result.state.currentBalance, 990);
});

test("short trade hits TP while offline", () => {
  const result = reconcile(
    openPosition({ side: "short", stopLoss: 110, takeProfits: [{ id: "tp-1", price: 90, closePercent: 100 }] }),
    [candle(2, { high: 101, low: 89, close: 101 })]
  );

  assert.equal(result.state.openPosition, null);
  assert.equal(result.state.tradeHistory[0].status, "TAKE_PROFIT_HIT");
  assert.equal(result.state.tradeHistory[0].exitPrice, 90);
  assertClose(result.state.currentBalance, 1010);
});

test("multiple TPs close only their assigned position portions", () => {
  const firstPass = reconcile(
    openPosition({
      takeProfits: [
        { id: "tp-1", price: 110, closePercent: 50 },
        { id: "tp-2", price: 120, closePercent: 50 }
      ]
    }),
    [candle(2, { high: 111, low: 100, close: 108 })]
  );

  assert.equal(firstPass.state.openPosition.status, "PARTIALLY_CLOSED");
  assert.equal(firstPass.state.openPosition.takeProfits[0].isHit, true);
  assert.equal(firstPass.events.length, 1);
  assertClose(firstPass.state.openPosition.remainingQuantity, 0.5);

  const secondPass = reconcile(firstPass.state, [candle(3, { high: 121, low: 108, close: 119 })]);
  assert.equal(secondPass.state.openPosition, null);
  assert.equal(secondPass.events.length, 1);
  assert.equal(secondPass.events[0].takeProfitId, "tp-2");
  assertClose(secondPass.state.currentBalance, 1015);
});

test("TP1 hit first then SL later closes only the remaining size", () => {
  const firstPass = reconcile(
    openPosition({
      takeProfits: [
        { id: "tp-1", price: 110, closePercent: 50 },
        { id: "tp-2", price: 120, closePercent: 50 }
      ]
    }),
    [candle(2, { high: 111, low: 100, close: 108 })]
  );
  const secondPass = reconcile(firstPass.state, [candle(3, { high: 108, low: 89, close: 95 })]);

  assert.equal(secondPass.state.openPosition, null);
  assert.equal(secondPass.state.tradeHistory[0].status, "STOP_LOSS_HIT");
  assert.equal(secondPass.state.tradeHistory[0].exitPrice, 90);
  assertClose(secondPass.state.realizedPnl, 0);
  assertClose(secondPass.state.currentBalance, 1000);
});

test("SL and TP inside the same candle uses deterministic conservative fallback", () => {
  const result = reconcile(openPosition(), [
    candle(2, { high: 111, low: 89, close: 100 })
  ]);

  assert.equal(result.state.tradeHistory[0].status, "STOP_LOSS_HIT");
  assert.equal(result.state.tradeHistory[0].exitPrice, 90);
  assert.equal(result.events[0].wasAmbiguous, true);
});

test("duplicate checker runs do not double-credit the same TP", () => {
  const firstPass = reconcile(
    openPosition({ takeProfits: [{ id: "tp-1", price: 110, closePercent: 50 }] }),
    [candle(2, { high: 111, low: 100, close: 108 })]
  );
  const secondPass = reconcile(firstPass.state, [candle(2, { high: 111, low: 100, close: 108 })]);

  assert.equal(firstPass.events.length, 1);
  assert.equal(secondPass.events.length, 0);
  assertClose(secondPass.state.realizedPnl, firstPass.state.realizedPnl);
  assertClose(secondPass.state.openPosition.remainingQuantity, firstPass.state.openPosition.remainingQuantity);
});
