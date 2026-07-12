import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = async (path) => readFile(new URL(path, import.meta.url), "utf8");

const appSource = await source("../src/App.tsx");
const protectedRouteSource = await source("../src/components/ProtectedRoute.tsx");
const authSource = await source("../src/contexts/AuthContext.tsx");
const accessSource = await source("../src/lib/tradingAcademyAccess.ts");
const analystSource = await source("../src/pages/AiFuturesAnalyst.tsx");
const analystTypesSource = await source("../src/lib/aiFuturesTypes.ts");
const chartSource = await source("../src/components/FuturesCandlestickChart.tsx");
const demoTradeSource = await source("../src/pages/DemoTrade.tsx");
const apiSource = await source("../src/lib/aiFuturesApi.ts");
const dashboardSource = await source("../src/pages/TradingAcademyDashboard.tsx");
const academyAdminSource = await source("../src/pages/AdminTradingAcademy.tsx");
const analystAdminSource = await source("../src/pages/AdminAiFuturesAnalyst.tsx");
const loginSource = await source("../src/pages/Login.tsx");
const stylesSource = await source("../src/styles.css");

function sliceBetween(text, start, end) {
  const startIndex = text.indexOf(start);
  assert.ok(startIndex >= 0, `expected source marker: ${start}`);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `expected source marker after ${start}: ${end}`);
  return text.slice(startIndex, endIndex);
}

