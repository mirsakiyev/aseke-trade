import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { AI_FUTURES_RISK_PRESETS } from "../../../src/lib/aiFuturesConfig.ts";
import { validateFinalAiAnalysis } from "../../../src/lib/aiFuturesValidator.ts";
import type {
  AiAnalysisResponse,
  AiPersonalizedPlan,
  AiRiskProfileInput
} from "../../../src/lib/aiFuturesTypes.ts";
import {
  AiHttpError,
  aiErrorResponse,
  aiJsonResponse,
  getAiServiceClient,
  handleAiOptions,
  readBoundedJson,
  requireAiUser
} from "../_shared/ai-futures-http.ts";
import {
  getOrCreateCommonAiAnalysis,
  loadLatestAiConfig
} from "../_shared/ai-futures-orchestrator.ts";

Deno.serve(async (request) => {
  const options = handleAiOptions(request);
  if (options) return options;
  let requestId: string | null = null;
  let supabase: SupabaseClient | null = null;
  try {
    if (request.method !== "POST") throw new AiHttpError(405, "method_not_allowed", "Use POST for AI Futures analysis.");
    supabase = getAiServiceClient();
    const user = await requireAiUser(request, supabase);
    const body = await readBoundedJson(request);
    const idempotencyKey = normalizeIdempotencyKey(request.headers.get("idempotency-key") ?? body.idempotency_key);
    const riskProfile = normalizeRiskProfile(body.risk_profile);
    const { data: claimData, error: claimError } = await supabase.rpc("claim_ai_futures_analysis_request", {
      p_user_id: user.id,
      p_idempotency_key: idempotencyKey,
      p_request_metadata: { source: "academy_page", symbol: "BTCUSDT", timeframe: "15m" }
    });
    if (claimError) {
      if (/academy access/i.test(claimError.message)) throw new AiHttpError(403, "academy_access_required", "Active Trading Academy access is required.");
      throw new AiHttpError(500, "analysis_claim_failed", "Analysis request could not be authorized.");
    }
    const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as Record<string, unknown> | null;
    if (!claim) throw new AiHttpError(500, "analysis_claim_empty", "Analysis authorization returned no result.");
    requestId = String(claim.request_id);
    if (!claim.allowed) return blockedResponse(request, requestId, String(claim.request_status), Number(claim.retry_after_seconds));
    const config = await loadLatestAiConfig(supabase);
    if (config.id !== String(claim.active_config_id) || !config.feature_enabled || config.shadow_mode || config.emergency_kill_switch) {
      throw new AiHttpError(503, "feature_unavailable", "AI Futures Analyst configuration changed or is unavailable.");
    }
    if (claim.replayed && claim.request_status === "completed") {
      const replay = await replayCompletedAnalysis(supabase, requestId);
      if (replay) return aiJsonResponse(request, replay);
    } else if (claim.replayed) {
      throw new AiHttpError(409, "request_in_progress", "This analysis request is already being processed.");
    }

    await supabase.from("ai_analysis_requests").update({ status: "processing" }).eq("id", requestId);
    const common = await getOrCreateCommonAiAnalysis(supabase, {
      config,
      workerId: `user:${user.id}:${requestId}`
    });
    const finalConfig = await loadLatestAiConfig(supabase);
    if (finalConfig.id !== config.id || !finalConfig.feature_enabled || finalConfig.shadow_mode || finalConfig.emergency_kill_switch) {
      throw new AiHttpError(503, "feature_unavailable", "AI Futures Analyst configuration changed during analysis.");
    }
    const access = await verifyAcademyAccess(supabase, user.id);
    const { data: outcome, error: outcomeError } = await supabase
      .from("ai_setup_outcomes")
      .select("status")
      .eq("setup_id", common.setupId)
      .maybeSingle();
    if (outcomeError) throw new AiHttpError(503, "outcome_status_unavailable", "The shared setup lifecycle could not be verified.");
    const final = validateFinalAiAnalysis({
      candidate: common.candidate,
      features: common.features,
      review: common.review,
      riskProfile,
      filters: common.snapshot.filters,
      subscriptionAuthorized: access,
      intendedSnapshotCloseAt: common.snapshot.candleCloseAt,
      currentSnapshotCloseAt: common.features.candleCloseAt,
      deterministicOnlyAllowed: finalConfig.allow_deterministic_only,
      currentMarketPrice: common.snapshot.currentPrice,
      setupOutcomeStatus: outcome?.status ?? null,
      policy: {
        minimumSetupScore: config.minimum_setup_score,
        minimumRewardRisk: config.minimum_reward_risk,
        maximumRiskPercent: config.maximum_custom_risk_percent,
        maximumLeverage: config.maximum_leverage,
        maximumMarginPercent: config.maximum_margin_percent
      },
      now: Date.now()
    });

    if (!access) throw new AiHttpError(403, "academy_access_expired", "Trading Academy access expired during analysis.");
    if (riskProfile.saveProfile) await saveRiskProfile(supabase, user.id, riskProfile);
    const responsePlan = final.plan && (final.status === "LONG_SETUP" || final.status === "SHORT_SETUP")
      ? await saveTradePlan(
          supabase,
          user.id,
          requestId,
          common.setupId,
          riskProfile,
          final.plan,
          common.snapshot.filters.stepSize
        )
      : final.plan;
    const response = responsePayload({
      requestId,
      snapshotId: common.snapshotId,
      setupId: common.setupId,
      status: final.status,
      candidate: final.candidate,
      review: common.review,
      plan: responsePlan,
      currentPrice: common.snapshot.currentPrice,
      candles: common.snapshot.candles,
      analysisTimestamp: new Date().toISOString(),
      dataTimestamp: common.snapshot.candleCloseAt,
      freshness: common.snapshot.sourceTimestamps,
      deterministicOnly: final.deterministicOnly,
      scoreWeights: normalizeScoreWeights(finalConfig.score_weights),
      message: messageForStatus(final.status, final.errors, final.deterministicOnly)
    });
    await supabase.from("ai_analysis_requests").update({
      snapshot_id: common.snapshotId,
      setup_id: common.setupId,
      status: "completed",
      completed_at: new Date().toISOString(),
      request_metadata: { response }
    }).eq("id", requestId);
    return aiJsonResponse(request, response);
  } catch (error) {
    if (supabase && requestId) {
      await supabase.from("ai_analysis_requests").update({
        status: "failed",
        error_code: readCode(error),
        completed_at: new Date().toISOString()
      }).eq("id", requestId).in("status", ["accepted", "processing"]);
    }
    return aiErrorResponse(request, error);
  }
});

