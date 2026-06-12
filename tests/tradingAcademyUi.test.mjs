import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const adminSource = await readFile(new URL("../src/pages/AdminTradingAcademy.tsx", import.meta.url), "utf8");
const dashboardSource = await readFile(new URL("../src/pages/TradingAcademyDashboard.tsx", import.meta.url), "utf8");
const chartsSource = await readFile(new URL("../src/pages/Charts.tsx", import.meta.url), "utf8");
const cryptoMarketsSource = await readFile(new URL("../src/lib/cryptoMarkets.ts", import.meta.url), "utf8");

test("trading signal UI no longer renders Creation Price", () => {
  assert.doesNotMatch(adminSource, /Creation price/i);
  assert.doesNotMatch(dashboardSource, /Creation price/i);
  assert.doesNotMatch(adminSource, /signalForm\.price_at_creation/);
  assert.match(adminSource, /price_at_creation:\s*entryPrice/);
});

test("academy dashboard uses compact AML and support history previews", () => {
  assert.match(dashboardSource, /function CompactAmlHistory/);
  assert.match(dashboardSource, /function CompactSupportHistory/);
  assert.match(dashboardSource, /requests\.slice\(0,\s*3\)/);
  assert.match(dashboardSource, /<details className="compact-history-details">/);
});

test("leaderboard renders public avatars with fallback support", () => {
  assert.match(dashboardSource, /resolvePublicAvatarUrl\(row\.avatar_url\)/);
  assert.match(dashboardSource, /onError=\{\(\) => setHasImageError\(true\)\}/);
  assert.match(dashboardSource, /<UserRound size=\{16\}/);
  assert.match(dashboardSource, /leaderboard\.slice\(0,\s*3\)/);
  assert.match(dashboardSource, /setIsLeaderboardExpanded/);
});

test("academy dashboard includes a subscriber risk calculator", () => {
  assert.match(dashboardSource, /RiskCalculatorPanel/);
  assert.match(dashboardSource, /calculateRisk/);
  assert.match(dashboardSource, /risk-calculator-panel/);
});

test("charts market picker is a compact toolbar above the TradingView chart", () => {
  assert.match(chartsSource, /className="chart-market-toolbar"/);
  assert.match(chartsSource, /<details className="coin-picker">/);
  assert.match(chartsSource, /coreChartAssets\.map/);
  assert.match(cryptoMarketsSource, /BTC\/USDT/);
  assert.match(cryptoMarketsSource, /ETH\/USDT/);
});
