import {
  AiHttpError,
  aiErrorResponse,
  aiJsonResponse,
  getAiServiceClient,
  handleAiOptions,
  readBoundedJson,
  requireAiCron
} from "../_shared/ai-futures-http.ts";
import { getOrCreateCommonAiAnalysis, loadLatestAiConfig } from "../_shared/ai-futures-orchestrator.ts";

Deno.serve(async (request) => {
  const options = handleAiOptions(request);
  if (options) return options;
  let supabase: ReturnType<typeof getAiServiceClient> | null = null;
  let runId: string | null = null;
  try {
    if (request.method !== "POST") throw new AiHttpError(405, "method_not_allowed", "Use POST for the AI market pipeline.");
    requireAiCron(request);
    supabase = getAiServiceClient();
    const body = await readBoundedJson(request, 4_000);
    if (body.scope !== undefined && body.scope !== "closed-candle") {
      throw new AiHttpError(400, "invalid_scope", "The pipeline supports scope=closed-candle only.");
    }
    const workerId = `pipeline:${crypto.randomUUID()}`;
    const { data: run, error: runError } = await supabase.from("ai_pipeline_runs").insert({
      job_type: "market_pipeline",
      status: "running",
      worker_id: workerId
    }).select("id").single();
    if (runError || !run) throw new AiHttpError(500, "pipeline_log_failed", "Pipeline run could not be recorded.");
    runId = String(run.id);
    const config = await loadLatestAiConfig(supabase);
    if (!config.feature_enabled || config.emergency_kill_switch) {
      await finishRun(supabase, runId, "skipped", null, null, { reason: config.emergency_kill_switch ? "kill_switch" : "feature_disabled" });
      return aiJsonResponse(request, { status: "skipped", reason: config.emergency_kill_switch ? "kill_switch" : "feature_disabled" });
    }
    const result = await getOrCreateCommonAiAnalysis(supabase, { config, workerId });
    await finishRun(supabase, runId, "succeeded", result.snapshotId, result.setupId, {
      verdict: result.verdict,
      shadowMode: config.shadow_mode,
      candleCloseAt: result.snapshot.candleCloseAt
    });
    return aiJsonResponse(request, {
      status: "succeeded",
      snapshotId: result.snapshotId,
      setupId: result.setupId,
      verdict: result.verdict,
      shadowMode: config.shadow_mode,
      candleCloseAt: result.snapshot.candleCloseAt
    });
  } catch (error) {
    if (supabase && runId) await finishRun(supabase, runId, "failed", null, null, {}, readCode(error), error instanceof Error ? error.message : "Pipeline failed.");
    return aiErrorResponse(request, error);
  }
});

async function finishRun(
  supabase: ReturnType<typeof getAiServiceClient>,
  runId: string,
  status: "succeeded" | "failed" | "skipped",
  snapshotId: string | null,
  setupId: string | null,
  counters: Record<string, unknown>,
  errorCode: string | null = null,
  errorDetail: string | null = null
) {
  await supabase.from("ai_pipeline_runs").update({
    status,
    snapshot_id: snapshotId,
    setup_id: setupId,
    counters,
    error_code: errorCode,
    error_detail: errorDetail?.slice(0, 900) ?? null,
    finished_at: new Date().toISOString()
  }).eq("id", runId);
}

function readCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code.slice(0, 100);
  return "market_pipeline_failed";
}
