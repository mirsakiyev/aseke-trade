import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/demoTradeMath.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const demoTrade = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

function assertClose(actual, expected, tolerance = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be close to ${expected}`);
}

function createState(balance = 1000) {
  return demoTrade.createInitialDemoTradeState({
    startingBalance: balance,
    sessionId: "test-session",
    userId: "user-1",
    now: "2026-06-16T12:00:00.000Z"
  });
}

function openPosition(overrides = {}, balance = 1000) {
  const result = demoTrade.openDemoPosition(createState(balance), {
    sessionId: "test-session",
    userId: "user-1",
    symbol: "BTCUSDT",
    side: "long",
    sizeMode: "margin",
    amount: 100,
    leverage: 10,
    entryPrice: 100,
    stopLoss: 90,
    takeProfits: [{ id: "tp-1", price: 110, closePercent: 100 }],
    ...overrides
  }, "2026-06-16T12:01:00.000Z");

  assert.equal(result.ok, true);
  return result.state;
}

test("long PnL when price rises", () => {
  const state = demoTrade.applyMarketPrice(openPosition({ takeProfits: [] }), 120);
  assertClose(state.openPosition.unrealizedPnl, 200);
});

test("long PnL when price falls", () => {
  const state = demoTrade.applyMarketPrice(openPosition({ takeProfits: [] }), 90.5);
  assertClose(state.openPosition.unrealizedPnl, -95);
});

test("short PnL when price falls", () => {
  const state = demoTrade.applyMarketPrice(
    openPosition({ side: "short", stopLoss: 110, takeProfits: [{ id: "tp-1", price: 90, closePercent: 100 }] }),
    90.5
  );
  assertClose(state.openPosition.unrealizedPnl, 95);
});

test("short PnL when price rises", () => {
  const state = demoTrade.applyMarketPrice(
    openPosition({ side: "short", stopLoss: 110, takeProfits: [] }),
    105
  );
  assertClose(state.openPosition.unrealizedPnl, -50);
});

test("leverage 1x opens a one-times isolated margin position", () => {
  const state = openPosition({ leverage: 1, amount: 100, takeProfits: [] });
  assert.equal(state.openPosition.leverage, 1);
  assertClose(state.openPosition.initialMargin, 100);
  assertClose(state.openPosition.initialQuantity, 1);
  assertClose(state.availableBalance, 900);
});

test("leverage 100x opens a high leverage isolated margin position", () => {
  const state = openPosition({ leverage: 100, amount: 10, takeProfits: [] });
  assert.equal(state.openPosition.leverage, 100);
  assertClose(state.openPosition.initialMargin, 10);
  assertClose(state.openPosition.initialQuantity, 10);
  assertClose(state.availableBalance, 990);
});

test("liquidation price for long uses ASEKE demo isolated-margin formula", () => {
  const price = demoTrade.calculateLiquidationPrice({
    side: "long",
    avgEntryPrice: 100,
    quantityRemaining: 10,
    isolatedMarginRemaining: 100,
    maintenanceMarginRate: 0.005
  });
  assertClose(price, 90.45);
});

test("liquidation price for short uses ASEKE demo isolated-margin formula", () => {
  const price = demoTrade.calculateLiquidationPrice({
    side: "short",
    avgEntryPrice: 100,
    quantityRemaining: 10,
    isolatedMarginRemaining: 100,
    maintenanceMarginRate: 0.005
  });
  assertClose(price, 109.45);
});

test("stop-loss validation for long rejects wrong side", () => {
  assert.deepEqual(demoTrade.validateStopLoss("long", 100, 101), [
    "For a long trade, stop loss must be below entry."
  ]);
});

test("stop-loss validation for short rejects wrong side", () => {
  assert.deepEqual(demoTrade.validateStopLoss("short", 100, 99), [
    "For a short trade, stop loss must be above entry."
  ]);
});

test("take-profit validation for long rejects wrong side", () => {
  assert.deepEqual(demoTrade.validateTakeProfits("long", 100, [{ price: 99, closePercent: 100 }]), [
    "TP1 must be above entry for a long trade."
  ]);
});

test("take-profit validation for short rejects wrong side", () => {
  assert.deepEqual(demoTrade.validateTakeProfits("short", 100, [{ price: 101, closePercent: 100 }]), [
    "TP1 must be below entry for a short trade."
  ]);
});

test("multiple TPs totaling 100% are accepted", () => {
  assert.deepEqual(
    demoTrade.validateTakeProfits("long", 100, [
      { price: 110, closePercent: 25 },
      { price: 120, closePercent: 25 },
      { price: 130, closePercent: 50 }
    ]),
    []
  );
});

test("reject TPs over 100%", () => {
  assert.ok(
    demoTrade.validateTakeProfits("long", 100, [
      { price: 110, closePercent: 60 },
      { price: 120, closePercent: 60 }
    ]).includes("Take-profit close sizes cannot total more than 100%.")
  );
});

test("partial TP close updates remaining quantity and margin", () => {
  const state = demoTrade.applyMarketPrice(
    openPosition({ takeProfits: [{ id: "tp-1", price: 110, closePercent: 50 }] }),
    110,
    "2026-06-16T12:02:00.000Z"
  );
  assert.equal(state.openPosition.status, "PARTIALLY_CLOSED");
  assertClose(state.openPosition.remainingQuantity, 5);
  assertClose(state.openPosition.remainingMargin, 50);
  assertClose(state.openPosition.realizedPnl, 50);
});

test("manual close updates balance and status", () => {
  const state = demoTrade.closeOpenPosition(openPosition({ takeProfits: [] }), 110, "MANUALLY_CLOSED");
  assert.equal(state.openPosition, null);
  assert.equal(state.tradeHistory[0].status, "MANUALLY_CLOSED");
  assertClose(state.currentBalance, 1100);
  assertClose(state.realizedPnl, 100);
});

test("stop-loss hit closes remaining position", () => {
  const state = demoTrade.applyMarketPrice(openPosition({ stopLoss: 95, takeProfits: [] }), 95);
  assert.equal(state.openPosition, null);
  assert.equal(state.tradeHistory[0].status, "STOP_LOSS_HIT");
  assertClose(state.currentBalance, 950);
});

test("liquidation closes remaining position", () => {
  const state = demoTrade.applyMarketPrice(openPosition({ takeProfits: [] }), 90.4);
  assert.equal(state.openPosition, null);
  assert.equal(state.tradeHistory[0].status, "LIQUIDATED");
  assertClose(state.currentBalance, 900);
});

test("leverage update recalculates margin and liquidation price", () => {
  const result = demoTrade.updateDemoLeverage(openPosition({ takeProfits: [] }), 5);
  assert.equal(result.ok, true);
  assert.equal(result.state.openPosition.leverage, 5);
  assertClose(result.state.openPosition.remainingMargin, 200);
  assertClose(result.state.availableBalance, 800);
  assertClose(result.state.openPosition.liquidationPrice, 80.4);
});

test("reducing leverage fails if available balance is insufficient", () => {
  const result = demoTrade.updateDemoLeverage(openPosition({ amount: 900, takeProfits: [] }), 5);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("Reducing leverage requires more margin than your available demo balance."));
});

test("reset balance clears history and open trade after confirmation", () => {
  const closed = demoTrade.closeOpenPosition(openPosition({ takeProfits: [] }), 110);
  const reset = demoTrade.resetDemoTradeState(closed, 2500, "2026-06-16T12:03:00.000Z");
  assert.equal(reset.openPosition, null);
  assert.equal(reset.tradeHistory.length, 0);
  assert.equal(reset.startingBalance, 2500);
  assert.equal(reset.currentBalance, 2500);
});

test("CSV export contains expected fields", () => {
  const state = demoTrade.closeOpenPosition(openPosition({ takeProfits: [] }), 110);
  const csv = demoTrade.exportDemoTradesToCsv(state);
  assert.match(csv, /Trade ID,User ID,Session ID,Symbol,Side,Entry Price/);
  assert.match(csv, /BTCUSDT/);
  assert.match(csv, /MANUALLY_CLOSED/);
});
