import {
  AiHttpError,
  aiErrorResponse,
  aiJsonResponse,
  getAiServiceClient,
  handleAiOptions,
  readBoundedJson,
  requireAiUser
} from "../_shared/ai-futures-http.ts";
import { fetchCurrentMarkPrice } from "../_shared/ai-futures-market.ts";

Deno.serve(async (request) => {
  const options = handleAiOptions(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new AiHttpError(405, "method_not_allowed", "Use POST to load an AI practice plan.");
    const supabase = getAiServiceClient();
    const user = await requireAiUser(request, supabase);
    const body = await readBoundedJson(request, 4_000);
    const planId = String(body.plan_id ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(planId)) throw new AiHttpError(400, "invalid_plan_id", "A valid AI practice plan is required.");
    const { data: access } = await supabase.rpc("ai_futures_user_has_academy_access", { p_user_id: user.id });
    if (access !== true) throw new AiHttpError(403, "academy_access_required", "Active Trading Academy access is required.");
    const { data: config, error: configError } = await supabase
      .from("ai_futures_configs")
      .select("feature_enabled,shadow_mode,emergency_kill_switch,provider_timeout_ms,provider_retry_count,maximum_leverage,live_price_stale_after_seconds")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (configError || !config) throw new AiHttpError(503, "ai_config_unavailable", "AI Futures configuration is unavailable.");
    if (!config.feature_enabled || config.shadow_mode || config.emergency_kill_switch) {
      throw new AiHttpError(503, "feature_unavailable", "AI Futures practice plans are temporarily unavailable.");
    }
    const { data: plan, error: planError } = await supabase
      .from("ai_user_trade_plans")
      .select("id,user_id,setup_id,status,direction,leverage,entry_price,stop_loss,position_notional")
      .eq("id", planId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (planError || !plan) throw new AiHttpError(404, "plan_not_found", "AI practice plan was not found.");
    if (plan.status !== "ready") throw new AiHttpError(409, "plan_not_ready", "This AI plan did not pass its risk constraints.");
    const { data: setup, error: setupError } = await supabase
      .from("ai_market_setups")
      .select("id,verdict,direction,entry_zone_low,entry_zone_high,stop_loss,invalidation_level,take_profits,setup_expires_at,generation_status")
      .eq("id", plan.setup_id)
      .single();
    if (setupError || !setup || setup.generation_status !== "ready") {
      throw new AiHttpError(404, "setup_not_found", "The source AI setup is unavailable.");
    }
    if (!["LONG_SETUP", "SHORT_SETUP"].includes(String(setup.verdict))) {
      throw new AiHttpError(409, "setup_not_actionable", "Only approved long or short setups can be practiced.");
    }
    if (!setup.setup_expires_at || Date.parse(setup.setup_expires_at) <= Date.now()) {
      throw new AiHttpError(409, "setup_expired", "This AI setup has expired. Request a fresh analysis.");
    }
    const { data: outcome, error: outcomeError } = await supabase
      .from("ai_setup_outcomes")
      .select("status")
      .eq("setup_id", setup.id)
      .maybeSingle();
    if (outcomeError || !outcome) {
      throw new AiHttpError(503, "setup_lifecycle_unavailable", "The source setup lifecycle could not be verified.");
    }
    if (outcome.status !== "awaiting_entry") {
      throw new AiHttpError(409, "setup_already_progressed", "This setup has already triggered or ended. Request a fresh analysis.");
    }
    const now = Date.now();
    let liveMark: Awaited<ReturnType<typeof fetchCurrentMarkPrice>>;
    try {
      liveMark = await fetchCurrentMarkPrice(fetch, {
        now,
        timeoutMs: Number(config.provider_timeout_ms),
        retryCount: Number(config.provider_retry_count),
        maximumLeverage: Number(config.maximum_leverage)
      });
    } catch {
      throw new AiHttpError(503, "live_mark_unavailable", "The current Binance USD-M mark price is unavailable. Request the plan again later.");
    }
    const markTimestamp = Date.parse(liveMark.timestamp);
    const markAgeMs = now - markTimestamp;
    if (!Number.isFinite(markTimestamp) || markAgeMs < -5_000 || markAgeMs > Number(config.live_price_stale_after_seconds) * 1_000) {
      throw new AiHttpError(503, "live_mark_stale", "The current Binance USD-M mark price is stale or invalid.");
    }
    const setupLevels = readSetupLevels(setup);
    if (!setupLevels || setupLevels.direction !== plan.direction) {
      throw new AiHttpError(503, "invalid_setup_levels", "The source setup levels are invalid.");
    }
    if (liveMark.price < setupLevels.entryLow || liveMark.price > setupLevels.entryHigh) {
      throw new AiHttpError(409, "setup_not_at_entry", "The live mark price moved outside the approved entry zone. Request a fresh analysis.");
    }
    if (
      (setupLevels.direction === "long" && (liveMark.price <= setupLevels.invalidation || liveMark.price >= setupLevels.finalTarget)) ||
      (setupLevels.direction === "short" && (liveMark.price >= setupLevels.invalidation || liveMark.price <= setupLevels.finalTarget))
    ) {
      throw new AiHttpError(409, "setup_no_longer_valid", "The live mark price invalidated or completed this setup. Request a fresh analysis.");
    }
    const targets = Array.isArray(setup.take_profits) ? setup.take_profits : [];
    return aiJsonResponse(request, {
      plan: {
        id: plan.id,
        setupId: plan.setup_id,
        symbol: "BTCUSDT",
        direction: plan.direction,
        marginMode: "isolated",
        orderType: "limit",
        entryPrice: String(plan.entry_price),
        stopLoss: String(plan.stop_loss),
        leverage: Number(plan.leverage),
        notional: String(plan.position_notional),
        takeProfits: targets.map((target) => ({
          price: String(target.price),
          closePercent: String(target.allocation_percent)
        })),
        expiresAt: setup.setup_expires_at,
        source: "ASEKE TRADE AI Futures Analyst"
      }
    });
  } catch (error) {
    return aiErrorResponse(request, error);
  }
});

function readSetupLevels(setup: Record<string, unknown>): {
  direction: "long" | "short";
  entryLow: number;
  entryHigh: number;
  invalidation: number;
  finalTarget: number;
} | null {
  const direction = setup.direction === "long" || setup.direction === "short" ? setup.direction : null;
  const entryLow = Number(setup.entry_zone_low);
  const entryHigh = Number(setup.entry_zone_high);
  const invalidation = Number(setup.invalidation_level ?? setup.stop_loss);
  const targets = Array.isArray(setup.take_profits) ? setup.take_profits : [];
  const final = targets[targets.length - 1];
  const finalTarget = final && typeof final === "object" ? Number((final as Record<string, unknown>).price) : Number.NaN;
  if (!direction || ![entryLow, entryHigh, invalidation, finalTarget].every((value) => Number.isFinite(value) && value > 0) || entryHigh < entryLow) return null;
  return { direction, entryLow, entryHigh, invalidation, finalTarget };
}