function normalizeRiskProfile(value: unknown): AiRiskProfileInput {
  const record = isRecord(value) ? value : {};
  const preset = ["conservative", "balanced", "aggressive", "custom"].includes(String(record.preset))
    ? String(record.preset) as AiRiskProfileInput["preset"]
    : "balanced";
  const presetDefaults = preset === "custom" ? AI_FUTURES_RISK_PRESETS.balanced : AI_FUTURES_RISK_PRESETS[preset];
  return {
    preset,
    planningBalance: decimalText(record.planning_balance ?? "1000", "Planning Balance", 8),
    riskPercent: preset === "custom"
      ? decimalText(record.risk_percent ?? presetDefaults.riskPercent, "Risk per trade", 4)
      : presetDefaults.riskPercent,
    maxLeverage: preset === "custom"
      ? wholeNumber(record.max_leverage ?? presetDefaults.maxLeverage, "Maximum leverage")
      : presetDefaults.maxLeverage,
    maxMarginPercent: preset === "custom"
      ? decimalText(record.max_margin_percent ?? presetDefaults.maxMarginPercent, "Maximum margin allocation", 4)
      : presetDefaults.maxMarginPercent,
    saveProfile: record.save_profile === true
  };
}

async function verifyAcademyAccess(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("ai_futures_user_has_academy_access", { p_user_id: userId });
  if (error) throw new AiHttpError(500, "academy_check_failed", "Academy access could not be verified.");
  return data === true;
}

async function saveRiskProfile(supabase: SupabaseClient, userId: string, profile: AiRiskProfileInput) {
  const { error } = await supabase.from("ai_risk_profiles").upsert({
    user_id: userId,
    planning_balance: profile.planningBalance,
    risk_model: profile.preset,
    risk_percent: profile.riskPercent,
    max_leverage: profile.maxLeverage,
    max_margin_percent: profile.maxMarginPercent,
    trading_style: "intraday"
  });
  if (error) throw new AiHttpError(400, "risk_profile_save_failed", "Risk profile could not be saved.");
}

