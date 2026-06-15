import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const adminSource = await readFile(new URL("../src/pages/AdminTradingAcademy.tsx", import.meta.url), "utf8");
const dashboardSource = await readFile(new URL("../src/pages/TradingAcademyDashboard.tsx", import.meta.url), "utf8");
const chartsSource = await readFile(new URL("../src/pages/Charts.tsx", import.meta.url), "utf8");
const cryptoMarketsSource = await readFile(new URL("../src/lib/cryptoMarkets.ts", import.meta.url), "utf8");
const marketIndicesSource = await readFile(new URL("../src/lib/marketIndices.ts", import.meta.url), "utf8");

test("trading signal UI no longer renders Creation Price", () => {
  assert.doesNotMatch(adminSource, /Creation price/i);
  assert.doesNotMatch(dashboardSource, /Creation price/i);
  assert.doesNotMatch(adminSource, /signalForm\.price_at_creation/);
  assert.match(adminSource, /price_at_creation:\s*entryPrice/);
});

test("academy dashboard uses compact AML history and direct premium support", () => {
  assert.match(dashboardSource, /function CompactAmlHistory/);
  assert.match(dashboardSource, /requests\.slice\(0,\s*3\)/);
  assert.match(dashboardSource, /<details className="compact-history-details">/);
  assert.match(dashboardSource, /Message Premium Support/);
  assert.match(dashboardSource, /https:\/\/t\.me\/don_chrome/);
  assert.doesNotMatch(dashboardSource, /function CompactSupportHistory/);
  assert.doesNotMatch(dashboardSource, /fetchUserPremiumSupportRequests|submitPremiumSupportRequest/);
  assert.doesNotMatch(dashboardSource, /supportForm|isSupportSubmitting|Send Support Request|Join Community/);
});

test("trading signal card renders live title and updated stop loss state", () => {
  assert.match(dashboardSource, /getSignalDisplayTitle\(signal\)/);
  assert.match(dashboardSource, /function SignalStopLossLevel/);
  assert.match(dashboardSource, /signal-stop-loss-level updated/);
  assert.match(dashboardSource, /<s>\{formatSignalPrice\(originalValue\)\}<\/s>/);
  assert.match(dashboardSource, /<strong>\{formatSignalPrice\(currentValue\)\}<\/strong>/);
});