test("AI Futures routes are protected and remain lazy chunk boundaries", () => {
  assert.match(appSource, /const AiFuturesAnalyst = lazy\(\(\) =>\s*import\("\.\/pages\/AiFuturesAnalyst"\)/);
  assert.match(appSource, /const AdminAiFuturesAnalyst = lazy\(\(\) =>\s*import\("\.\/pages\/AdminAiFuturesAnalyst"\)/);
  assert.doesNotMatch(appSource, /import \{ AiFuturesAnalyst \} from/);
  assert.doesNotMatch(appSource, /import \{ AdminAiFuturesAnalyst \} from/);

  const academyRoute = sliceBetween(
    appSource,
    'path="trading-academy/ai-futures-analyst"',
    'path="demo-trade"'
  );
  assert.match(academyRoute, /<ProtectedRoute requireTradingAcademy>/);
  assert.match(academyRoute, /<Suspense fallback=\{<LoadingState label="Loading AI Futures Analyst"/);
  assert.match(academyRoute, /<AiFuturesAnalyst \/>/);

  const adminRoute = appSource.slice(appSource.indexOf('path="admin/trading-academy/ai-futures-analyst"'));
  assert.match(adminRoute, /<ProtectedRoute requireAdmin>/);
  assert.match(adminRoute, /<Suspense fallback=\{<LoadingState label="Loading AI Futures monitoring"/);
  assert.match(adminRoute, /<AdminAiFuturesAnalyst \/>/);
});

test("Academy access waits for profile loading and enforces current subscription access", () => {
  const loadingCheck = protectedRouteSource.indexOf("if (isLoading)");
  const loginCheck = protectedRouteSource.indexOf("if (!user)");
  const academyCheck = protectedRouteSource.indexOf("if (requireTradingAcademy && !isTradingAcademyMember)");
  const children = protectedRouteSource.indexOf("return <>{children}</>");
  assert.ok(loadingCheck >= 0 && loadingCheck < loginCheck && loginCheck < academyCheck && academyCheck < children);
  assert.match(protectedRouteSource, /LoadingState label="Checking account"/);
  assert.match(protectedRouteSource, /Navigate to="\/trading-academy" replace/);
  assert.match(protectedRouteSource, /Navigate to="\/login" replace state=\{\{ from: location \}\}/);

  assert.match(authSource, /setProfile\(await fetchProfile\(nextSession\.user\.id\)\)/);
  assert.match(authSource, /await applySession\(data\.session\);\s*setIsLoading\(false\)/);
  assert.match(authSource, /applySession\(nextSession\)\.finally\(\(\) => \{\s*if \(isMounted\) setIsLoading\(false\)/);
  assert.match(authSource, /isTradingAcademyMember: profileHasPremium\(profile\)/);
  assert.match(accessSource, /profile\.premium_starts_at[\s\S]*> now\) return false/);
  assert.match(accessSource, /new Date\(profile\.premium_until\)\.getTime\(\) > now/);
});

test("Academy and admin surfaces expose navigation to the analyst", () => {
  assert.match(dashboardSource, /AI Futures Analyst/);
  assert.match(dashboardSource, /to="\/trading-academy\/ai-futures-analyst"/);
  assert.match(dashboardSource, /Open Analyst/);
  assert.match(academyAdminSource, /to="\/admin\/trading-academy\/ai-futures-analyst"/);
  assert.match(academyAdminSource, /AI Futures monitor/);
  assert.match(analystSource, /to="\/trading-academy\/dashboard"/);
  assert.match(analystAdminSource, /to="\/admin\/trading-academy"/);
});

test("all six analyst verdicts render through the shared verdict surface", () => {
  const expectedStatuses = [
    "NO_TRADE",
    "WAIT_FOR_ENTRY",
    "LONG_SETUP",
    "SHORT_SETUP",
    "DATA_UNAVAILABLE",
    "RISK_LIMIT_EXCEEDED"
  ];
  for (const status of expectedStatuses) assert.match(analystTypesSource, new RegExp(`\\|? \\"${status}\\"`));

  assert.match(analystSource, /verdict-\$\{analysis\.status\.toLowerCase\(\)\}/);
  assert.match(analystSource, /<h2>\{formatStatus\(analysis\.status\)\}<\/h2>/);
  assert.match(analystSource, /<p>\{analysis\.message\}<\/p>/);
  assert.match(analystSource, /function formatStatus\(status: string\) \{ return status\.replace\(\/_\/g, " "\); \}/);
  assert.match(analystSource, /analysis\.status === "WAIT_FOR_ENTRY"/);
  assert.match(analystSource, /analysis\.status === "LONG_SETUP" \|\| analysis\.status === "SHORT_SETUP"/);
  assert.match(analystSource, /analysis\?\.status === "NO_TRADE" \? "No setup overlay"/);
  assert.match(stylesSource, /\.ai-verdict-card\.verdict-long_setup/);
  assert.match(stylesSource, /\.ai-verdict-card\.verdict-short_setup/);
  assert.match(stylesSource, /\.ai-verdict-card\.verdict-no_trade,[\s\S]*\.ai-verdict-card\.verdict-wait_for_entry/);
});

test("analyst chart is read-only and renders setup overlays plus auditable metadata", () => {
  assert.match(analystSource, /<FuturesCandlestickChart[\s\S]*overlayLines=\{chartLines\}[\s\S]*overlayZones=\{chartZones\}[\s\S]*readOnly/);
  assert.match(analystSource, /id: "ai-stop"[\s\S]*tone: "danger"/);
  assert.match(analystSource, /id: "ai-invalidation"[\s\S]*tone: "invalidation"/);
  assert.match(analystSource, /label: `\$\{target\.label\} \$\{target\.positionSizePercent\}%`[\s\S]*tone: "target"/);
  assert.match(analystSource, /id: "ai-entry-zone"[\s\S]*tone: "entry"/);
  assert.match(chartSource, /data-read-only=\{readOnly \? "true" : "false"\}/);
  assert.match(chartSource, /renderedZones\.map/);
  assert.match(chartSource, /overlayLineLayouts\.map/);

  assert.match(analystSource, /\{analysis\.source\}/);
  assert.match(analystSource, /Metric label="Setup created"/);
  assert.match(analystSource, /Metric label="Setup expires"/);
  assert.match(analystSource, /Sources and freshness/);
  assert.match(analystSource, /analysis\.freshness\.map/);
  assert.match(analystSource, /Analysis generated[\s\S]*analysis\.dataTimestamp/);
  assert.match(analystSource, /analysis\.sentimentAttribution\.url/);
});

test("AI Futures chart and analysis layouts have explicit tablet and mobile behavior", () => {
  assert.match(stylesSource, /@media \(max-width: 900px\) \{[\s\S]*\.ai-futures-control-grid,[\s\S]*\.ai-result-grid,[\s\S]*\.ai-evidence-grid,[\s\S]*grid-template-columns: 1fr/);
  assert.match(stylesSource, /@media \(max-width: 900px\) \{[\s\S]*\.ai-futures-chart \{\s*min-height: 25rem/);
  assert.match(stylesSource, /@media \(max-width: 640px\) \{[\s\S]*\.ai-verdict-heading[\s\S]*\.ai-plan-grid,[\s\S]*\.ai-quality-row[\s\S]*grid-template-columns: 1fr/);
  assert.match(stylesSource, /@media \(max-width: 640px\) \{[\s\S]*\.ai-demo-prefill-banner[\s\S]*flex-direction: column/);
});

test("risk planning UI supports presets, constrained custom inputs, optional saving, and disclosures", () => {
  assert.match(analystSource, /\(\["conservative", "balanced", "aggressive"\] as const\)\.map/);
  assert.match(analystSource, /preset: "balanced"/);
  assert.match(analystSource, /riskProfile\.preset === "custom"/);
  assert.match(analystSource, /Planning Balance \(USDT\)/);
  assert.match(analystSource, /Risk per trade \(%\)/);
  assert.match(analystSource, /Maximum leverage[\s\S]*min=\{1\}[\s\S]*max=\{10\}/);
  assert.match(analystSource, /Maximum balance allocated as margin \(%\)/);
  assert.match(analystSource, /Save this risk profile to my account/);
  assert.match(analystSource, /requestAiFuturesAnalysis\(riskProfile\)/);
  assert.match(analystSource, /Planning only\. ASEKE TRADE does not hold or control exchange funds\./);
  assert.match(analystSource, /Educational analysis only\. Not financial advice\./);
  assert.match(analystSource, /Futures and leverage can cause rapid or total loss/);
  assert.match(analystSource, /confluence score, not a probability of profit/);
});

test("Demo Trade imports only a protected server-owned plan by opaque ID", () => {
  assert.match(analystSource, /navigate\(`\/demo-trade\?aiPlan=\$\{encodeURIComponent\(planId\)\}`\)/);
  assert.match(apiSource, /supabase\.functions\.invoke\("ai-futures-plan"/);
  assert.match(apiSource, /body: \{ plan_id: planId \}/);
  assert.match(apiSource, /Authorization: `Bearer \$\{session\.access_token\}`/);
  const prefillFunction = sliceBetween(apiSource, "export async function fetchAiDemoTradePrefill", "export async function fetchAiAdminData");
  assert.doesNotMatch(prefillFunction, /\.from\("ai_user_trade_plans"\)/);
  assert.doesNotMatch(prefillFunction, /direction|entryPrice|stopLoss|leverage|notional/);
  assert.match(demoTradeSource, /searchParams\.get\("aiPlan"\)/);
  assert.match(demoTradeSource, /fetchAiDemoTradePrefill\(planId\)/);
  assert.match(demoTradeSource, /next\.delete\("aiPlan"\)/);
});

test("Demo Trade prefill never overwrites an existing position or pending order", () => {
  const effect = sliceBetween(demoTradeSource, 'const planId = searchParams.get("aiPlan")', "const loadMarketData = useCallback");
  const guard = effect.indexOf("if (demoState.openPosition || demoState.pendingLimitOrder)");
  const fetchPlan = effect.indexOf("fetchAiDemoTradePrefill(planId)");
  const firstFormMutation = effect.indexOf('setOrderType("limit")');
  assert.ok(guard >= 0 && guard < fetchPlan && fetchPlan < firstFormMutation);
  assert.match(effect, /not imported because this demo account already has an open position or pending order/);
  assert.match(effect, /clearPlanParameter\(\);\s*return;/);
  assert.doesNotMatch(effect.slice(0, fetchPlan), /setLimitPrice|setAmount|setLeverage|setStopLoss|setTakeProfits/);
});

test("Demo Trade prefill fills a reviewable isolated limit form but requires explicit confirmation", () => {
  const effect = sliceBetween(demoTradeSource, 'const planId = searchParams.get("aiPlan")', "const loadMarketData = useCallback");
  assert.match(effect, /setOrderType\("limit"\)/);
  assert.match(effect, /setLimitPrice\(plan\.entryPrice\)/);
  assert.match(effect, /setMarginMode\("isolated"\)/);
  assert.match(effect, /setAmount\(plan\.notional\)/);
  assert.match(effect, /setLeverage\(String\(plan\.leverage\)\)/);
  assert.match(effect, /setStopLoss\(plan\.stopLoss\)/);
  assert.match(effect, /setTakeProfits\(plan\.takeProfits\.map/);
  assert.match(effect, /Review every field, then explicitly choose Open/);
  assert.doesNotMatch(effect, /commitDemoState|openDemo|placeOrder|submitOrder/);
  assert.match(demoTradeSource, /Importing this plan did not place or persist an order/);
  assert.match(demoTradeSource, /AI practice plan imported for review/);
});

test("admin UI exposes versioned feature, shadow, AI-call, kill-switch, and monitoring controls", () => {
  assert.match(analystAdminSource, /StatusCard label="Feature"/);
  assert.match(analystAdminSource, /StatusCard label="Mode"/);
  assert.match(analystAdminSource, /StatusCard label="AI calls"/);
  assert.match(analystAdminSource, /StatusCard label="Kill switch"/);
  assert.match(analystAdminSource, /BooleanControl label="Feature enabled"/);
  assert.match(analystAdminSource, /BooleanControl label="Shadow mode"/);
  assert.match(analystAdminSource, /BooleanControl label="AI calls enabled"/);
  assert.match(analystAdminSource, /BooleanControl label="Emergency kill switch"/);
  assert.match(analystAdminSource, /window\.confirm\("Create a new immutable AI Futures configuration version/);
  assert.match(analystAdminSource, /A configuration change reason is required/);
  assert.match(analystAdminSource, /Create configuration version/);
  assert.match(apiSource, /supabase\.rpc\("admin_create_ai_futures_config"/);

  for (const metric of [
    "Entry trigger rate",
    "Completed win rate",
    "Expectancy after costs",
    "No-trade frequency",
    "Provider failure rate"
  ]) assert.match(analystAdminSource, new RegExp(metric));
  assert.match(analystAdminSource, /Recent pipeline and provider failures/);
  assert.match(analystAdminSource, /Read-only snapshot inspector/);
});

test("admin corrections are append-only notes and never rewrite predictions", () => {
  assert.match(analystAdminSource, /Append-only correction/);
  assert.match(analystAdminSource, /without changing the original setup/);
  assert.match(analystAdminSource, /disabled=\{isSaving \|\| !noteSetupId \|\| !adminNote\.trim\(\)\}/);
  assert.match(analystAdminSource, /appendAiSetupAdminNote\(noteSetupId, adminNote\)/);
  assert.match(analystAdminSource, /Historical snapshots and predictions cannot be edited/);
  const noteFunction = sliceBetween(apiSource, "export async function appendAiSetupAdminNote", "export async function createAiAdminConfig");
  assert.match(noteFunction, /\.from\("ai_setup_admin_notes"\)\.insert/);
  assert.match(noteFunction, /note\.trim\(\)/);
  assert.match(noteFunction, /safeNote\.length > 4_000/);
  assert.doesNotMatch(noteFunction, /\.update\(|\.upsert\(|\.delete\(/);
});

test("login preserves the full protected return URL", () => {
  assert.match(protectedRouteSource, /state=\{\{ from: location \}\}/);
  assert.match(loginSource, /pathname\?: string;\s*search\?: string;\s*hash\?: string/);
  assert.match(loginSource, /`\$\{returnLocation\.pathname\}\$\{returnLocation\.search \?\? ""\}\$\{returnLocation\.hash \?\? ""\}`/);
  assert.match(loginSource, /if \(user\) return <Navigate to=\{redirectTo\} replace \/>/);
});
