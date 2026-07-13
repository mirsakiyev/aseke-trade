import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const migration = await source("../supabase/migrations/202607120002_ai_futures_analyst.sql");
const httpSource = await source("../supabase/functions/_shared/ai-futures-http.ts");
const marketSource = await source("../supabase/functions/_shared/ai-futures-market.ts");
const openAiSource = await source("../supabase/functions/_shared/ai-futures-openai.ts");
const orchestratorSource = await source("../supabase/functions/_shared/ai-futures-orchestrator.ts");
const analyzeSource = await source("../supabase/functions/ai-futures-analyze/index.ts");
const planSource = await source("../supabase/functions/ai-futures-plan/index.ts");
const pipelineSource = await source("../supabase/functions/ai-futures-pipeline/index.ts");
const outcomesSource = await source("../supabase/functions/ai-futures-outcomes/index.ts");
const clientApiSource = await source("../src/lib/aiFuturesApi.ts");
const edgeDependencySources = await Promise.all([
  "aiFuturesConfig.ts",
  "aiFuturesDecimal.ts",
  "aiFuturesFeatures.ts",
  "aiFuturesOutcome.ts",
  "aiFuturesRisk.ts",
  "aiFuturesSetup.ts",
  "aiFuturesTypes.ts",
  "aiFuturesValidator.ts"
].map((file) => source(`../src/lib/${file}`)));

const claimAnalysisSql = sqlFunction("claim_ai_futures_analysis_request");
const claimSetupSql = sqlFunction("claim_ai_futures_setup_generation");
const completeSetupSql = sqlFunction("complete_ai_futures_setup_generation");
const failSetupSql = sqlFunction("fail_ai_futures_setup_generation");
const saveOutcomeSql = sqlFunction("save_ai_setup_outcome_reconciliation");

const openAiModule = await importTranspiled(
  openAiSource,
  /import\s*\{\s*AI_FUTURES_PROMPT_VERSION\s*\}\s*from\s*["'][^"']+aiFuturesConfig\.ts["'];?/,
  'const AI_FUTURES_PROMPT_VERSION = "test-prompt-v1";'
);
const marketModule = await importTranspiled(
  marketSource,
  /import\s*\{\s*AI_FUTURES_LIMITS\s*\}\s*from\s*["'][^"']+aiFuturesConfig\.ts["'];?/,
  `const AI_FUTURES_LIMITS = {
    candleStaleAfterSeconds: { "15m": 1200, "1h": 7200, "4h": 28800 },
    liveMetricStaleAfterSeconds: 30,
    positioningStaleAfterSeconds: 900,
    sentimentStaleAfterSeconds: 172800,
    minimumCandles: 220,
    maximumLeverage: 10
  };`
);

globalThis.Deno ??= { env: { get: () => undefined } };

