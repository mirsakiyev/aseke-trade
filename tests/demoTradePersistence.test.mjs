import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const persistenceSource = await readFile(new URL("../src/lib/demoTradePersistence.ts", import.meta.url), "utf8");
const tempDir = await mkdtemp(join(tmpdir(), "demo-trade-persistence-"));
const persistencePath = join(tempDir, "demoTradePersistence.mjs");
const supabasePath = join(tempDir, "supabase.mjs");

await writeFile(supabasePath, "export const supabase = null;\n");
await writeFile(
  persistencePath,
  transpile(persistenceSource).replace(/from "\.\/supabase(?:\.ts)?"/g, 'from "./supabase.mjs"')
);

const persistence = await import(pathToFileURL(persistencePath));

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
}

function createState(overrides = {}) {
  return {
    version: 1,
    sessionId: "session-1",
    userId: "user-1",
    symbol: "BTCUSDT",
    startingBalance: 1000,
    currentBalance: 1000,
    availableBalance: 1000,
    realizedPnl: 0,
    unrealizedPnl: 0,
    openPosition: null,
    pendingLimitOrder: null,
    tradeHistory: [],
    actionHistory: [],
    settings: { feeRate: 0, maintenanceMarginRate: 0.005 },
    resetAt: null,
    createdAt: "2026-06-16T12:00:00.000Z",
    updatedAt: "2026-06-16T12:00:00.000Z",
    ...overrides
  };
}

function createOpenPosition(overrides = {}) {
  return {
    tradeId: "trade-1",
    userId: "user-1",
    sessionId: "session-1",
    symbol: "BTCUSDT",
    side: "long",
    marginMode: "isolated",
    status: "OPEN",
    entryPrice: 100,
    exitPrice: null,
    markPrice: 101,
    initialMargin: 100,
    remainingMargin: 100,
    leverage: 1,
    initialQuantity: 1,
    remainingQuantity: 1,
    stopLoss: 90,
    takeProfits: [],
    closeReason: null,
    lastCheckedAt: "2026-06-16T12:05:00.000Z",
    realizedPnl: 0,
    unrealizedPnl: 1,
    returnPercent: 1,
    liquidationPrice: 0,
    openedAt: "2026-06-16T12:01:00.000Z",
    updatedAt: "2026-06-16T12:05:00.000Z",
    closedAt: null,
    actionLog: [],
    ...overrides
  };
}

test("terminal closed trade wins over a refreshed open copy of the same trade", () => {
  const closedTrade = {
    ...createOpenPosition({
      status: "MANUALLY_CLOSED",
      exitPrice: 105,
      markPrice: 105,
      remainingQuantity: 0,
      remainingMargin: 0,
      closeReason: "manual",
      closedAt: "2026-06-16T12:03:00.000Z",
      updatedAt: "2026-06-16T12:03:00.000Z"
    }),
    exitPrice: 105,
    closedAt: "2026-06-16T12:03:00.000Z"
  };
  const localClosed = createState({
    openPosition: null,
    tradeHistory: [closedTrade],
    updatedAt: "2026-06-16T12:03:00.000Z"
  });
  const remoteOpen = createState({
    openPosition: createOpenPosition({ updatedAt: "2026-06-16T12:06:00.000Z" }),
    updatedAt: "2026-06-16T12:06:00.000Z"
  });

  const chosen = persistence.chooseLatestState(localClosed, remoteOpen);
  assert.equal(chosen, localClosed);
  assert.equal(chosen.openPosition, null);
  assert.equal(chosen.tradeHistory[0].status, "MANUALLY_CLOSED");
});

test("remote terminal close also wins over a local open copy of the same trade", () => {
  const localOpen = createState({
    openPosition: createOpenPosition({ updatedAt: "2026-06-16T12:06:00.000Z" }),
    updatedAt: "2026-06-16T12:06:00.000Z"
  });
  const remoteClosed = createState({
    openPosition: null,
    tradeHistory: [
      {
        ...createOpenPosition({
          status: "STOP_LOSS_HIT",
          exitPrice: 90,
          markPrice: 90,
          remainingQuantity: 0,
          remainingMargin: 0,
          closeReason: "stop_loss",
          closedAt: "2026-06-16T12:04:00.000Z",
          updatedAt: "2026-06-16T12:04:00.000Z"
        }),
        exitPrice: 90,
        closedAt: "2026-06-16T12:04:00.000Z"
      }
    ],
    updatedAt: "2026-06-16T12:04:00.000Z"
  });

  const chosen = persistence.chooseLatestState(localOpen, remoteClosed);
  assert.equal(chosen, remoteClosed);
  assert.equal(chosen.openPosition, null);
  assert.equal(chosen.tradeHistory[0].status, "STOP_LOSS_HIT");
});
