import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/tradeRouteOptimizer.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const tradeRouteOptimizer = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

function assertClose(actual, expected, tolerance = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be close to ${expected}`);
}

function createMarket(id, name, tradingFeePercent, buy, sell) {
  return {
    id,
    name,
    tradingFeePercent,
    prices: {
      BTC: { buy, sell },
      ETH: { buy, sell },
      SOL: { buy, sell }
    }
  };
}

test("trade route puzzle generation is deterministic for the same daily seed", () => {
  const first = tradeRouteOptimizer.generateTradeRoutePuzzle(new Date("2026-06-15T14:00:00.000Z"), "user-1");
  const second = tradeRouteOptimizer.generateTradeRoutePuzzle(new Date("2026-06-15T23:59:00.000Z"), "user-1");

  assert.deepEqual(first.markets, second.markets);
  assert.deepEqual(first.routes, second.routes);
  assert.deepEqual(first.optimalRoute, second.optimalRoute);
  assert.equal(first.seed, "2026-06-15-user-1");
});

test("trade route puzzle generation changes on the next UTC date", () => {
  const first = tradeRouteOptimizer.generateTradeRoutePuzzle(new Date("2026-06-15T23:59:00.000Z"), "user-1");
  const second = tradeRouteOptimizer.generateTradeRoutePuzzle(new Date("2026-06-16T00:01:00.000Z"), "user-1");

  assert.notDeepEqual(first.markets, second.markets);
  assert.notEqual(first.seed, second.seed);
});

test("route calculation applies buy fee, sell fee, slippage, and network fee", () => {
  const puzzle = {
    startingBalance: 1000,
    markets: [
      createMarket("low", "Low Market", 0.001, 100, 99),
      createMarket("high", "High Market", 0.0015, 130, 110)
    ],
    routes: [
      {
        id: "fast",
        name: "Fast Route",
        networkFeeUSDT: 3,
        slippagePercent: 0.002,
        delayLabel: "2 min",
        riskLabel: "Low"
      }
    ]
  };

  const result = tradeRouteOptimizer.calculateRouteResult(puzzle, {
    asset: "BTC",
    buyMarketId: "low",
    sellMarketId: "high",
    routeId: "fast"
  });

  assert.ok(result);
  assertClose(result.buyFee, 1);
  assertClose(result.assetQuantity, 9.99);
  assertClose(result.sellFee, 1.64835);
  assertClose(result.slippageCost, 2.1978);
  assertClose(result.networkFee, 3);
  assertClose(result.finalUSDT, 1092.05385);
  assertClose(result.profit, 92.05385);
  assertClose(result.totalFees, 7.84615);
});

test("same buy and sell market routes are invalid", () => {
  const puzzle = {
    startingBalance: 1000,
    markets: [createMarket("same", "Same Market", 0.001, 100, 101)],
    routes: [
      {
        id: "route",
        name: "Route",
        networkFeeUSDT: 1,
        slippagePercent: 0.001,
        delayLabel: "1 min",
        riskLabel: "Low"
      }
    ]
  };

  assert.equal(
    tradeRouteOptimizer.calculateRouteResult(puzzle, {
      asset: "BTC",
      buyMarketId: "same",
      sellMarketId: "same",
      routeId: "route"
    }),
    null
  );
});

test("optimal route brute force skips same-market paths and picks the best final USDT", () => {
  const puzzle = {
    startingBalance: 1000,
    markets: [
      createMarket("low", "Low Market", 0.001, 100, 99),
      createMarket("high", "High Market", 0.001, 130, 140)
    ],
    routes: [
      {
        id: "cheap",
        name: "Cheap Route",
        networkFeeUSDT: 1,
        slippagePercent: 0.001,
        delayLabel: "2 min",
        riskLabel: "Low"
      },
      {
        id: "expensive",
        name: "Expensive Route",
        networkFeeUSDT: 40,
        slippagePercent: 0.008,
        delayLabel: "20 min",
        riskLabel: "High"
      }
    ]
  };

  const optimal = tradeRouteOptimizer.findOptimalRoute(puzzle);

  assert.equal(optimal.selection.buyMarketId, "low");
  assert.equal(optimal.selection.sellMarketId, "high");
  assert.equal(optimal.selection.routeId, "cheap");
  assert.notEqual(optimal.selection.buyMarketId, optimal.selection.sellMarketId);
});

test("exact optimal route receives a perfect score", () => {
  const puzzle = tradeRouteOptimizer.generateTradeRoutePuzzle(new Date("2026-06-15T14:00:00.000Z"), "user-2");
  const result = tradeRouteOptimizer.calculateRouteResult(puzzle, puzzle.optimalRoute.selection);

  assert.ok(result);
  assert.equal(tradeRouteOptimizer.scoreTradeRoute(puzzle.optimalRoute.selection, result, puzzle.optimalRoute), 100);
});

test("puzzle page renders the Trade Route Optimizer instead of the old trivia submission flow", async () => {
  const pageSource = await readFile(new URL("../src/pages/PuzzleOfTheDay.tsx", import.meta.url), "utf8");
  const componentSource = await readFile(new URL("../src/components/TradeRouteOptimizer.tsx", import.meta.url), "utf8");

  assert.match(pageSource, /TradeRouteOptimizer/);
  assert.doesNotMatch(pageSource, /loadPuzzle|submitPuzzle|Your answer|Submit answer/);
  assert.match(componentSource, /Simulated educational puzzle\. Not financial advice\./);
  assert.match(componentSource, /Lock In Route/);
});
