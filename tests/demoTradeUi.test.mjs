import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../src/pages/DemoTrade.tsx", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
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
  assert.match(persistenceSource, /window\.localStorage/);
  assert.match(persistenceSource, /registeredStateKey/);
  assert.match(persistenceSource, /chooseLatestState/);
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
  assert.match(pageSource, /onLostPointerCapture=\{stopRightDrag\}/);
  assert.match(pageSource, /dragStartRef\.current \|\| priceScaleStartRef\.current\) return/);
  assert.match(pageSource, /setPointerCapture/);
  assert.match(pageSource, /event\.clientX - dragStartRef\.current\.x/);
  assert.match(pageSource, /futurePaddingCandles/);
  assert.match(pageSource, /pricePan/);
  assert.match(pageSource, /visiblePriceRange/);
  assert.match(pageSource, /setPricePan\(dragStartRef\.current\.pricePan \+ deltaY \* pricePerPixel\)/);
  assert.match(pageSource, /priceScaleStartRef/);
  assert.match(pageSource, /crosshair/);
  assert.match(pageSource, /updateCrosshair/);
  assert.match(pageSource, /getSvgPointer/);
  assert.match(pageSource, /chart-crosshair-price/);
  assert.match(pageSource, /line\.tone !== "liquidation"/);
  assert.match(pageSource, /label: "Entry", price: position\.entryPrice/);
  assert.match(pageSource, /subscribeDemoTradePriceStream/);
  assert.match(pageSource, /applyLiveTicker/);
  assert.match(pageSource, /getCandleBucketStart/);
  assert.match(pageSource, /startRightDrag/);
  assert.match(pageSource, /ZoomIn/);
  assert.match(pageSource, /ZoomOut/);
  assert.match(pageSource, /isBullishCandle/);
  assert.match(pageSource, /latestCandleTone/);
  assert.match(stylesSource, /trade-overlay-line\.mark\.up \.chart-price-marker/);
  assert.match(stylesSource, /trade-overlay-line\.mark\.down \.chart-price-marker/);
  assert.match(stylesSource, /aspect-ratio: 1/);
  assert.match(pageSource, /DEMO_TRADE_LIVE_REFRESH_MS = 1000/);
  assert.match(pageSource, /DEMO_TRADE_CANDLE_SYNC_MS = 10000/);
  assert.match(pageSource, /applyLivePriceToCandles/);
  assert.match(pageSource, /buildCandleShape/);
  assert.match(pageSource, /minWickHeight/);
  assert.doesNotMatch(pageSource, /clampPricePan|minPricePan|maxPricePan|clampedPricePan/);
  assert.doesNotMatch(pageSource, /chartTop|chartBottom/);
  assert.match(marketDataSource, /"6h"/);
  assert.match(marketDataSource, /"12h"/);
  assert.match(marketDataSource, /"1M"/);
  assert.doesNotMatch(pageSource, /Zoom In|Zoom Out|Pan Left|Pan Right/);
  assert.doesNotMatch(pageSource, /ArrowLeft|ArrowRight/);
});

test("Demo Trade page includes trade ticket, management, CSV export, and reset modal", () => {
  assert.match(pageSource, /function TradeEntryForm/);
  assert.match(pageSource, /futures-ticket/);
  assert.match(stylesSource, /align-items: stretch/);
  assert.match(stylesSource, /demo-ticket-panel[\s\S]*align-self: stretch/);
  assert.match(pageSource, /type DemoQuantityUnit = "usdt" \| "btc" \| "cont"/);
  assert.match(pageSource, /Futures Unit Settings/);
  assert.match(pageSource, /quantityUnitLabels/);
  assert.match(pageSource, /DEMO_CONTRACT_BTC_SIZE = 0\.0001/);
  assert.match(pageSource, /quantityInputToNotional/);
  assert.match(pageSource, /notionalToQuantityInput/);
  assert.match(pageSource, /convertQuantityInput/);
  assert.match(pageSource, /quantityUnit=\{quantityUnit\}/);
  assert.match(pageSource, /pendingLimitOrder\.quantityUnit/);
  assert.match(pageSource, /Quantity \(\{unitLabel\}\)/);
  assert.match(stylesSource, /futures-unit-modal/);
  assert.match(stylesSource, /futures-quantity-label/);
  assert.match(pageSource, /BTCUSDT Perpetual/);
  assert.match(pageSource, /Limit orders are available for registered users only/);
  assert.match(pageSource, /Limit Price/);
  assert.match(pageSource, /marginMode/);
  assert.match(pageSource, /Margin mode/);
  assert.match(pageSource, /Cross/);
  assert.match(pageSource, /liquidationCollateral/);
  assert.match(pageSource, /isBracketEnabled/);
  assert.match(pageSource, /stopLoss: 0/);
  assert.match(pageSource, /floorTo/);
  assert.match(pageSource, /Position size percent/);
  assert.match(pageSource, /percentSliderStyle/);
  assert.match(stylesSource, /--slider-thumb-center/);
  assert.match(stylesSource, /--slider-quarter-offset/);
  assert.match(stylesSource, /futures-percent-marks span:nth-child\(4\)/);
  assert.match(pageSource, /Long Liquidation Price/);
  assert.match(pageSource, /Open Short/);
  assert.doesNotMatch(pageSource, /Chase Limit/);
  assert.doesNotMatch(pageSource, /Position Size/);
  assert.doesNotMatch(pageSource, />S<\/span>/);
  assert.doesNotMatch(pageSource, /futures-direction-toggle/);
  assert.doesNotMatch(pageSource, /Refresh BTC/);
  assert.doesNotMatch(pageSource, /Data \/ Save/);
  assert.doesNotMatch(pageSource, /Saving\.\.\.|Ready/);
  assert.doesNotMatch(pageSource, /Trigger Price|pendingTriggerOrder|isTriggerPriceReached/);
  assert.match(pageSource, /function PositionManager/);
  assert.match(pageSource, /function CurrentTradeRow/);
  assert.match(pageSource, /current-trade-row/);
  assert.match(pageSource, /increaseDemoPosition/);
  assert.match(pageSource, /Add to Position/);
  assert.match(pageSource, /Add position size percent/);
  assert.match(pageSource, /commitDemoState/);
  assert.match(pageSource, /closeOpenPositionByPercent/);
  assert.match(pageSource, /Manual close size percent/);
  assert.match(pageSource, /openDemoPosition/);
  assert.match(pageSource, /updateDemoStopLoss/);
  assert.match(pageSource, /updateDemoTakeProfits/);
  assert.match(pageSource, /updateDemoLeverage/);
  assert.match(pageSource, /Close at Market/);
  assert.match(pageSource, /Export CSV/);
  assert.match(pageSource, /Changing your starting demo balance will reset your current demo progress/);
  assert.match(pageSource, /Reset and Apply New Balance/);
});

test("BTC market data provider is isolated and uses public REST data", () => {
  assert.match(marketDataSource, /fetchDemoTradeCandles/);
  assert.match(marketDataSource, /fetchDemoTradeTicker/);
  assert.match(marketDataSource, /subscribeDemoTradePriceStream/);
  assert.match(marketDataSource, /WebSocket/);
  assert.match(marketDataSource, /@trade/);
  assert.match(marketDataSource, /DemoTradeTimeframe = "1m" \| "5m" \| "15m" \| "1h" \| "4h" \| "6h" \| "12h" \| "1d" \| "1w" \| "1M"/);
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
