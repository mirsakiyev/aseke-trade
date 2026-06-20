import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const signalHelpersSource = await readFile(new URL("../src/lib/tradingSignals.ts", import.meta.url), "utf8");
const reconciliationSource = await readFile(new URL("../src/lib/tradingSignalReconciliation.ts", import.meta.url), "utf8");
const tempDir = await mkdtemp(join(tmpdir(), "trading-signal-reconciliation-"));
const signalHelpersPath = join(tempDir, "tradingSignals.mjs");
const reconciliationPath = join(tempDir, "tradingSignalReconciliation.mjs");

await writeFile(signalHelpersPath, transpile(signalHelpersSource));
await writeFile(
  reconciliationPath,
  transpile(reconciliationSource).replace(/from "\.\/tradingSignals(?:\.ts)?"/g, 'from "./tradingSignals.mjs"')
);

const reconciliation = await import(pathToFileURL(reconciliationPath));

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
}

function createSignal(overrides = {}) {
  return {
    id: overrides.id ?? "10000000-0000-4000-8000-000000000001",
    title: null,
    generated_title: "LONG 10X",
    symbol: "BTC/USDT",
    direction: "long",
    leverage: 10,
    entry_price: 100,
    stop_loss: 90,
    take_profits: [
      { id: "tp-1", price: 110, positionSizePercent: 50, isHit: false, hitAt: null },
      { id: "tp-2", price: 120, positionSizePercent: 50, isHit: false, hitAt: null }
    ],
    price_at_creation: 100,
    chart_image_url: null,
    notes: null,
    status: "active",
    updates: [
      {
        id: "signal-created",
        type: "signal_created",
        message: "Signal created",
        createdAt: "2026-06-16T12:00:00.000Z",
        metadata: null
      }
    ],
    original_signal: null,
    closed_at: null,
    manual_close_price: null,
    final_price: null,
    final_roi: null,
    last_checked_at: null,
    last_auto_update_price: null,
    last_auto_update_source: null,
    is_active: true,
    created_by_admin_id: null,
    created_at: "2026-06-16T12:00:00.000Z",
    updated_at: "2026-06-16T12:00:00.000Z",
    ...overrides
  };
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

function reconcile(signal, candles) {
  return reconciliation.reconcileTradingSignalWithCandles(signal, candles, "2026-06-16T13:00:00.000Z");
}

function eventTypes(result) {
  return result.events.map((event) => event.eventType);
}

test("LONG signal hitting TP1 marks only TP1 and keeps the signal active", () => {
  const result = reconcile(createSignal(), [candle(1, { high: 111, low: 100, close: 108 })]);

  assert.equal(result.signal.status, "active");
  assert.equal(result.signal.take_profits[0].isHit, true);
  assert.equal(result.signal.take_profits[1].isHit, false);
  assert.deepEqual(eventTypes(result), ["tp_hit"]);
  assert.equal(result.events[0].takeProfitId, "tp-1");
});

test("LONG signal hitting final TP completes the signal once", () => {
  const result = reconcile(createSignal(), [candle(1, { high: 121, low: 100, close: 119 })]);

  assert.equal(result.signal.status, "hit_tp");
  assert.equal(result.signal.closed_at, "2026-06-16T12:01:00.000Z");
  assert.equal(result.signal.final_price, 120);
  assert.equal(result.signal.final_roi, 150);
  assert.deepEqual(result.signal.take_profits.map((takeProfit) => takeProfit.isHit), [true, true]);
  assert.deepEqual(eventTypes(result), ["tp_hit", "tp_hit"]);
});

test("LONG signal hitting SL stops the signal", () => {
  const result = reconcile(createSignal(), [candle(1, { high: 101, low: 89, close: 95 })]);

  assert.equal(result.signal.status, "hit_sl");
  assert.equal(result.signal.closed_at, "2026-06-16T12:01:00.000Z");
  assert.equal(result.signal.final_price, 90);
  assert.equal(result.signal.final_roi, -100);
  assert.deepEqual(eventTypes(result), ["sl_hit"]);
});

test("SHORT signal hitting TP1 marks only TP1 and keeps the signal active", () => {
  const result = reconcile(
    createSignal({
      direction: "short",
      generated_title: "SHORT 10X",
      stop_loss: 110,
      take_profits: [
        { id: "tp-1", price: 90, positionSizePercent: 50, isHit: false, hitAt: null },
        { id: "tp-2", price: 80, positionSizePercent: 50, isHit: false, hitAt: null }
      ]
    }),
    [candle(1, { high: 101, low: 89, close: 92 })]
  );

  assert.equal(result.signal.status, "active");
  assert.equal(result.signal.take_profits[0].isHit, true);
  assert.equal(result.signal.take_profits[1].isHit, false);
  assert.deepEqual(eventTypes(result), ["tp_hit"]);
});

test("SHORT signal hitting final TP completes the signal", () => {
  const result = reconcile(
    createSignal({
      direction: "short",
      generated_title: "SHORT 10X",
      stop_loss: 110,
      take_profits: [
        { id: "tp-1", price: 90, positionSizePercent: 50, isHit: false, hitAt: null },
        { id: "tp-2", price: 80, positionSizePercent: 50, isHit: false, hitAt: null }
      ]
    }),
    [candle(1, { high: 101, low: 79, close: 82 })]
  );

  assert.equal(result.signal.status, "hit_tp");
  assert.equal(result.signal.final_price, 80);
  assert.equal(result.signal.final_roi, 150);
  assert.deepEqual(eventTypes(result), ["tp_hit", "tp_hit"]);
});

test("SHORT signal hitting SL stops the signal", () => {
  const result = reconcile(
    createSignal({
      direction: "short",
      generated_title: "SHORT 10X",
      stop_loss: 110,
      take_profits: [{ id: "tp-1", price: 90, positionSizePercent: 100, isHit: false, hitAt: null }]
    }),
    [candle(1, { high: 111, low: 99, close: 108 })]
  );

  assert.equal(result.signal.status, "hit_sl");
  assert.equal(result.signal.final_price, 110);
  assert.equal(result.signal.final_roi, -100);
  assert.deepEqual(eventTypes(result), ["sl_hit"]);
});

test("multi-TP signal can hit TP1 without completing the final target", () => {
  const result = reconcile(createSignal(), [candle(1, { high: 111, low: 100, close: 108 })]);

  assert.equal(result.signal.status, "active");
  assert.deepEqual(result.signal.take_profits.map((takeProfit) => takeProfit.isHit), [true, false]);
  assert.equal(result.signal.closed_at, null);
});

test("multi-TP signal preserves TP hit order across candles", () => {
  const firstPass = reconcile(createSignal(), [candle(1, { high: 111, low: 100, close: 108 })]);
  const secondPass = reconcile(firstPass.signal, [candle(2, { high: 121, low: 108, close: 119 })]);

  const autoUpdates = secondPass.signal.updates.filter((update) => update.type === "tp_hit");
  assert.equal(secondPass.signal.status, "hit_tp");
  assert.equal(autoUpdates[0].metadata.takeProfitId, "tp-1");
  assert.equal(autoUpdates[1].metadata.takeProfitId, "tp-2");
  assert.deepEqual(eventTypes(secondPass), ["tp_hit"]);
});

test("partial TP1 then SL preserves the TP and stops remaining size", () => {
  const firstPass = reconcile(createSignal(), [candle(1, { high: 111, low: 100, close: 108 })]);
  const secondPass = reconcile(firstPass.signal, [candle(2, { high: 108, low: 89, close: 92 })]);

  assert.equal(secondPass.signal.status, "hit_sl");
  assert.deepEqual(secondPass.signal.take_profits.map((takeProfit) => takeProfit.isHit), [true, false]);
  assert.equal(secondPass.signal.final_price, 90);
  assert.equal(secondPass.signal.final_roi, 0);
  assert.deepEqual(eventTypes(secondPass), ["sl_hit"]);
});

test("running the processor twice does not duplicate TP or SL events", () => {
  const firstPass = reconcile(createSignal(), [candle(1, { high: 111, low: 100, close: 108 })]);
  const secondPass = reconcile(firstPass.signal, [candle(1, { high: 111, low: 100, close: 108 })]);

  assert.equal(firstPass.events.length, 1);
  assert.equal(secondPass.events.length, 0);
  assert.equal(secondPass.signal.updates.filter((update) => update.type === "tp_hit").length, 1);

  const stopped = reconcile(createSignal(), [candle(1, { high: 101, low: 89, close: 95 })]);
  const duplicateStop = reconcile(stopped.signal, [candle(1, { high: 101, low: 89, close: 95 })]);
  assert.equal(stopped.events.length, 1);
  assert.equal(duplicateStop.events.length, 0);
  assert.equal(duplicateStop.signal.updates.filter((update) => update.type === "sl_hit").length, 1);
});

test("completed, stopped, and manually closed signals are ignored", () => {
  for (const status of ["hit_tp", "hit_sl", "manually_closed"]) {
    const result = reconcile(createSignal({ status }), [candle(1, { high: 121, low: 89, close: 100 })]);
    assert.equal(result.events.length, 0);
    assert.equal(result.checkedThrough, null);
    assert.equal(result.signal.status, status);
  }
});

test("backend reconciliation core runs without browser runtime", () => {
  assert.equal(typeof globalThis.window, "undefined");

  const result = reconcile(createSignal(), [candle(1, { high: 111, low: 100, close: 108 })]);
  assert.equal(result.events[0].eventType, "tp_hit");
});

test("missing or malformed candles do not update a signal", () => {
  const noCandles = reconcile(createSignal(), []);
  const malformed = reconcile(createSignal(), [
    { timestamp: Date.parse("2026-06-16T12:01:00.000Z"), open: 100, high: 80, low: 120, close: 100 }
  ]);

  assert.equal(noCandles.events.length, 0);
  assert.equal(noCandles.checkedThrough, null);
  assert.equal(malformed.events.length, 0);
  assert.equal(malformed.checkedThrough, null);
});

test("SL and TP inside the same one-minute candle uses conservative SL priority", () => {
  const result = reconcile(createSignal(), [candle(1, { high: 111, low: 89, close: 100 })]);

  assert.equal(result.signal.status, "hit_sl");
  assert.equal(result.events[0].eventType, "sl_hit");
  assert.equal(result.events[0].wasAmbiguous, true);
});
