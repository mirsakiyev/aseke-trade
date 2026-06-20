import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/202606120001_trading_academy_dashboard.sql", import.meta.url),
  "utf8"
);
const signalReworkMigration = await readFile(
  new URL("../supabase/migrations/202606120003_rework_trading_signals.sql", import.meta.url),
  "utf8"
);
const signalAutomationMigration = await readFile(
  new URL("../supabase/migrations/202606190003_trading_signal_automation.sql", import.meta.url),
  "utf8"
);
const leaderboardAvatarMigration = await readFile(
  new URL("../supabase/migrations/202606120005_public_leaderboard_avatars.sql", import.meta.url),
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

test("leaderboard ranks active Trading Academy subscribers and excludes admins", () => {
  assert.match(migration, /from public\.premium_subscriptions as ps/i);
  assert.match(migration, /ps\.product_type = 'premium'/i);
  assert.match(migration, /ps\.status in \('pending', 'active'\)/i);
  assert.match(migration, /join public\.profiles as p on p\.id = active_members\.user_id/i);
  assert.match(migration, /where p\.role <> 'admin'/i);
});

test("leaderboard avatar migration exposes only public avatar URLs", () => {
  assert.match(leaderboardAvatarMigration, /drop function if exists public\.get_trading_academy_leaderboard\(\)/i);
  assert.match(leaderboardAvatarMigration, /avatar_url text/i);
  assert.match(leaderboardAvatarMigration, /nullif\(p\.avatar_url, ''\) as avatar_url/i);
  assert.doesNotMatch(leaderboardAvatarMigration, /p\.email|wallet|premium_until/i);
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

test("trading signal rework adds leverage, timeline, TP allocation, and subscriber-only signal access", () => {
  for (const expected of [
    "leverage integer",
    "generated_title text",
    "take_profits jsonb",
    "original_signal jsonb",
    "updates jsonb",
    "final_roi numeric"
  ]) {
    assert.match(signalReworkMigration, new RegExp(expected.replace(/[.]/g, "\\."), "i"));
  }

  assert.match(signalReworkMigration, /public\.validate_trading_signal_take_profits/i);
  assert.match(signalReworkMigration, /new\.created_at := old\.created_at/i);
  assert.match(signalReworkMigration, /new\.original_signal := old\.original_signal/i);
  assert.match(signalReworkMigration, /public\.has_premium_access\(\)/i);
  assert.doesNotMatch(signalReworkMigration, /and is_active = true/i);
});

test("trading signal automation migration adds backend reconciliation primitives", () => {
  for (const expected of [
    "last_checked_at timestamptz",
    "last_auto_update_price numeric",
    "last_auto_update_source text",
    "public.trading_signal_update_count",
    "public.save_reconciled_trading_signal",
    "for update",
    "trading-signal-reconcile-every-minute",
    "* * * * *",
    "app.settings.trading_signal_reconcile_url",
    "app.settings.trading_signal_reconcile_token"
  ]) {
    assert.match(signalAutomationMigration, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }

  assert.match(signalAutomationMigration, /new_update_count > old_update_count/i);
  assert.match(signalAutomationMigration, /old_update_count\.\.new_update_count - 1/i);
  assert.match(signalAutomationMigration, /revoke execute on function public\.save_reconciled_trading_signal/i);
  assert.match(signalAutomationMigration, /grant execute on function public\.save_reconciled_trading_signal\(jsonb, text, integer\) to service_role/i);
  assert.match(signalAutomationMigration, /notify pgrst, 'reload schema'/i);
});