async function saveTradePlan(
  supabase: SupabaseClient,
  userId: string,
  requestId: string,
  setupId: string,
  riskProfile: AiRiskProfileInput,
  plan: AiPersonalizedPlan,
  quantityStepSize: string
): Promise<AiPersonalizedPlan> {
  const { data, error } = await supabase.from("ai_user_trade_plans").insert({
    user_id: userId,
    setup_id: setupId,
    request_id: requestId,
    status: "ready",
    direction: plan.direction,
    risk_profile_snapshot: riskProfile,
    planning_balance: plan.planningBalance,
    risk_percent: plan.riskPercent,
    risk_budget: plan.riskBudget,
    max_leverage: riskProfile.maxLeverage,
    max_margin_percent: riskProfile.maxMarginPercent,
    leverage: plan.leverage,
    entry_price: plan.entryPrice,
    stop_loss: plan.stopLoss,
    quantity: plan.quantity,
    quantity_step_size: quantityStepSize,
    position_notional: plan.notional,
    required_isolated_margin: plan.requiredMargin,
    planned_maximum_loss: plan.plannedMaximumLoss,
    estimated_liquidation_price: plan.estimatedLiquidation === "unavailable" ? null : plan.estimatedLiquidation,
    entry_fee_rate: 0.0005,
    exit_fee_rate: 0.0005,
    slippage_rate: 0.0008
  }).select("id").single();
  if (error || !data) throw new AiHttpError(500, "trade_plan_save_failed", "Personalized trade plan could not be saved.");
  return { ...plan, id: String(data.id), setupId };
}

async function replayCompletedAnalysis(supabase: SupabaseClient, requestId: string): Promise<AiAnalysisResponse | null> {
  const { data } = await supabase.from("ai_analysis_requests").select("request_metadata").eq("id", requestId).maybeSingle();
  const metadata = data && isRecord(data.request_metadata) ? data.request_metadata : null;
  return metadata && isRecord(metadata.response) ? metadata.response as unknown as AiAnalysisResponse : null;
}

function blockedResponse(request: Request, requestId: string, status: string, retryAfter: number): Response {
  const code = status === "rate_limited" ? "analysis_rate_limited" : status === "shadow" ? "shadow_mode" : "feature_unavailable";
  const message = status === "rate_limited"
    ? `Analysis refresh is rate limited. Retry in ${Math.max(1, retryAfter)} seconds.`
    : status === "shadow"
      ? "AI Futures Analyst is running in shadow mode for administrator evaluation."
      : "AI Futures Analyst is currently unavailable or under maintenance.";
  return aiJsonResponse(request, { error: code, message, requestId, retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null }, status === "rate_limited" ? 429 : 503);
}

function responsePayload(input: Omit<AiAnalysisResponse, "source" | "sentimentAttribution" | "shadowMode" | "setupExpiration">): AiAnalysisResponse {
  return {
    ...input,
    setupExpiration: input.candidate?.expiresAt ?? null,
    shadowMode: false,
    source: "Binance USD-M Futures",
    sentimentAttribution: {
      label: "Alternative.me Crypto Fear & Greed Index",
      url: "https://alternative.me/crypto/fear-and-greed-index/"
    }
  };
}

function messageForStatus(status: AiAnalysisResponse["status"], errors: string[], deterministicOnly: boolean): string {
  if (errors.length) return errors.join(" ");
  switch (status) {
    case "LONG_SETUP": return deterministicOnly
      ? "A qualified educational long setup passed deterministic validation without independent AI review."
      : "A qualified educational long setup passed deterministic and independent review.";
    case "SHORT_SETUP": return deterministicOnly
      ? "A qualified educational short setup passed deterministic validation without independent AI review."
      : "A qualified educational short setup passed deterministic and independent review.";
    case "WAIT_FOR_ENTRY": return "A directional candidate exists, but its entry conditions are not complete.";
    case "NO_TRADE": return "No valid setup right now. The engine will not force a trade without sufficient confluence.";
    case "RISK_LIMIT_EXCEEDED": return "A market candidate exists, but no position fits the selected risk limits.";
    default: return "Required analysis data is unavailable.";
  }
}

function normalizeIdempotencyKey(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(text)) throw new AiHttpError(400, "invalid_idempotency_key", "Provide a valid idempotency key.");
  return text;
}

function decimalText(value: unknown, field: string, maximumFractionDigits: number): string {
  const text = String(value ?? "").trim();
  const decimalPattern = new RegExp(`^\\d+(?:\\.\\d{1,${maximumFractionDigits}})?$`);
  if (!decimalPattern.test(text)) {
    throw new AiHttpError(400, "invalid_risk_profile", `${field} must be a positive decimal with at most ${maximumFractionDigits} fractional digits.`);
  }
  return text;
}

function wholeNumber(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new AiHttpError(400, "invalid_risk_profile", `${field} must be a whole number.`);
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeScoreWeights(value: Record<string, number>): AiAnalysisResponse["scoreWeights"] {
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

function readCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code.slice(0, 100);
  return "analysis_failed";
}
