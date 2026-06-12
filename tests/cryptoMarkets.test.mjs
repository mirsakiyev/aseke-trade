import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/cryptoMarkets.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const cryptoMarkets = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

const marketRows = [
  { id: "ethereum", market_cap_rank: 2, name: "Ethereum", symbol: "eth", image: "eth.png" },
  { id: "bitcoin-cash", market_cap_rank: 16, name: "Bitcoin Cash", symbol: "btc", image: null },
  { id: "bitcoin", market_cap_rank: 1, name: "Bitcoin", symbol: "btc", image: "btc.png" },
  { id: "missing-rank", market_cap_rank: null, name: "Missing Rank", symbol: "miss" }
];

test("market rows normalize to ranked top-coin options with uppercase symbols", () => {
  const coins = cryptoMarkets.normalizeMarketRows(marketRows);

  assert.deepEqual(
    coins.map((coin) => `${coin.rank}:${coin.id}:${coin.symbol}`),
    ["1:bitcoin:BTC", "2:ethereum:ETH", "16:bitcoin-cash:BTC"]
  );
});

test("coin filtering matches names, symbols, and rank while preserving provider ids", () => {
  const coins = cryptoMarkets.normalizeMarketRows(marketRows);

  assert.deepEqual(
    cryptoMarkets.filterCryptoCoins(coins, "eth").map((coin) => coin.id),
    ["ethereum"]
  );
  assert.deepEqual(
    cryptoMarkets.filterCryptoCoins(coins, "btc").map((coin) => coin.id),
    ["bitcoin", "bitcoin-cash"]
  );
  assert.deepEqual(
    cryptoMarkets.filterCryptoCoins(coins, "#16").map((coin) => coin.id),
    ["bitcoin-cash"]
  );
});

test("chart asset mapping keeps BTC and ETH symbols stable", () => {
  const coins = cryptoMarkets.normalizeMarketRows(marketRows);

  assert.deepEqual(cryptoMarkets.chartAssetFromCoin(coins[0]), {
    id: "bitcoin",
    title: "Bitcoin",
    ticker: "BTC/USDT",
    symbol: "BINANCE:BTCUSDT",
    rank: 1
  });

  assert.deepEqual(cryptoMarkets.chartAssetFromCoin(coins[1]), {
    id: "ethereum",
    title: "Ethereum",
    ticker: "ETH/USDT",
    symbol: "BINANCE:ETHUSDT",
    rank: 2
  });

  assert.deepEqual(cryptoMarkets.chartAssetFromCoin(coins[2]), {
    id: "bitcoin-cash",
    title: "Bitcoin Cash",
    ticker: "BTC/USDT",
    symbol: "BINANCE:BTCUSDT",
    rank: 16
  });
});
