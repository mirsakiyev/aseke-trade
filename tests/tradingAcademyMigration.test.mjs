import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/202606120001_trading_academy_dashboard.sql", import.meta.url),
  "utf8"
);

test("migration defines Trading Academy access, leaderboard, signals, AML, and support models", () => {
  for (const expected of [
    "public.user_has_trading_academy_access",
    "public.get_trading_academy_leaderboard",
    "public.trading_signals",
    "public.aml_check_requests",
    "public.premium_support_requests"
  ]) {
    assert.match(migration, new RegExp(expected.replace(/[.]/g, "\\.")));
  }
});

test("AML RPC locks balance, checks funds, writes fee ledger, and creates the request", () => {
  assert.match(migration, /for update/i);
  assert.match(migration, /available_balance < fee_cents/i);
  assert.match(migration, /'Trading Academy AML check fee'/);
  assert.match(migration, /insert into public\.account_balance_transactions/i);
  assert.match(migration, /insert into public\.aml_check_requests/i);
  assert.match(migration, /transaction_type in \('deposit', 'purchase', 'refund', 'adjustment', 'fee'\)/i);
});

test("Academy dashboard tables have row level security policies", () => {
  assert.match(migration, /alter table public\.trading_signals enable row level security/i);
  assert.match(migration, /alter table public\.aml_check_requests enable row level security/i);
  assert.match(migration, /alter table public\.premium_support_requests enable row level security/i);
  assert.match(migration, /public\.has_premium_access\(\)/i);
  assert.match(migration, /public\.is_admin\(\)/i);
});
