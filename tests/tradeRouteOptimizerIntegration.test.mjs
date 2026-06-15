import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("route optimizer rewards use an idempotent Supabase completion RPC", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202606150002_trade_route_optimizer_rewards.sql", import.meta.url),
    "utf8"
  );
  const client = await readFile(new URL("../src/lib/gamificationApi.ts", import.meta.url), "utf8");

  assert.match(migration, /create table if not exists public\.route_optimizer_completions/i);
  assert.match(migration, /unique \(user_id, puzzle_type, puzzle_date\)/i);
  assert.match(migration, /submit_trade_route_optimizer_completion/i);
  assert.match(migration, /source_type in \('guide', 'puzzle_of_day', 'admin_adjustment', 'course_badge', 'loyalty_badge', 'trade_route_optimizer'\)/i);
  assert.match(migration, /rounded_profit := round\(final_usdt - safe_starting_balance, 2\)/i);
  assert.match(migration, /safe_xp_awarded := 0/i);
  assert.match(migration, /safe_xp_awarded := 100/i);
  assert.match(migration, /safe_xp_awarded := greatest\(101, round\(100 \* safe_multiplier\)::integer\)/i);
  assert.match(client, /submitTradeRouteOptimizerCompletion/);
  assert.match(client, /submit_trade_route_optimizer_completion/);
});

test("route optimizer reference prices use server-side CoinGecko with public fallbacks", async () => {
  const netlifyConfig = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
  const functionSource = await readFile(
    new URL("../netlify/functions/route-optimizer-reference-prices.ts", import.meta.url),
    "utf8"
  );
  const clientSource = await readFile(new URL("../src/lib/routeOptimizerReferencePrices.ts", import.meta.url), "utf8");

  assert.match(netlifyConfig, /from = "\/api\/route-optimizer-reference-prices"/);
  assert.match(functionSource, /api\.coingecko\.com\/api\/v3\/simple\/price/);
  assert.match(functionSource, /COINGECKO_DEMO_API_KEY/);
  assert.match(functionSource, /x-cg-demo-api-key/);
  assert.match(functionSource, /api\.coinpaprika\.com\/v1\/tickers/);
  assert.match(functionSource, /api\.coincap\.io\/v2\/assets/);
  assert.match(clientSource, /const dailyCachePrefix = "route-optimizer-reference-prices"/);
  assert.match(clientSource, /\$\{dailyCachePrefix\}-\$\{dateKey\}/);
  assert.match(clientSource, /last-known-good/);
  assert.match(clientSource, /createFallbackReferenceAssetPrices/);
});
