import { supabase } from "./supabase";
import type { AiAnalysisResponse, AiRiskProfileInput } from "./aiFuturesTypes.ts";

export interface AiDemoTradePrefill {
  id: string;
  setupId: string;
  symbol: "BTCUSDT";
  direction: "long" | "short";
  marginMode: "isolated";
  orderType: "limit";
  entryPrice: string;
  stopLoss: string;
  leverage: number;
  notional: string;
  takeProfits: Array<{ price: string; closePercent: string }>;
  expiresAt: string;
  source: string;
}

export interface AiAdminConfig {
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
  per_user_requests_per_minute: number;
  per_user_min_refresh_seconds: number;
  generation_lease_seconds: number;
  maximum_generation_attempts: number;
  provider_timeout_ms: number;
  provider_retry_count: number;
  feature_version: string;
  engine_version: string;
  prompt_version: string;
  model_name: string;
  created_at: string;
  change_reason: string | null;
}

export async function requestAiFuturesAnalysis(
  riskProfile: AiRiskProfileInput,
  idempotencyKey = crypto.randomUUID()
): Promise<AiAnalysisResponse> {
  if (!supabase) throw new Error("Supabase is not connected.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in before requesting analysis.");
  const { data, error } = await supabase.functions.invoke("ai-futures-analyze", {
    body: {
      idempotency_key: idempotencyKey,
      risk_profile: {
        preset: riskProfile.preset,
        planning_balance: riskProfile.planningBalance,
        risk_percent: riskProfile.riskPercent,
        max_leverage: riskProfile.maxLeverage,
        max_margin_percent: riskProfile.maxMarginPercent,
        save_profile: riskProfile.saveProfile
      }
    },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Idempotency-Key": idempotencyKey
    }
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (!data || typeof data !== "object") throw new Error("AI Futures Analyst returned an invalid response.");
  if ("error" in data && data.error) throw new Error(String(data.message ?? data.error));
  return data as AiAnalysisResponse;
}

export async function fetchAiRiskProfile(): Promise<AiRiskProfileInput | null> {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("ai_risk_profiles")
    .select("planning_balance,risk_model,risk_percent,max_leverage,max_margin_percent")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    preset: data.risk_model as AiRiskProfileInput["preset"],
    planningBalance: String(data.planning_balance),
    riskPercent: String(data.risk_percent),
    maxLeverage: Number(data.max_leverage),
    maxMarginPercent: String(data.max_margin_percent),
    saveProfile: true
  };
}

export async function fetchAiDemoTradePrefill(planId: string): Promise<AiDemoTradePrefill> {
  if (!supabase) throw new Error("Supabase is not connected.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in before loading an AI practice plan.");
  const { data, error } = await supabase.functions.invoke("ai-futures-plan", {
    body: { plan_id: planId },
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (!data?.plan) throw new Error(String(data?.message ?? "AI practice plan is unavailable."));
  return data.plan as AiDemoTradePrefill;
}

export async function fetchAiAdminData() {
  if (!supabase) throw new Error("Supabase is not connected.");
  const [configs, runs, providerEvents, modelLogs, setups, outcomes, snapshots, notes] = await Promise.all([
    supabase.from("ai_futures_configs").select("*").order("version", { ascending: false }).limit(20),
    supabase.from("ai_pipeline_runs").select("*").order("started_at", { ascending: false }).limit(50),
    supabase.from("ai_provider_events").select("*").order("occurred_at", { ascending: false }).limit(50),
    supabase.from("ai_model_usage_logs").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("ai_market_setups").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("ai_setup_outcomes").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("ai_market_snapshots").select("*").order("created_at", { ascending: false }).limit(20),
    supabase.from("ai_setup_admin_notes").select("*").order("created_at", { ascending: false }).limit(100)
  ]);
  const firstError = [configs, runs, providerEvents, modelLogs, setups, outcomes, snapshots, notes].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);
  return {
    configs: (configs.data ?? []) as AiAdminConfig[],
    runs: runs.data ?? [],
    providerEvents: providerEvents.data ?? [],
    modelLogs: modelLogs.data ?? [],
    setups: setups.data ?? [],
    outcomes: outcomes.data ?? [],
    snapshots: snapshots.data ?? [],
    notes: notes.data ?? []
  };
}

export async function appendAiSetupAdminNote(setupId: string, note: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not connected.");
  const safeNote = note.trim();
  if (!/^[0-9a-f-]{36}$/i.test(setupId)) throw new Error("Select a valid setup before adding a note.");
  if (!safeNote || safeNote.length > 4_000) throw new Error("Admin notes must contain between 1 and 4,000 characters.");
  const { error } = await supabase.from("ai_setup_admin_notes").insert({ setup_id: setupId, note: safeNote });
  if (error) throw new Error(error.message);
}

export async function createAiAdminConfig(
  current: AiAdminConfig,
  changes: Partial<AiAdminConfig>,
  reason: string
): Promise<AiAdminConfig> {
  if (!supabase) throw new Error("Supabase is not connected.");
  const next = { ...current, ...changes };
  const { data, error } = await supabase.rpc("admin_create_ai_futures_config", {
    p_feature_enabled: next.feature_enabled,
    p_shadow_mode: next.shadow_mode,
    p_ai_calls_enabled: next.ai_calls_enabled,
    p_allow_deterministic_only: next.allow_deterministic_only,
    p_emergency_kill_switch: next.emergency_kill_switch,
    p_configured_symbols: next.configured_symbols,
    p_score_weights: next.score_weights,
    p_minimum_setup_score: next.minimum_setup_score,
    p_minimum_score_difference: next.minimum_score_difference,
    p_minimum_reward_risk: next.minimum_reward_risk,
    p_maximum_custom_risk_percent: next.maximum_custom_risk_percent,
    p_maximum_leverage: next.maximum_leverage,
    p_maximum_margin_percent: next.maximum_margin_percent,
    p_candle_stale_after_seconds: next.candle_stale_after_seconds,
    p_live_price_stale_after_seconds: next.live_price_stale_after_seconds,
    p_futures_metrics_stale_after_seconds: next.futures_metrics_stale_after_seconds,
    p_sentiment_stale_after_seconds: next.sentiment_stale_after_seconds,
    p_per_user_requests_per_minute: next.per_user_requests_per_minute,
    p_per_user_min_refresh_seconds: next.per_user_min_refresh_seconds,
    p_generation_lease_seconds: next.generation_lease_seconds,
    p_maximum_generation_attempts: next.maximum_generation_attempts,
    p_provider_timeout_ms: next.provider_timeout_ms,
    p_provider_retry_count: next.provider_retry_count,
    p_feature_version: next.feature_version,
    p_engine_version: next.engine_version,
    p_prompt_version: next.prompt_version,
    p_model_name: next.model_name,
    p_provider_settings: null,
    p_change_reason: reason
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) as AiAdminConfig;
}

async function functionErrorMessage(error: { message?: string; context?: unknown }): Promise<string> {
  const fallback = error.message || "AI Futures request failed.";
  if (error.context instanceof Response) {
    try {
      const payload = await error.context.clone().json() as { message?: unknown; error?: unknown };
      return typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error : fallback;
    } catch { return fallback; }
  }
  return fallback;
}
