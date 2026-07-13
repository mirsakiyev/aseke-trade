import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  AI_FUTURES_ENGINE_VERSION,
  AI_FUTURES_FEATURE_VERSION,
  AI_FUTURES_PROMPT_VERSION
} from "../../../src/lib/aiFuturesConfig.ts";
import { calculateMarketFeatures } from "../../../src/lib/aiFuturesFeatures.ts";
import { buildAiFuturesCandidate } from "../../../src/lib/aiFuturesSetup.ts";
import type {
  AiCandidateSetup,
  AiMarketFeatures,
  AiNormalizedMarketSnapshot,
  AiScoreWeights,
  AiStructuredReview
} from "../../../src/lib/aiFuturesTypes.ts";
import { fetchAiFuturesMarketSnapshot, fetchCurrentMarkPrice } from "./ai-futures-market.ts";
import { AiReviewError, requestStructuredAiReview, type AiReviewResult } from "./ai-futures-openai.ts";
import { AiHttpError } from "./ai-futures-http.ts";

export interface AiFuturesConfigRow {
  id: string;
  version: number;
  feature_enabled: boolean;
  shadow_mode: boolean;
  ai_calls_enabled: boolean;
  allow_deterministic_only: boolean;
  emergency_kill_switch: boolean;
  configured_symbols: string[];
  score_weights: Record<string, number>;
  minimum_setup_score: number;
  minimum_score_difference: number;
  minimum_reward_risk: number;
  maximum_custom_risk_percent: number;
  maximum_leverage: number;
  maximum_margin_percent: number;
  candle_stale_after_seconds: number;
  live_price_stale_after_seconds: number;
  futures_metrics_stale_after_seconds: number;
  sentiment_stale_after_seconds: number;
  provider_timeout_ms: number;
  provider_retry_count: number;
  generation_lease_seconds: number;
  feature_version: string;
  engine_version: string;
  prompt_version: string;
  model_name: string;
}

export interface CommonAiAnalysis {
  snapshotId: string;
  setupId: string;
  snapshot: AiNormalizedMarketSnapshot;
  features: AiMarketFeatures;
  candidate: AiCandidateSetup;
  review: AiStructuredReview | null;
  verdict: AiCandidateSetup["status"];
  aiReviewMetadata: AiReviewResult | null;
  config: AiFuturesConfigRow;
}

interface SnapshotRow {
  id: string;
  normalized_market_data: AiNormalizedMarketSnapshot;
  calculated_features: AiMarketFeatures;
}

interface SetupRow {
  id: string;
  generation_status: "generating" | "ready" | "failed";
  verdict: AiCandidateSetup["status"] | null;
  deterministic_candidate: AiCandidateSetup;
  ai_structured_output: AiStructuredReview | null;
  failure_code: string | null;
}