test("user endpoints reject logged-out calls and derive identity from the verified bearer token", () => {
  assert.match(httpSource, /const token = bearerToken\(request\)/);
  assert.match(httpSource, /if \(!token\) throw new AiHttpError\(401, "auth_required"/);
  assert.match(httpSource, /supabase\.auth\.getUser\(token\)/);
  assert.match(httpSource, /if \(error \|\| !data\.user\) throw new AiHttpError\(401, "invalid_session"/);

  for (const endpoint of [analyzeSource, planSource]) {
    assert.match(endpoint, /const user = await requireAiUser\(request, supabase\)/);
    assert.doesNotMatch(endpoint, /user_id:\s*body\.(?:user_id|userId)/);
  }
  assert.match(planSource, /\.eq\("user_id", user\.id\)/);
});

test("Academy authorization checks active start and expiration server-side", () => {
  const accessSql = sqlFunction("ai_futures_user_has_academy_access");
  assert.match(accessSql, /profile\.premium_until\s*>\s*now\(\)/i);
  assert.match(accessSql, /profile\.premium_starts_at is null or profile\.premium_starts_at <= now\(\)/i);
  assert.match(accessSql, /subscription\.product_type = 'premium'/i);
  assert.match(accessSql, /subscription\.status in \('pending', 'active'\)/i);
  assert.match(accessSql, /subscription\.starts_at <= now\(\)/i);
  assert.match(accessSql, /subscription\.expires_at > now\(\)/i);

  assert.match(claimAnalysisSql, /if not public\.ai_futures_user_has_academy_access\(p_user_id\)/i);
  assert.match(analyzeSource, /const access = await verifyAcademyAccess\(supabase, user\.id\)/);
  assert.match(analyzeSource, /if \(!access\) throw new AiHttpError\(403, "academy_access_expired"/);
  assert.match(planSource, /ai_futures_user_has_academy_access[\s\S]*p_user_id:\s*user\.id/);
  assert.match(planSource, /if \(access !== true\) throw new AiHttpError\(403, "academy_access_required"/);
  assert.match(migration, /revoke execute on function public\.ai_futures_user_has_academy_access\(uuid\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.ai_futures_user_has_academy_access\(uuid\) to service_role/i);
});

test("RLS isolates user profiles and plans while system records remain admin-only", () => {
  const protectedTables = [
    "ai_futures_configs",
    "ai_futures_config_audit",
    "ai_risk_profiles",
    "ai_market_snapshots",
    "ai_market_setups",
    "ai_analysis_requests",
    "ai_rate_limit_buckets",
    "ai_user_trade_plans",
    "ai_setup_outcomes",
    "ai_setup_outcome_events",
    "ai_pipeline_runs",
    "ai_provider_events",
    "ai_model_usage_logs",
    "ai_setup_admin_notes"
  ];
  for (const table of protectedTables) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"));
  }

  for (const operation of ["select", "insert", "update", "delete"]) {
    const policy = sqlPolicy(`ai_risk_profiles_owner_${operation}`);
    assert.match(policy, /user_id = auth\.uid\(\)/i);
    assert.match(policy, /public\.has_premium_access\(\)/i);
  }
  assert.match(sqlPolicy("ai_analysis_requests_owner_or_admin_select"), /user_id = auth\.uid\(\)/i);
  assert.match(sqlPolicy("ai_user_trade_plans_owner_or_admin_select"), /user_id = auth\.uid\(\)/i);
  for (const policyName of [
    "ai_market_snapshots_admin_select",
    "ai_market_setups_admin_select",
    "ai_setup_outcomes_admin_select",
    "ai_provider_events_admin_select",
    "ai_model_usage_logs_admin_select"
  ]) {
    assert.match(sqlPolicy(policyName), /public\.is_admin\(\)/i);
  }
  assert.match(sqlPolicy("ai_setup_admin_notes_admin_insert"), /public\.is_admin\(\)[\s\S]*created_by = auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /grant\s+insert\s+on table public\.ai_market_(?:snapshots|setups)\s+to authenticated/i);
});

test("safe defaults and every public request are gated by current feature controls", () => {
  assert.match(migration, /false,\s*true,\s*false,\s*false,\s*false,\s*array\['BTCUSDT'\]/i);
  assert.match(claimAnalysisSql, /active_config\.emergency_kill_switch or not active_config\.feature_enabled/i);
  assert.match(claimAnalysisSql, /elsif active_config\.shadow_mode then/i);
  assert.match(claimAnalysisSql, /not active_config\.ai_calls_enabled and not active_config\.allow_deterministic_only/i);
  assert.match(pipelineSource, /if \(!config\.feature_enabled \|\| config\.emergency_kill_switch\)/);
  assert.match(pipelineSource, /shadowMode:\s*config\.shadow_mode/);
  assert.match(planSource, /\.from\("ai_futures_configs"\)/);
  assert.match(planSource, /!config\.feature_enabled \|\| config\.shadow_mode \|\| config\.emergency_kill_switch/);
  assert.match(analyzeSource, /const finalConfig = await loadLatestAiConfig\(supabase\)/);
  assert.match(analyzeSource, /finalConfig\.id !== config\.id \|\| !finalConfig\.feature_enabled \|\| finalConfig\.shadow_mode \|\| finalConfig\.emergency_kill_switch/);

  const configCheck = claimAnalysisSql.indexOf("select config.*");
  const replayCheck = claimAnalysisSql.indexOf("if existing_request.id is not null");
  assert.ok(configCheck >= 0 && replayCheck >= 0 && configCheck < replayCheck,
    "the latest kill/shadow/feature controls must be checked before an idempotent response is replayed");
});

test("rate limiting is serialized per user and cannot be bypassed with concurrent keys", () => {
  assert.match(migration, /unique \(user_id, idempotency_key\)/i);
  assert.match(claimAnalysisSql, /pg_advisory_xact_lock\(hashtextextended\('ai-futures-user:' \|\| p_user_id::text/i);
  assert.match(claimAnalysisSql, /per_user_min_refresh_seconds/i);
  assert.match(claimAnalysisSql, /status in \('accepted', 'processing', 'completed'\)/i);
  assert.match(claimAnalysisSql, /insert into public\.ai_rate_limit_buckets as bucket/i);
  assert.match(claimAnalysisSql, /on conflict \(user_id, bucket_started_at, bucket_seconds\) do update/i);
  assert.match(claimAnalysisSql, /where bucket\.request_count < active_config\.per_user_requests_per_minute/i);
  assert.match(claimAnalysisSql, /'rate_limited'[\s\S]*'analysis_rate_limited'/i);
  assert.match(analyzeSource, /status === "rate_limited" \? 429 : 503/);
});

test("snapshot and setup generation are deduplicated with expiring ownership leases", () => {
  assert.match(migration, /unique \(symbol, timeframe, timeframe_profile, candle_close_at, source, feature_version\)/i);
  assert.match(orchestratorSource, /if \(error\?\.code !== "23505"\)/);
  assert.match(orchestratorSource, /Concurrent market snapshot could not be loaded/);
  assert.match(migration, /unique \(snapshot_id, config_id, engine_version, prompt_version\)/i);
  assert.match(claimSetupSql, /pg_advisory_xact_lock/i);
  assert.match(claimSetupSql, /on conflict \(snapshot_id, config_id, engine_version, prompt_version\) do nothing/i);
  assert.match(claimSetupSql, /for update/i);
  assert.match(claimSetupSql, /generation_lease_expires_at[\s\S]*<= clock_timestamp\(\)/i);
  assert.match(claimSetupSql, /generation_attempts < active_config\.maximum_generation_attempts/i);
  assert.match(completeSetupSql, /setup\.generation_lease_token = p_lease_token/i);
  assert.match(completeSetupSql, /setup\.generation_lease_expires_at > clock_timestamp\(\)/i);
  assert.match(completeSetupSql, /setup\.config_id = control_config\.id/i);
  assert.match(completeSetupSql, /pg_advisory_xact_lock\(hashtextextended\('ai_futures_config_version', 0\)\)/i);
  assert.match(failSetupSql, /setup\.generation_lease_token = p_lease_token/i);
  assert.match(failSetupSql, /setup\.generation_lease_expires_at > clock_timestamp\(\)/i);
});

test("missing server secrets produce explicit unavailable errors and stay inside response handling", async () => {
  assert.match(httpSource, /Deno\.env\.get\("SUPABASE_URL"\)/);
  assert.match(httpSource, /Deno\.env\.get\("SERVICE_ROLE_KEY"\)/);
  assert.doesNotMatch(httpSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(httpSource, /missing_supabase_secrets/);
  assert.match(httpSource, /missing_cron_secret/);

  for (const endpoint of [pipelineSource, outcomesSource]) {
    const serveBody = endpoint.slice(endpoint.indexOf("Deno.serve"));
    assert.ok(serveBody.indexOf("try {") < serveBody.indexOf("getAiServiceClient()"),
      "service-client environment failures must be caught and returned as structured unavailable responses");
  }

  await assert.rejects(
    openAiModule.requestStructuredAiReview({ candidate: {}, features: {} }),
    (error) => error?.code === "missing_openai_key" && error?.status === 503
  );
});

test("the complete Edge dependency graph uses explicit Deno-compatible TypeScript extensions", () => {
  const modules = [
    httpSource,
    marketSource,
    openAiSource,
    orchestratorSource,
    analyzeSource,
    planSource,
    pipelineSource,
    outcomesSource,
    ...edgeDependencySources
  ];
  for (const moduleSource of modules) {
    for (const match of moduleSource.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      assert.match(match[1], /\.ts$/, `Edge import must include .ts: ${match[1]}`);
    }
  }
});

test("OpenAI uses server-side Responses Structured Outputs and validates the full schema", async () => {
  let capturedUrl = null;
  let capturedOptions = null;
  const review = validReview();
  const result = await openAiModule.requestStructuredAiReview({
    candidate: {},
    features: compactFeatureFixture(),
    apiKey: "server-test-key",
    model: "configured-model",
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return jsonResponse({
        id: "response-test",
        usage: { input_tokens: 12, output_tokens: 8 },
        output: [{ content: [{ type: "output_text", text: JSON.stringify(review) }] }]
      });
    }
  });

  assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
  assert.equal(capturedOptions.headers.Authorization, "Bearer server-test-key");
  const requestBody = JSON.parse(capturedOptions.body);
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.model, "configured-model");
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(requestBody.text.format.schema.additionalProperties, false);
  assert.deepEqual(new Set(requestBody.text.format.schema.required), new Set(Object.keys(review)));
  assert.deepEqual(result.review, review);
  assert.equal(result.inputTokens, 12);
  assert.equal(result.outputTokens, 8);

  assert.match(openAiSource, /const maximumAttempts = 2/);
  assert.match(openAiSource, /const controller = new AbortController\(\)/);
  assert.match(openAiSource, /setTimeout\(\(\) => controller\.abort\(\), requestTimeoutMs\)/);
  assert.match(openAiSource, /content\.type === "refusal"/);
});

test("invalid, refused, or numerically embellished AI output cannot become a signal", async () => {
  await assert.rejects(
    requestWithOutput("not-json"),
    (error) => error?.code === "invalid_ai_json"
  );
  await assert.rejects(
    requestWithOutput(JSON.stringify({ verdict: "APPROVE" })),
    (error) => error?.code === "invalid_ai_schema"
  );
  await assert.rejects(
    requestWithOutput(JSON.stringify({ ...validReview(), primary_thesis: "Claims 75 percent certainty" })),
    (error) => error?.code === "ai_introduced_numbers"
  );
  await assert.rejects(
    openAiModule.requestStructuredAiReview({
      candidate: {},
      features: compactFeatureFixture(),
      apiKey: "server-test-key",
      fetchImpl: async () => jsonResponse({ output: [{ content: [{ type: "refusal" }] }] })
    }),
    (error) => error?.code === "ai_refusal"
  );
  assert.match(orchestratorSource, /if \(!input\.config\.allow_deterministic_only\) throw error/);
  assert.match(orchestratorSource, /throw new AiReviewError\("ai_calls_disabled"/);
});

test("provider outages and malformed futures responses fail closed without spot or alternate-exchange fallback", async () => {
  let calls = 0;
  await assert.rejects(
    marketModule.fetchCurrentMarkPrice(async () => {
      calls += 1;
      throw new Error("offline");
    }),
    (error) => error?.code === "provider_unavailable" && error?.status === 502
  );
  assert.equal(calls, 2, "provider network errors use the bounded two-attempt policy");

  await assert.rejects(
    marketModule.fetchCurrentMarkPrice(async () => jsonResponse({})),
    (error) => error?.code === "malformed_premium"
  );
  assert.match(marketSource, /const binanceFuturesBaseUrl = "https:\/\/fapi\.binance\.com"/);
  assert.doesNotMatch(marketSource, /https:\/\/(?:api|www)\.binance\.com/);
  assert.doesNotMatch(marketSource, /coinbase|kraken|bybit|spot/i);
  assert.match(marketSource, /candles\.filter\(\(candle\) => candle\.closeTime < now\)/);
  assert.match(orchestratorSource, /timeoutMs:\s*config\.provider_timeout_ms/);
  assert.match(orchestratorSource, /retryCount:\s*config\.provider_retry_count/);
  assert.match(orchestratorSource, /liveMetrics:\s*config\.live_price_stale_after_seconds/);
  assert.match(orchestratorSource, /positioning:\s*config\.futures_metrics_stale_after_seconds/);
  assert.match(orchestratorSource, /const refreshedFeatures = refreshStoredFreshness\(/);
  assert.match(orchestratorSource, /return \{ \.\.\.features, sourceTimestamps, stale: staleReasons\.length > 0, staleReasons \}/);
  assert.match(orchestratorSource, /const currentMarket = await refreshCachedMarketView\(/);
  assert.match(orchestratorSource, /const mark = await fetchCurrentMarkPrice\(fetch,/);
  assert.match(orchestratorSource, /currentPrice:\s*mark\.price/);
  assert.match(orchestratorSource, /candidate:\s*existing\.deterministic_candidate/);
  assert.match(orchestratorSource, /if \(features\.stale\) throw new AiHttpError\(503, "stale_market_data"/);
  assert.match(orchestratorSource, /\.from\("ai_provider_events"\)\.insert/);
  assert.match(analyzeSource, /setupOutcomeStatus:\s*outcome\?\.status \?\? null/);
  assert.match(analyzeSource, /final\.plan && \(final\.status === "LONG_SETUP" \|\| final\.status === "SHORT_SETUP"\)/);
  assert.match(planSource, /\.from\("ai_setup_outcomes"\)/);
  assert.match(planSource, /outcome\.status !== "awaiting_entry"/);
  assert.match(planSource, /fetchCurrentMarkPrice\(fetch,/);
  assert.match(planSource, /liveMark\.price < setupLevels\.entryLow \|\| liveMark\.price > setupLevels\.entryHigh/);
  assert.match(analyzeSource, /source:\s*common\.snapshot\.source/);
  assert.match(analyzeSource, /marketDataTransport:\s*common\.snapshot\.marketDataTransport/);
  assert.doesNotMatch(analyzeSource, /source:\s*"Binance USD-M Futures"/);
  assert.match(planSource, /priceValidation:[\s\S]*source:\s*liveMark\.source[\s\S]*transport:\s*liveMark\.transport/);
});

test("the direct Binance transport never calls CoinGlass when Binance succeeds", async () => {
  const calls = [];
  const mark = await marketModule.fetchCurrentMarkPrice(async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith("https://fapi.binance.com/fapi/v1/premiumIndex")) {
      return jsonResponse(binancePremiumFixture());
    }
    throw new Error(`Unexpected provider URL: ${url}`);
  }, {
    transport: "auto",
    coinglassApiKey: "coinglass-server-key",
    retryCount: 0
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/fapi\.binance\.com\//);
  assert.equal(mark.price, 63_842);
  assert.equal(mark.indexPrice, 63_840);
  assert.equal(mark.source, "Binance USD-M Futures");
  assert.equal(mark.transport, "binance_direct");
});

test("auto transport falls back to CoinGlass only for Binance HTTP 451", async () => {
  const calls = [];
  const mark = await marketModule.fetchCurrentMarkPrice(async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith("https://fapi.binance.com/")) return jsonResponse({}, 451);
    if (String(url).includes("/api/futures/pairs-markets")) return jsonResponse(coinglassMarketsFixture());
    throw new Error(`Unexpected provider URL: ${url}`);
  }, {
    transport: "auto",
    coinglassApiKey: "coinglass-server-key",
    retryCount: 0
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:\/\/fapi\.binance\.com\//);
  assert.match(calls[1].url, /^https:\/\/open-api-v4\.coinglass\.com\/api\/futures\/pairs-markets\?/);
  assert.equal(mark.price, 63_842);
  assert.equal(mark.indexPrice, 63_840);
  assert.equal(mark.source, "CoinGlass API · Binance USD-M Futures");
  assert.equal(mark.transport, "coinglass");
  assert.equal(mark.priceKind, "current_futures_price");
});

test("auto transport does not mask Binance 403, rate limits, outages, network errors, or malformed data", async (t) => {
  for (const status of [403, 429, 500]) {
    await t.test(`HTTP ${status}`, async () => {
      const calls = [];
      await assert.rejects(
        marketModule.fetchCurrentMarkPrice(async (url) => {
          calls.push(String(url));
          return jsonResponse({}, status);
        }, {
          transport: "auto",
          coinglassApiKey: "coinglass-server-key",
          retryCount: 0
        }),
        (error) => error?.code === "provider_http_error"
      );
      assert.equal(calls.length, 1);
      assert.ok(calls.every((url) => url.startsWith("https://fapi.binance.com/")));
    });
  }

  await t.test("network failure", async () => {
    const calls = [];
    await assert.rejects(
      marketModule.fetchCurrentMarkPrice(async (url) => {
        calls.push(String(url));
        throw new Error("offline");
      }, {
        transport: "auto",
        coinglassApiKey: "coinglass-server-key",
        retryCount: 0
      }),
      (error) => error?.code === "provider_unavailable"
    );
    assert.equal(calls.length, 1);
    assert.ok(calls.every((url) => url.startsWith("https://fapi.binance.com/")));
  });

  await t.test("malformed premium payload", async () => {
    const calls = [];
    await assert.rejects(
      marketModule.fetchCurrentMarkPrice(async (url) => {
        calls.push(String(url));
        return jsonResponse({});
      }, {
        transport: "auto",
        coinglassApiKey: "coinglass-server-key",
        retryCount: 0
      }),
      (error) => error?.code === "malformed_premium"
    );
    assert.equal(calls.length, 1);
    assert.ok(calls.every((url) => url.startsWith("https://fapi.binance.com/")));
  });
});

test("CoinGlass transport is explicit, server-authenticated, and pinned to Binance BTCUSDT", async () => {
  const calls = [];
  const mark = await marketModule.fetchCurrentMarkPrice(async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse(coinglassMarketsFixture());
  }, {
    transport: "coinglass",
    coinglassApiKey: "coinglass-server-key",
    retryCount: 0
  });

  assert.equal(calls.length, 1, "explicit CoinGlass mode must skip the restricted direct Binance request");
  const request = calls[0];
  const requestUrl = new URL(request.url);
  assert.equal(requestUrl.origin, "https://open-api-v4.coinglass.com");
  assert.equal(requestUrl.pathname, "/api/futures/pairs-markets");
  assert.equal(requestUrl.searchParams.get("symbol"), "BTC");
  assert.equal(requestUrl.searchParams.has("apiKey"), false);
  assert.equal(requestUrl.searchParams.has("api_key"), false);
  assert.equal(new Headers(request.options?.headers).get("CG-API-KEY"), "coinglass-server-key");
  assert.equal(mark.source, "CoinGlass API · Binance USD-M Futures");
  assert.equal(mark.transport, "coinglass");
  assert.doesNotMatch(request.url, /coinbase|kraken|bybit|spot/i);
});

test("CoinGlass transport fails explicitly without a key and makes no provider request", async () => {
  let calls = 0;
  await assert.rejects(
    marketModule.fetchCurrentMarkPrice(async () => {
      calls += 1;
      throw new Error("must not be called");
    }, {
      transport: "coinglass",
      coinglassApiKey: "",
      retryCount: 0
    }),
    (error) => error?.code === "missing_coinglass_key" && error?.status === 503
  );
  assert.equal(calls, 0);
});

test("a CoinGlass snapshot stays complete and explicitly attributes Binance BTCUSDT transport", async () => {
  const now = Date.parse("2026-07-12T12:00:00.000Z");
  const calls = [];
  const snapshot = await marketModule.fetchAiFuturesMarketSnapshot({
    now,
    transport: "coinglass",
    coinglassApiKey: "coinglass-server-key",
    retryCount: 0,
    fetchImpl: async (url, options) => {
      const requestUrl = new URL(String(url));
      calls.push({ url: requestUrl, options });
      if (requestUrl.origin === "https://api.alternative.me") {
        return jsonResponse({
          data: [{ value: "48", value_classification: "Neutral", timestamp: String(now / 1000) }]
        });
      }
      assert.equal(requestUrl.origin, "https://open-api-v4.coinglass.com");
      switch (requestUrl.pathname) {
        case "/api/futures/price/history": {
          assert.equal(requestUrl.searchParams.get("exchange"), "Binance");
          assert.equal(requestUrl.searchParams.get("symbol"), "BTCUSDT");
          const interval = requestUrl.searchParams.get("interval");
          const intervalMs = interval === "15m" ? 900_000 : interval === "1h" ? 3_600_000 : 14_400_000;
          return jsonResponse(coinglassEnvelope(coinglassCandleHistory(now, intervalMs)));
        }
        case "/api/futures/pairs-markets":
          assert.equal(requestUrl.searchParams.get("symbol"), "BTC");
          return jsonResponse(coinglassMarketsFixture());
        case "/api/futures/open-interest/history":
          return jsonResponse(coinglassEnvelope([
            { time: now - 900_000, open: 600_000, high: 605_000, low: 599_000, close: 602_000 },
            { time: now - 1, open: 602_000, high: 611_000, low: 601_000, close: 610_000 }
          ]));
        case "/api/futures/global-long-short-account-ratio/history":
          return jsonResponse(coinglassEnvelope([
            { time: now - 900_000, global_account_long_short_ratio: 1.02 },
            { time: now - 1, global_account_long_short_ratio: 1.04 }
          ]));
        case "/api/futures/top-long-short-position-ratio/history":
          return jsonResponse(coinglassEnvelope([
            { time: now - 900_000, top_position_long_short_ratio: 1.1 },
            { time: now - 1, top_position_long_short_ratio: 1.12 }
          ]));
        case "/api/futures/v2/taker-buy-sell-volume/history":
          return jsonResponse(coinglassEnvelope([
            { time: now - 900_000, taker_buy_volume_usd: 2_000_000, taker_sell_volume_usd: 1_900_000 },
            { time: now - 1, taker_buy_volume_usd: 2_100_000, taker_sell_volume_usd: 2_000_000 }
          ]));
        case "/api/futures/supported-exchange-pairs":
          assert.equal(requestUrl.searchParams.get("exchange"), "Binance");
          return jsonResponse(coinglassEnvelope({
            Binance: [{ exchange_name: "Binance", instrument_id: "BTCUSDT", price_tick_size: "0.1", max_leverage: 125 }]
          }));
        default:
          throw new Error(`Unexpected provider URL: ${requestUrl}`);
      }
    }
  });

  assert.equal(snapshot.symbol, "BTCUSDT");
  assert.equal(snapshot.source, "CoinGlass API · Binance USD-M Futures");
  assert.equal(snapshot.marketDataTransport, "coinglass");
  assert.equal(snapshot.futures.priceKind, "current_futures_price");
  assert.equal(snapshot.futures.markPrice, 63_842);
  assert.equal(snapshot.futures.indexPrice, 63_840);
  assert.equal(snapshot.candles["15m"].length, 260);
  assert.equal(snapshot.candles["1h"].length, 260);
  assert.equal(snapshot.candles["4h"].length, 260);
  assert.ok(snapshot.sourceTimestamps
    .filter((timestamp) => timestamp.category !== "fear_greed")
    .every((timestamp) => timestamp.source === "CoinGlass API · Binance USD-M Futures"));
  assert.ok(calls.every(({ url }) => !url.href.startsWith("https://fapi.binance.com/")));
  for (const { url, options } of calls.filter(({ url }) => url.origin === "https://open-api-v4.coinglass.com")) {
    assert.equal(url.searchParams.has("apiKey"), false);
    assert.equal(url.searchParams.has("api_key"), false);
    assert.equal(new Headers(options?.headers).get("CG-API-KEY"), "coinglass-server-key");
  }
});

test("CoinGlass rejects unsuccessful envelopes and responses without the exact Binance BTCUSDT pair", async (t) => {
  await t.test("non-success envelope", async () => {
    await assert.rejects(
      marketModule.fetchCurrentMarkPrice(
        async () => jsonResponse({ code: "40001", msg: "API key invalid", data: [] }),
        { transport: "coinglass", coinglassApiKey: "coinglass-server-key", retryCount: 0 }
      ),
      (error) => typeof error?.code === "string" && error.code.includes("coinglass")
    );
  });

  for (const [label, data] of [
    ["wrong exchange", [{ ...coinglassMarketRow(), exchange_name: "Bybit" }]],
    ["wrong instrument", [{ ...coinglassMarketRow(), instrument_id: "ETHUSDT" }]],
    ["aggregate-only payload", [{ symbol: "BTC", current_price: 63_842, index_price: 63_840 }]]
  ]) {
    await t.test(label, async () => {
      await assert.rejects(
        marketModule.fetchCurrentMarkPrice(
          async () => jsonResponse({ code: "0", msg: "success", data }),
          { transport: "coinglass", coinglassApiKey: "coinglass-server-key", retryCount: 0 }
        ),
        (error) => typeof error?.code === "string" && error.code.includes("coinglass")
      );
    });
  }
});

test("outcome reconciliation paginates closed futures candles with bounded retry and atomic leases", () => {
  assert.match(outcomesSource, /const maximumCandlePagesPerSetup = 5/);
  assert.match(outcomesSource, /const maximumProviderAttempts = 2/);
  assert.match(outcomesSource, /for \(let page = 0; page < maximumCandlePagesPerSetup && cursor < endMs; page \+= 1\)/);
  assert.match(outcomesSource, /candle\.closeTime < endMs/);
  assert.match(outcomesSource, /candle\.openTime >= cursor/);
  assert.match(outcomesSource, /const nextCursor = pageCandles\[pageCandles\.length - 1\]\.closeTime \+ 1/);
  assert.match(outcomesSource, /if \(nextCursor <= cursor\)[\s\S]{0,240}"outcome_provider_cursor"/);
  assert.match(outcomesSource, /const controller = new AbortController\(\)/);
  assert.match(outcomesSource, /response\.status === 429 \|\| response\.status >= 500/);
  assert.match(outcomesSource, /claim_ai_setup_outcomes_for_reconciliation/);
  assert.match(outcomesSource, /save_ai_setup_outcome_reconciliation/);
  assert.match(migration, /for update of outcome skip locked/i);
  assert.match(migration, /processing_lease_token is distinct from p_lease_token/i);
  assert.match(migration, /on conflict \(setup_id, event_key\) do nothing/i);
  assert.match(saveOutcomeSql, /select outcome\.\*[\s\S]*into current_outcome[\s\S]*for update/i);
  assert.doesNotMatch(saveOutcomeSql, /into\s+current_outcome\s*,/i);
});

test("cron endpoints use a separate constant-time secret and Vault stores no service-role credential", () => {
  assert.match(httpSource, /Deno\.env\.get\("AI_CRON_SECRET"\)/);
  assert.match(httpSource, /request\.headers\.get\("x-ai-cron-secret"\)/);
  assert.match(httpSource, /constantTimeEqual\(received, expected\)/);
  for (const endpoint of [pipelineSource, outcomesSource]) assert.match(endpoint, /requireAiCron\(request\)/);

  const scheduler = migration.slice(migration.indexOf("-- Safe scheduler bootstrap"));
  for (const secretName of [
    "ai_futures_market_pipeline_url",
    "ai_futures_outcome_reconcile_url",
    "ai_futures_cron_secret"
  ]) assert.match(scheduler, new RegExp(secretName, "g"));
  assert.match(scheduler, /from vault\.decrypted_secrets/i);
  assert.match(scheduler, /'x-ai-cron-secret'/i);
  const scheduledCommands = [
    scheduler.slice(scheduler.indexOf("market_job text"), scheduler.indexOf("outcome_job text")),
    scheduler.slice(scheduler.indexOf("outcome_job text"), scheduler.indexOf("begin\n"))
  ].join("\n");
  assert.doesNotMatch(scheduledCommands, /SERVICE_ROLE_KEY|authorization|bearer/i);
  assert.match(migration, /execute 'create extension if not exists pg_cron'/i);
  assert.match(migration, /execute 'create extension if not exists pg_net'/i);
  assert.match(scheduler, /to_regprocedure\('net\.http_post\(text,jsonb,jsonb,jsonb,integer\)'\)/i);
});

test("AI secrets and provider calls never enter the Vite client bundle", async () => {
  const clientSource = await readClientTree(new URL("../src", import.meta.url));
  const aiClientSource = [
    clientApiSource,
    await source("../src/pages/AiFuturesAnalyst.tsx"),
    await source("../src/pages/AdminAiFuturesAnalyst.tsx")
  ].join("\n");
  assert.doesNotMatch(clientSource, /SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|COINGLASS_API_KEY|AI_CRON_SECRET/);
  assert.doesNotMatch(aiClientSource, /api\.openai\.com|fapi\.binance\.com|open-api-v4\.coinglass\.com|api\.alternative\.me/);
  assert.doesNotMatch(clientSource, /\bsk-[A-Za-z0-9_-]{16,}/);
  assert.match(clientApiSource, /supabase\.functions\.invoke\("ai-futures-analyze"/);
  assert.match(clientApiSource, /supabase\.functions\.invoke\("ai-futures-plan"/);
  assert.doesNotMatch(openAiSource, /VITE_/);
  assert.doesNotMatch(httpSource, /VITE_/);
  const providerSettingsSql = sqlFunction("ai_futures_validate_provider_settings");
  assert.match(providerSettingsSql, /select count\(\*\) into key_count from jsonb_object_keys\(value\)/i);
  assert.match(providerSettingsSql, /key_count <> 2/i);
  assert.match(providerSettingsSql, /jsonb_typeof\(value -> 'market_data'\) <> 'string'/i);
  assert.match(providerSettingsSql, /lower\(key_item\) ~ '\(secret\|token\|password\|credential\|api\.\?key\|private\.\?key\)'/i);
});

function validReview() {
  return {
    verdict: "APPROVE",
    market_summary: "Momentum and structure are aligned without certainty.",
    primary_thesis: "The deterministic candidate has coherent confluence.",
    supporting_factors: ["Trend and structure support the thesis."],
    conflicting_factors: ["Crowding can still weaken follow through."],
    invalidation_explanation: "The stored structural invalidation remains decisive.",
    risk_notes: ["Futures exposure can cause rapid loss."],
    educational_explanation: "Review the deterministic levels before any practice order."
  };
}

function compactFeatureFixture() {
  return {
    candleCloseAt: "2026-07-12T12:00:00.000Z",
    multiTimeframeTrend: "bullish",
    trendAlignmentScore: 1,
    regime: "trending",
    currentDistanceFromEma20Atr: 0.2,
    fundingInterpretation: "neutral",
    positioningCrowding: "balanced",
    openInterestDirection: "rising",
    takerFlow: "buyers",
    timeframes: {}
  };
}

function binancePremiumFixture(overrides = {}) {
  return {
    symbol: "BTCUSDT",
    markPrice: "63842.0",
    indexPrice: "63840.0",
    lastFundingRate: "0.00002007",
    nextFundingTime: 1_784_000_000_000,
    time: 1_783_840_000_000,
    ...overrides
  };
}

function coinglassMarketRow(overrides = {}) {
  return {
    exchange_name: "Binance",
    instrument_id: "BTCUSDT",
    current_price: 63_842,
    index_price: 63_840,
    funding_rate: 0.002007,
    next_funding_time: 1_784_000_000_000,
    open_interest_quantity: 612_345.25,
    open_interest_usd: 39_087_000_000,
    open_interest_change_percent_24h: 1.25,
    long_volume_usd: 2_000_000,
    short_volume_usd: 1_800_000,
    ...overrides
  };
}

function coinglassMarketsFixture(rows = [coinglassMarketRow()]) {
  return { code: "0", msg: "success", data: rows };
}

function coinglassEnvelope(data) {
  return { code: "0", msg: "success", data };
}

function coinglassCandleHistory(now, intervalMs, count = 260) {
  const firstOpenTime = now - (count * intervalMs);
  return Array.from({ length: count }, (_, index) => {
    const open = 60_000 + index;
    return {
      time: firstOpenTime + (index * intervalMs),
      open,
      high: open + 25,
      low: open - 20,
      close: open + 5,
      volume_usd: 1_000_000 + index
    };
  });
}

function requestWithOutput(text) {
  return openAiModule.requestStructuredAiReview({
    candidate: {},
    features: compactFeatureFixture(),
    apiKey: "server-test-key",
    fetchImpl: async () => jsonResponse({ output: [{ content: [{ type: "output_text", text }] }] })
  });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

function sqlFunction(name) {
  const start = migration.search(new RegExp(`create or replace function public\\.${name}\\b`, "i"));
  assert.notEqual(start, -1, `missing SQL function ${name}`);
  const end = migration.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated SQL function ${name}`);
  return migration.slice(start, end + 4);
}

function sqlPolicy(name) {
  const start = migration.search(new RegExp(`create policy ["']${name}["']`, "i"));
  assert.notEqual(start, -1, `missing RLS policy ${name}`);
  const end = migration.indexOf(";", start);
  return migration.slice(start, end + 1);
}

async function importTranspiled(sourceText, importPattern, replacement) {
  const output = ts.transpileModule(sourceText, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
  }).outputText.replace(importPattern, replacement);
  assert.doesNotMatch(output, /^import\s/m, "test transpilation must be self-contained");
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

async function readClientTree(rootUrl) {
  const root = rootUrl.pathname;
  const chunks = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if ([".ts", ".tsx", ".js", ".jsx", ".html"].includes(extname(entry.name))) {
        chunks.push(await readFile(path, "utf8"));
      }
    }
  }
  await walk(root);
  return chunks.join("\n");
}
