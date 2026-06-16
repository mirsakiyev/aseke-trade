import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../src/pages/DemoTrade.tsx", import.meta.url), "utf8");
const persistenceSource = await readFile(new URL("../src/lib/demoTradePersistence.ts", import.meta.url), "utf8");
const marketDataSource = await readFile(new URL("../src/lib/demoTradeMarketData.ts", import.meta.url), "utf8");
const migrationSource = await readFile(new URL("../supabase/migrations/202606160001_demo_trade.sql", import.meta.url), "utf8");

test("Demo Trade page renders as a public route", () => {
  assert.match(appSource, /import \{ DemoTrade \} from "\.\/pages\/DemoTrade"/);
  assert.match(appSource, /path="demo-trade" element=\{<DemoTrade \/>\}/);
  assert.doesNotMatch(appSource, /path="demo-trade"[\s\S]{0,120}ProtectedRoute/);
});

test("header contains Demo Trade link for all users", () => {
  assert.match(layoutSource, /to: "\/demo-trade", label: "Demo Trade"/);
  assert.match(layoutSource, /ChartCandlestick/);
});

test("Demo Trade page includes guest and authenticated persistence paths", () => {
  assert.match(pageSource, /loadGuestDemoTradeState/);
  assert.match(pageSource, /saveGuestDemoTradeState/);
  assert.match(pageSource, /loadRegisteredDemoTradeState/);
  assert.match(pageSource, /saveRegisteredDemoTradeState/);
  assert.match(persistenceSource, /window\.sessionStorage/);
  assert.match(persistenceSource, /demo_trade_states/);
  assert.match(persistenceSource, /save_demo_trade_state/);
});

test("Demo Trade page includes custom chart and no TradingView widget", () => {
  assert.match(pageSource, /function DemoTradeChart/);
  assert.match(pageSource, /chartClassName/);
  assert.match(pageSource, /buildOverlayLines/);
  assert.doesNotMatch(pageSource, /TradingViewChart|tradingview-widget|s3\.tradingview/);
});

test("Demo Trade chart has timeframe tabs, right price scale, and compact controls", () => {
  assert.match(pageSource, /demoTradeTimeframes\.map/);
  assert.match(pageSource, /chart-axis-panel/);
  assert.match(pageSource, /chart-price-label/);
  assert.match(pageSource, /onContextMenu=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(pageSource, /onPointerDown=\{startRightDrag\}/);
  assert.match(pageSource, /setPointerCapture/);
  assert.match(pageSource, /event\.clientX - dragStartRef\.current\.x/);
  assert.match(pageSource, /priceScaleStartRef/);
  assert.match(pageSource, /line\.tone !== "liquidation"/);
  assert.match(pageSource, /startRightDrag/);
  assert.match(pageSource, /Minus/);
  assert.doesNotMatch(pageSource, /Zoom In|Zoom Out|Pan Left|Pan Right/);
  assert.doesNotMatch(pageSource, /ArrowLeft|ArrowRight/);
});

test("Demo Trade page includes trade ticket, management, CSV export, and reset modal", () => {
  assert.match(pageSource, /function TradeEntryForm/);
  assert.match(pageSource, /futures-ticket/);
  assert.match(pageSource, /BTCUSDT Perpetual/);
  assert.match(pageSource, /Limit orders are available for registered users only/);
  assert.match(pageSource, /Limit Price/);
  assert.match(pageSource, /Position size percent/);
  assert.match(pageSource, /Long Liquidation Price/);
  assert.match(pageSource, /Open Short/);
  assert.doesNotMatch(pageSource, /Chase Limit/);
  assert.doesNotMatch(pageSource, /Position Size/);
  assert.match(pageSource, /function PositionManager/);
  assert.match(pageSource, /openDemoPosition/);
  assert.match(pageSource, /updateDemoStopLoss/);
  assert.match(pageSource, /updateDemoTakeProfits/);
  assert.match(pageSource, /updateDemoLeverage/);
  assert.match(pageSource, /Manual Close at Market/);
  assert.match(pageSource, /Export CSV/);
  assert.match(pageSource, /Changing your starting demo balance will reset your current demo progress/);
  assert.match(pageSource, /Reset and Apply New Balance/);
});

test("BTC market data provider is isolated and uses public REST data", () => {
  assert.match(marketDataSource, /fetchDemoTradeCandles/);
  assert.match(marketDataSource, /fetchDemoTradeTicker/);
  assert.match(marketDataSource, /DemoTradeTimeframe = "1m" \| "5m" \| "15m" \| "1h" \| "4h" \| "1d" \| "1w"/);
  assert.match(marketDataSource, /api\.binance\.us\/api\/v3/);
  assert.doesNotMatch(marketDataSource, /apiKey|secret|TradingView/);
});

test("registered demo state migration includes RLS and server-side validation", () => {
  assert.match(migrationSource, /create table if not exists public\.demo_trade_states/);
  assert.match(migrationSource, /enable row level security/);
  assert.match(migrationSource, /auth\.uid\(\) = user_id/);
  assert.match(migrationSource, /validate_demo_trade_state/);
  assert.match(migrationSource, /save_demo_trade_state/);
  assert.match(migrationSource, /BTCUSDT/);
});