export async function loadLatestAiConfig(supabase: SupabaseClient, configId?: string): Promise<AiFuturesConfigRow> {
  let query = supabase.from("ai_futures_configs").select("*");
  query = configId ? query.eq("id", configId) : query.order("version", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new AiHttpError(503, "ai_config_unavailable", "AI Futures configuration is unavailable.");
  return data as AiFuturesConfigRow;
}

export async function getOrCreateCommonAiAnalysis(
  supabase: SupabaseClient,
  input: { config: AiFuturesConfigRow; workerId: string; now?: number }
): Promise<CommonAiAnalysis> {
  const now = input.now ?? Date.now();
  if (input.config.emergency_kill_switch) throw new AiHttpError(503, "emergency_kill_switch", "AI Futures Analyst is temporarily unavailable.");
  if (!input.config.feature_enabled) throw new AiHttpError(503, "feature_disabled", "AI Futures Analyst is currently disabled.");
  if (!input.config.configured_symbols.includes("BTCUSDT")) throw new AiHttpError(503, "symbol_disabled", "BTCUSDT analysis is disabled.");

  const { row: snapshotRow, snapshot, features } = await getOrCreateSnapshot(supabase, input.config, now);
  const claim = await claimSetup(supabase, snapshotRow.id, input.config, input.workerId);
  if (!claim.claimed) {
    const existing = await loadSetup(supabase, claim.setup_id);
    if (existing.generation_status === "ready") {
      const currentMarket = await refreshCachedMarketView(supabase, snapshot, features, input.config, now);
      const verdict = readStoredVerdict(existing.verdict);
      return {
        snapshotId: snapshotRow.id,
        setupId: existing.id,
        snapshot: currentMarket.snapshot,
        features: currentMarket.features,
        candidate: existing.deterministic_candidate,
        review: existing.ai_structured_output,
        verdict,
        aiReviewMetadata: null,
        config: input.config
      };
    }
    if (existing.generation_status === "generating") {
      throw new AiHttpError(409, "analysis_in_progress", "This closed-candle analysis is already being generated. Retry shortly.");
    }
    throw new AiHttpError(503, existing.failure_code ?? "analysis_generation_failed", "The shared market setup could not be generated.");
  }

  const setupId = String(claim.setup_id);
  const leaseToken = String(claim.lease_token);
  let candidate: AiCandidateSetup;
  let review: AiStructuredReview | null = null;
  let aiReviewMetadata: AiReviewResult | null = null;
  try {
    if (features.stale) throw new AiHttpError(503, "stale_market_data", features.staleReasons.join(" "));
    candidate = buildAiFuturesCandidate(snapshot, features, now, {
      scoreWeights: normalizeScoreWeights(input.config.score_weights),
      minimumQualityScore: input.config.minimum_setup_score,
      minimumScoreDifference: input.config.minimum_score_difference,
      minimumRewardRisk: input.config.minimum_reward_risk,
      engineVersion: input.config.engine_version
    });
    const isReviewEligible = ["LONG_SETUP", "SHORT_SETUP", "WAIT_FOR_ENTRY"].includes(candidate.status);
    if (isReviewEligible && input.config.ai_calls_enabled) {
      try {
        aiReviewMetadata = await requestStructuredAiReview({
          candidate,
          features,
          model: input.config.model_name,
          promptVersion: input.config.prompt_version
        });
        review = aiReviewMetadata.review;
        await logAiUsage(supabase, setupId, aiReviewMetadata, "success", null);
      } catch (error) {
        await logAiFailure(supabase, setupId, input.config, error);
        if (!input.config.allow_deterministic_only) throw error;
      }
    } else if (isReviewEligible && !input.config.allow_deterministic_only) {
      throw new AiReviewError("ai_calls_disabled", "AI review is disabled and deterministic-only results are not allowed.", 503);
    }

    const storedVerdict = resolveStoredVerdict(candidate, review);
    const { error: completeError } = await supabase.rpc("complete_ai_futures_setup_generation", {
      p_setup_id: setupId,
      p_lease_token: leaseToken,
      p_verdict: storedVerdict,
      p_direction: candidate.direction,
      p_entry_zone_low: candidate.entryZone?.low ?? null,
      p_entry_zone_high: candidate.entryZone?.high ?? null,
      p_stop_loss: candidate.stopLoss,
      p_take_profits: candidate.takeProfits.map((target) => ({
        label: target.label,
        price: target.price,
        allocation_percent: target.positionSizePercent,
        r_multiple: target.rMultiple
      })),
      p_invalidation_level: candidate.invalidationLevel,
      p_setup_quality_score: candidate.qualityScore,
      p_score_components: candidate.scoreBreakdown,
      p_reward_risk_ratio: candidate.projectedRewardRisk,
      p_market_regime: candidate.marketRegime,
      p_deterministic_candidate: candidate,
      p_ai_structured_output: review,
      p_setup_expires_at: candidate.expiresAt
    });
    if (completeError) throw new AiHttpError(500, "setup_save_failed", "Generated setup could not be saved.");
  } catch (error) {
    await supabase.rpc("fail_ai_futures_setup_generation", {
      p_setup_id: setupId,
      p_lease_token: leaseToken,
      p_failure_code: readErrorCode(error),
      p_failure_detail: error instanceof Error ? error.message.slice(0, 900) : "Setup generation failed."
    });
    throw error;
  }

  const currentMarket = await refreshCachedMarketView(supabase, snapshot, features, input.config, Date.now());
  return {
    snapshotId: snapshotRow.id,
    setupId,
    snapshot: currentMarket.snapshot,
    features: currentMarket.features,
    candidate,
    review,
    verdict: resolveStoredVerdict(candidate, review),
    aiReviewMetadata,
    config: input.config
  };
}

async function getOrCreateSnapshot(supabase: SupabaseClient, config: AiFuturesConfigRow, now: number) {
  const expectedClose = new Date(Math.floor(now / 900_000) * 900_000 - 1).toISOString();
  const { data: existing } = await supabase
    .from("ai_market_snapshots")
    .select("id,normalized_market_data,calculated_features")
    .eq("symbol", "BTCUSDT")
    .eq("timeframe", "15m")
    .eq("candle_close_at", expectedClose)
    .eq("feature_version", config.feature_version)
    .maybeSingle();
  if (existing) {
    const row = existing as SnapshotRow;
    const refreshedFeatures = refreshStoredFreshness(row.calculated_features, row.normalized_market_data, config, now);
    return { row, snapshot: { ...row.normalized_market_data, sourceTimestamps: refreshedFeatures.sourceTimestamps }, features: refreshedFeatures };
  }

  let snapshot: AiNormalizedMarketSnapshot;
  try {
    snapshot = await fetchAiFuturesMarketSnapshot({
      now,
      timeoutMs: config.provider_timeout_ms,
      retryCount: config.provider_retry_count,
      maximumLeverage: config.maximum_leverage,
      staleAfterSeconds: {
        candles15m: config.candle_stale_after_seconds,
        candles1h: config.candle_stale_after_seconds * 4,
        candles4h: config.candle_stale_after_seconds * 16,
        liveMetrics: config.live_price_stale_after_seconds,
        positioning: config.futures_metrics_stale_after_seconds,
        sentiment: config.sentiment_stale_after_seconds
      }
    });
  } catch (error) {
    await logProviderFailure(supabase, error);
    throw error;
  }
  await logProviderSuccess(supabase, snapshot);
  const features = calculateMarketFeatures(snapshot, now);
  if (features.stale) throw new AiHttpError(503, "stale_market_data", features.staleReasons.join(" "));
  const payloadHash = await sha256Hex(JSON.stringify(snapshot));
  const rowPayload = {
    symbol: "BTCUSDT",
    timeframe: "15m",
    timeframe_profile: "intraday_15m_1h_4h",
    candle_close_at: snapshot.candleCloseAt,
    source: "binance_usdm",
    data_status: "ready",
    market_data_as_of: snapshot.capturedAt,
    normalized_market_data: snapshot,
    calculated_features: features,
    futures_metrics: snapshot.futures,
    sentiment_metrics: snapshot.sentiment,
    exchange_filters: snapshot.filters,
    source_timestamps: snapshot.sourceTimestamps,
    feature_version: config.feature_version || AI_FUTURES_FEATURE_VERSION,
    payload_hash: payloadHash
  };
  const { data: inserted, error } = await supabase
    .from("ai_market_snapshots")
    .insert(rowPayload)
    .select("id,normalized_market_data,calculated_features")
    .maybeSingle();
  if (!error && inserted) {
    return { row: inserted as SnapshotRow, snapshot, features };
  }
  if (error?.code !== "23505") throw new AiHttpError(500, "snapshot_save_failed", "Market snapshot could not be saved.");
  const { data: concurrent, error: concurrentError } = await supabase
    .from("ai_market_snapshots")
    .select("id,normalized_market_data,calculated_features")
    .eq("symbol", "BTCUSDT")
    .eq("timeframe", "15m")
    .eq("candle_close_at", snapshot.candleCloseAt)
    .eq("feature_version", config.feature_version)
    .single();
  if (concurrentError || !concurrent) throw new AiHttpError(500, "snapshot_race_failed", "Concurrent market snapshot could not be loaded.");
  const row = concurrent as SnapshotRow;
  return { row, snapshot: row.normalized_market_data, features: row.calculated_features };
}

async function claimSetup(supabase: SupabaseClient, snapshotId: string, config: AiFuturesConfigRow, workerId: string) {
  const { data, error } = await supabase.rpc("claim_ai_futures_setup_generation", {
    p_snapshot_id: snapshotId,
    p_config_id: config.id,
    p_engine_version: config.engine_version || AI_FUTURES_ENGINE_VERSION,
    p_prompt_version: config.prompt_version || AI_FUTURES_PROMPT_VERSION,
    p_model_name: config.model_name,
    p_worker_id: workerId,
    p_lease_seconds: config.generation_lease_seconds
  });
  if (error) throw new AiHttpError(500, "generation_claim_failed", "Setup generation lock could not be acquired.");
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new AiHttpError(500, "generation_claim_empty", "Setup generation lock returned no result.");
  return result as Record<string, unknown> & { setup_id: string; claimed: boolean; lease_token: string | null };
}

async function loadSetup(supabase: SupabaseClient, setupId: unknown): Promise<SetupRow> {
  const { data, error } = await supabase
    .from("ai_market_setups")
    .select("id,generation_status,verdict,deterministic_candidate,ai_structured_output,failure_code")
    .eq("id", String(setupId))
    .single();
  if (error || !data) throw new AiHttpError(500, "setup_lookup_failed", "Shared setup could not be loaded.");
  return data as SetupRow;
}

function resolveStoredVerdict(candidate: AiCandidateSetup, review: AiStructuredReview | null): AiCandidateSetup["status"] {
  if (!review) return candidate.status;
  if (review.verdict === "REJECT") return "NO_TRADE";
  if (review.verdict === "DOWNGRADE_TO_WAIT") return "WAIT_FOR_ENTRY";
  return candidate.status;
}

function readStoredVerdict(value: unknown): AiCandidateSetup["status"] {
  if (["NO_TRADE", "WAIT_FOR_ENTRY", "LONG_SETUP", "SHORT_SETUP"].includes(String(value))) {
    return String(value) as AiCandidateSetup["status"];
  }
  throw new AiHttpError(503, "invalid_stored_verdict", "The stored AI setup verdict is invalid.");
}

async function logAiUsage(
  supabase: SupabaseClient,
  setupId: string,
  result: AiReviewResult,
  status: string,
  errorCode: string | null
) {
  await supabase.from("ai_model_usage_logs").insert({
    setup_id: setupId,
    provider_request_id: result.responseId,
    model_name: result.model,
    prompt_version: result.promptVersion,
    status,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    total_tokens: result.inputTokens + result.outputTokens,
    latency_ms: result.latencyMs,
    error_code: errorCode
  });
}

async function logAiFailure(supabase: SupabaseClient, setupId: string, config: AiFuturesConfigRow, error: unknown) {
  const code = readErrorCode(error);
  const status = code.includes("timeout") ? "timeout" : code.includes("refusal") ? "refusal" : code.includes("schema") || code.includes("json") ? "invalid_schema" : "error";
  await supabase.from("ai_model_usage_logs").insert({
    setup_id: setupId,
    model_name: config.model_name,
    prompt_version: config.prompt_version,
    status,
    error_code: code
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code.slice(0, 100);
  return "setup_generation_failed";
}

function normalizeScoreWeights(value: Record<string, number>): AiScoreWeights {
  return {
    multiTimeframeTrend: Number(value.multi_timeframe_trend),
    marketStructure: Number(value.market_structure),
    momentum: Number(value.momentum),
    volumeVolatility: Number(value.volume_volatility),
    futuresPositioning: Number(value.futures_positioning),
    sentiment: Number(value.sentiment),
    entryQuality: Number(value.entry_reward_risk)
  };
}

async function logProviderSuccess(supabase: SupabaseClient, snapshot: AiNormalizedMarketSnapshot) {
  await supabase.from("ai_provider_events").insert(snapshot.sourceTimestamps.map((item) => ({
    provider: item.source === "Alternative.me" ? "alternative_me" : item.source.includes("CoinGlass") ? "coinglass" : "binance_usdm",
    data_category: item.category,
    status: item.stale ? "stale" : "success",
    source_timestamp: item.sourceAt,
    retry_count: 0,
    metadata: {
      age_seconds: item.ageSeconds,
      venue: item.source === "Alternative.me" ? undefined : "binance_usdm",
      transport: item.source === "Alternative.me" ? undefined : snapshot.marketDataTransport,
      fallback_from_http_status: snapshot.transportFallback?.httpStatus ?? null
    }
  })));
}

async function logProviderFailure(supabase: SupabaseClient, error: unknown) {
  const code = readErrorCode(error);
  const upstreamStatus = readProviderStatus(error);
  await supabase.from("ai_provider_events").insert({
    provider: code.includes("sentiment") ? "alternative_me" : code.includes("coinglass") ? "coinglass" : "binance_usdm",
    data_category: "market_snapshot",
    status: upstreamStatus === 429
      ? "rate_limited"
      : code.includes("interval_unavailable") || code.includes("missing_coinglass")
        ? "error"
        : code.includes("timeout") || code.includes("unavailable")
        ? "timeout"
        : code.includes("malformed") || code.includes("mismatch") || code.includes("api_error")
          ? "invalid_response"
          : "error",
    http_status: upstreamStatus,
    retry_count: 0,
    error_code: code,
    error_detail: error instanceof Error ? error.message.slice(0, 900) : "Required provider failed.",
    metadata: { venue: "binance_usdm" }
  });
}

function readProviderStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("upstreamStatus" in error)) return null;
  const status = Number(error.upstreamStatus);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

async function refreshCachedMarketView(
  supabase: SupabaseClient,
  snapshot: AiNormalizedMarketSnapshot,
  features: AiMarketFeatures,
  config: AiFuturesConfigRow,
  now: number
): Promise<{ snapshot: AiNormalizedMarketSnapshot; features: AiMarketFeatures }> {
  try {
    const mark = await fetchCurrentMarkPrice(fetch, {
      now,
      timeoutMs: config.provider_timeout_ms,
      retryCount: config.provider_retry_count,
      maximumLeverage: config.maximum_leverage
    });
    const markTimestamp = Date.parse(mark.timestamp);
    if (!Number.isFinite(markTimestamp) || markTimestamp > now + 5_000) {
      throw new AiHttpError(503, "invalid_current_price_timestamp", "The Binance BTCUSDT current-price transport returned an invalid timestamp.");
    }
    const updatedTimestamps = snapshot.sourceTimestamps.map((item) => item.category === "mark_index_funding"
      ? {
          ...item,
          source: mark.source,
          observedAt: new Date(now).toISOString(),
          sourceAt: mark.timestamp,
          ageSeconds: Math.max(0, (now - markTimestamp) / 1000),
          stale: Math.max(0, (now - markTimestamp) / 1000) > config.live_price_stale_after_seconds
        }
      : refreshSourceTimestamp(item, config, now));
    const staleReasons = updatedTimestamps
      .filter((item) => item.stale)
      .map((item) => `${item.category} is stale (${Math.round(item.ageSeconds)}s old).`);
    await supabase.from("ai_provider_events").insert({
      provider: mark.transport === "coinglass" ? "coinglass" : "binance_usdm",
      data_category: "mark_index_funding",
      status: updatedTimestamps.find((item) => item.category === "mark_index_funding")?.stale ? "stale" : "success",
      source_timestamp: mark.timestamp,
      retry_count: 0,
      metadata: {
        cached_snapshot: true,
        venue: "binance_usdm",
        transport: mark.transport,
        price_kind: mark.priceKind,
        fallback_from_http_status: mark.fallbackFromBinanceStatus
      }
    });
    return {
      snapshot: {
        ...snapshot,
        capturedAt: new Date(now).toISOString(),
        currentPrice: mark.price,
        source: mark.source,
        marketDataTransport: mark.transport,
        ...(mark.fallbackFromBinanceStatus === 451
          ? { transportFallback: { from: "binance_direct" as const, httpStatus: 451 as const } }
          : { transportFallback: undefined }),
        futures: {
          ...snapshot.futures,
          markPrice: mark.price,
          priceKind: mark.priceKind,
          indexPrice: mark.indexPrice,
          basisPercent: ((mark.price - mark.indexPrice) / mark.indexPrice) * 100
        },
        sourceTimestamps: updatedTimestamps
      },
      features: { ...features, sourceTimestamps: updatedTimestamps, stale: staleReasons.length > 0, staleReasons }
    };
  } catch (error) {
    await logProviderFailure(supabase, error);
    throw error;
  }
}

function refreshStoredFreshness(
  features: AiMarketFeatures,
  snapshot: AiNormalizedMarketSnapshot,
  config: AiFuturesConfigRow,
  now: number
): AiMarketFeatures {
  const sourceTimestamps = snapshot.sourceTimestamps.map((item) => refreshSourceTimestamp(item, config, now));
  const staleReasons = sourceTimestamps
    .filter((item) => item.stale)
    .map((item) => `${item.category} is stale (${Math.round(item.ageSeconds)}s old).`);
  return { ...features, sourceTimestamps, stale: staleReasons.length > 0, staleReasons };
}

function refreshSourceTimestamp(
  item: AiNormalizedMarketSnapshot["sourceTimestamps"][number],
  config: AiFuturesConfigRow,
  now: number
) {
  const ageSeconds = Math.max(0, (now - Date.parse(item.sourceAt)) / 1000);
  const staleAfterSeconds = item.category === "candles_15m"
    ? config.candle_stale_after_seconds
    : item.category === "candles_1h"
      ? config.candle_stale_after_seconds * 4
      : item.category === "candles_4h"
        ? config.candle_stale_after_seconds * 16
        : item.category === "mark_index_funding"
          ? config.live_price_stale_after_seconds
          : item.category === "fear_greed"
            ? config.sentiment_stale_after_seconds
            : config.futures_metrics_stale_after_seconds;
  return { ...item, observedAt: new Date(now).toISOString(), ageSeconds, stale: ageSeconds > staleAfterSeconds };
}