test("past trades render as a compact expandable table with reusable details", () => {
  assert.match(dashboardSource, /const PAST_TRADES_PREVIEW_LIMIT = 5/);
  assert.match(dashboardSource, /setIsPastTradesExpanded/);
  assert.match(dashboardSource, /setSelectedPastTradeId/);
  assert.match(dashboardSource, /function PastTradesTable/);
  assert.match(dashboardSource, /pastTrades\.slice\(0,\s*PAST_TRADES_PREVIEW_LIMIT\)/);
  assert.match(dashboardSource, /getPastTradeCloseTimestamp\(second\) - getPastTradeCloseTimestamp\(first\)/);
  assert.match(dashboardSource, /<th scope="col">Symbol \/ Pair<\/th>/);
  assert.match(dashboardSource, /<th scope="col">Direction<\/th>/);
  assert.match(dashboardSource, /<th scope="col">Trade Open Date<\/th>/);
  assert.match(dashboardSource, /<th scope="col">Trade Close Date<\/th>/);
  assert.match(dashboardSource, /<th scope="col">ROI<\/th>/);
  assert.match(dashboardSource, /aria-label=\{`View full trade details for \$\{trade\.symbol\}`\}/);
  assert.match(dashboardSource, /View all \$\{totalTrades\}/);
  assert.match(dashboardSource, /Show less/);
  assert.match(dashboardSource, /<SignalCard signal=\{selectedPastTrade\} showPastSummary \/>/);
  assert.doesNotMatch(dashboardSource, /pastTrades\.map\(\(signal\) =>\s*\(\s*<SignalCard signal=\{signal\} showPastSummary key=\{signal\.id\} \/>/);
});

test("leaderboard renders public avatars with fallback support", () => {
  assert.match(dashboardSource, /resolvePublicAvatarUrl\(row\.avatar_url\)/);
  assert.match(dashboardSource, /onError=\{\(\) => setHasImageError\(true\)\}/);
  assert.match(dashboardSource, /<UserRound size=\{16\}/);
  assert.match(dashboardSource, /leaderboard\.slice\(0,\s*3\)/);
  assert.match(dashboardSource, /setIsLeaderboardExpanded/);
  assert.match(dashboardSource, /leaderboard-member-info/);
  assert.match(dashboardSource, /<h2 className="title-with-leading-icon">\s*<Trophy size=\{28\}/);
  assert.match(dashboardSource, /<LeaderboardBadgeStrip row=\{row\}/);
  assert.doesNotMatch(dashboardSource, /toggleLeaderboardBadges/);
});

test("academy dashboard includes a subscriber risk calculator", () => {
  assert.match(dashboardSource, /RiskCalculatorPanel/);
  assert.match(dashboardSource, /<h2 className="title-with-leading-icon">\s*<Calculator size=\{28\}/);
  assert.doesNotMatch(dashboardSource, /Position plan/);
  assert.match(dashboardSource, /form\.direction === "long" \? "long active" : "long"/);
  assert.match(dashboardSource, /form\.direction === "short" \? "short active" : "short"/);
  assert.match(dashboardSource, /calculateRisk/);
  assert.match(dashboardSource, /risk-calculator-panel/);
  assert.match(dashboardSource, /takeProfits:\s*\[createRiskTakeProfitInput\(\)\]/);
  assert.match(dashboardSource, /addRiskTakeProfit/);
  assert.match(dashboardSource, /removeRiskTakeProfit/);
  assert.match(dashboardSource, /riskLeverageOptions/);
  assert.match(dashboardSource, /hasRiskCalculated/);
  assert.match(dashboardSource, /calculateCurrentRisk/);
  assert.match(dashboardSource, /stopLossMode/);
  assert.match(dashboardSource, /takeProfitMode/);
  assert.match(dashboardSource, /manualNotionalValue/);
  assert.match(dashboardSource, /Stop Loss Mode/);
  assert.match(dashboardSource, /Take Profits/);
  assert.match(dashboardSource, /Max Loss at Stop %/);
  assert.match(dashboardSource, /form\.positionSizeMode === "auto"/);
  assert.match(dashboardSource, /Manual: I choose position value/);
  assert.match(dashboardSource, /Auto: Calculate position from max loss/);
  assert.match(dashboardSource, /manualNotionalValue: form\.manualNotionalValue \|\| form\.accountBalance/);
  assert.match(dashboardSource, /RiskModeSummary/);
  assert.match(dashboardSource, /RiskAutoExplanation/);
  assert.match(dashboardSource, /Notional Position Value/);
  assert.match(dashboardSource, /Stop Loss Distance/);
  assert.match(dashboardSource, /Position value, margin, and account risk are different/);
  assert.doesNotMatch(dashboardSource, /riskForm\.symbol|<label>\s*Pair/);
  assert.doesNotMatch(dashboardSource, /Position Risk/);
  assert.doesNotMatch(dashboardSource, /coins/);
  assert.doesNotMatch(dashboardSource, /placeholder="(?:63404|62555|64444|65555|66666)"/);
  assert.match(dashboardSource, /Risk Breakdown/);
  assert.match(dashboardSource, /Risk Assessment/);
  assert.match(dashboardSource, /role="meter"/);
  assert.match(dashboardSource, /aria-valuetext=\{assessment\.ariaLabel\}/);
  assert.match(dashboardSource, /5%\+/);
});

test("charts market picker is a compact toolbar above the TradingView chart", () => {
  assert.match(chartsSource, /className="chart-market-toolbar"/);
  assert.match(chartsSource, /<details className="coin-picker">/);
  assert.match(chartsSource, /<summary>Select Crypto<\/summary>/);
  assert.doesNotMatch(chartsSource, /coreChartAssets\.map/);
  assert.doesNotMatch(chartsSource, /Core cryptocurrency chart selector/);
  assert.doesNotMatch(chartsSource, /Top 200/);
  assert.match(cryptoMarketsSource, /BTC\/USDT/);
  assert.match(cryptoMarketsSource, /ETH\/USDT/);
});

test("charts page renders market sentiment and risk widgets after the chart", () => {
  assert.match(chartsSource, /<MarketSentimentSection[\s\S]*indices=\{marketIndices\}/);
  assert.match(chartsSource, /Market Sentiment & Risk/);
  assert.match(chartsSource, /Crypto Fear & Greed Index/);
  assert.match(chartsSource, /Longs vs Shorts Futures/);
  assert.match(chartsSource, /Crypto Market Volatility Index/);
  assert.match(chartsSource, /fetchMarketIndices/);
  assert.doesNotMatch(chartsSource, /marketIndicesRefreshMs|window\.setInterval/);
  assert.match(chartsSource, /Source: Binance public futures data/);
  assert.match(chartsSource, /Checked \{formatIndexTimestamp\(checkedAt\)\}/);
  assert.match(chartsSource, /Source \{formatIndexTimestamp\(sourceTimestamp\)\}/);
  assert.match(chartsSource, /Next source update in/);
  assert.doesNotMatch(chartsSource, />BINANCE ONLY</);
  assert.doesNotMatch(chartsSource, /aria-label="Select futures exchange"/);
  assert.doesNotMatch(chartsSource, /Major CEX Average/);
  assert.match(marketIndicesSource, /fetchPublicMarketIndices/);
  assert.doesNotMatch(marketIndicesSource, /clientMarketIndicesCache|clientCacheMs|cacheMarketIndices/);
  assert.match(marketIndicesSource, /buildBinanceLongShortIndex/);
  for (const removedProviderTerm of ["COIN" + "GLASS_API_KEY", "open-api-v4." + "coin" + "glass.com", "CG-" + "API-KEY"]) {
    assert.equal(marketIndicesSource.includes(removedProviderTerm), false);
  }
});
