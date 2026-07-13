import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  initialAiOutcomeState,
  reconcileAiSetupOutcome,
  type AiOutcomeEvent
} from "../../../src/lib/aiFuturesOutcome.ts";
import type { AiCandidateSetup, AiFuturesCandle, AiOutcomeState } from "../../../src/lib/aiFuturesTypes.ts";
import {
  AiHttpError,
  aiErrorResponse,
  aiJsonResponse,
  getAiServiceClient,
  handleAiOptions,
  readBoundedJson,
  requireAiCron
} from "../_shared/ai-futures-http.ts";

const binanceKlinesEndpoint = "https://fapi.binance.com/fapi/v1/klines";
const coinGlassFuturesPriceHistoryEndpoint = "https://open-api-v4.coinglass.com/api/futures/price/history";
const requestTimeoutMs = 8_000;
const defaultBatchLimit = 100;
const maximumCandlePagesPerSetup = 5;
const maximumProviderAttempts = 2;
const oneMinuteMs = 60_000;

type OutcomeMarketTransport = "binance_direct" | "coinglass";
type ConfiguredOutcomeMarketTransport = "auto" | "direct" | "coinglass";

interface OutcomeCandleResult {
  candles: AiFuturesCandle[];
  transport: OutcomeMarketTransport;
  fellBackFromBinance451: boolean;
}

interface OutcomeCandlePage {
  rows: unknown[];
  transport: OutcomeMarketTransport;
  fellBackFromBinance451: boolean;
}

Deno.serve(async (request) => {
  const options = handleAiOptions(request);
  if (options) return options;
  let supabase: SupabaseClient | null = null;
  let runId: string | null = null;
  try {
    if (request.method !== "POST") throw new AiHttpError(405, "method_not_allowed", "Use POST for AI outcome reconciliation.");
    requireAiCron(request);
    supabase = getAiServiceClient();
    const body = await readBoundedJson(request, 4_000);
    if (body.scope !== undefined && body.scope !== "active-setups") throw new AiHttpError(400, "invalid_scope", "Use scope=active-setups.");
    const workerId = `outcomes:${crypto.randomUUID()}`;
    const { data: run } = await supabase.from("ai_pipeline_runs").insert({
      job_type: "outcome_reconciliation",
      status: "running",
      worker_id: workerId
    }).select("id").single();
    runId = run?.id ? String(run.id) : null;
    const { data, error } = await supabase.rpc("claim_ai_setup_outcomes_for_reconciliation", {
      p_worker_id: workerId,
      p_limit: positiveInteger(Deno.env.get("AI_OUTCOME_BATCH_LIMIT"), defaultBatchLimit),
      p_lease_seconds: 120
    });
    if (error) throw new AiHttpError(500, "outcome_claim_failed", "AI setup outcomes could not be claimed.");
    const rows = (data ?? []) as OutcomeRow[];
    const results = [];
    for (const row of rows) {
      try { results.push(await reconcileRow(supabase, row, runId)); }
      catch (error) {
        await releaseLease(supabase, row);
        results.push({ setupId: row.setup_id, status: "error", error: readCode(error) });
      }
    }
    const failures = results.filter((result) => result.status === "error").length;
    if (runId) await finishRun(supabase, runId, failures ? "partial" : "succeeded", {
      processed: rows.length,
      failures
    });
    return aiJsonResponse(request, { processed: rows.length, failures, results });
  } catch (error) {
    if (supabase && runId) await finishRun(supabase, runId, "failed", {}, readCode(error), error instanceof Error ? error.message : "Outcome reconciliation failed.");
    return aiErrorResponse(request, error);
  }
});

interface OutcomeRow {
  setup_id: string;
  status: string;
  entry_triggered_at: string | null;
  highest_tp_hit: number | null;
  maximum_favorable_excursion_r: number | null;
  maximum_adverse_excursion_r: number | null;
  realized_result_r: number | null;
  estimated_result_after_costs_r: number | null;
  last_checked_at: string | null;
  processing_lease_token: string;
}

async function reconcileRow(supabase: SupabaseClient, row: OutcomeRow, runId: string | null) {
  const { data: setup, error } = await supabase
    .from("ai_market_setups")
    .select("id,deterministic_candidate,created_at,setup_expires_at")
    .eq("id", row.setup_id)
    .single();
  if (error || !setup) throw new AiHttpError(500, "setup_lookup_failed", "Outcome setup could not be loaded.");
  const candidate = setup.deterministic_candidate as AiCandidateSetup;
  const startMs = Date.parse(row.last_checked_at ?? row.entry_triggered_at ?? setup.created_at) + 1;
  const endMs = Date.now();
  let candleResult: OutcomeCandleResult;
  try {
    candleResult = await fetchClosedOneMinuteCandles(startMs, endMs);
    await logOutcomeProviderSuccess(supabase, runId, row.setup_id, candleResult, startMs, endMs);
  } catch (providerError) {
    await logOutcomeProviderFailure(supabase, runId, row.setup_id, providerError);
    throw providerError;
  }
  const { candles } = candleResult;
  const previous = await buildPreviousState(supabase, row, candidate);
  const reconciliation = reconcileAiSetupOutcome(candidate, previous, candles);
  const dbStatus = toDatabaseStatus(reconciliation.state);
  const terminalPriceEvent = [...reconciliation.events].reverse().find((event) =>
    event.type === "take_profit" || event.type === "stop_loss" || event.type === "invalidated"
  );
  const entryPrice = candidate.entryZone ? (candidate.entryZone.low + candidate.entryZone.high) / 2 : null;
  const highestTp = candidate.takeProfits.reduce(
    (highest, target, index) => reconciliation.state.hitTakeProfits.includes(target.label) ? Math.max(highest, index + 1) : highest,
    0
  ) || null;
  const { error: updateError } = await supabase.rpc("save_ai_setup_outcome_reconciliation", {
    p_setup_id: row.setup_id,
    p_lease_token: row.processing_lease_token,
    p_next_outcome: {
      status: dbStatus,
      entry_triggered_at: reconciliation.state.enteredAt,
      entry_price: reconciliation.state.enteredAt ? entryPrice : null,
      highest_tp_hit: highestTp,
      final_price: terminalStatus(dbStatus) ? terminalPriceEvent?.price ?? null : null,
      maximum_favorable_excursion_r: reconciliation.state.mfeR,
      maximum_adverse_excursion_r: reconciliation.state.maeR,
      realized_result_r: reconciliation.state.realizedR,
      estimated_result_after_costs_r: reconciliation.state.estimatedResultAfterCostsR,
      last_checked_at: reconciliation.checkedThrough ?? row.last_checked_at,
      finalized_at: terminalStatus(dbStatus) ? reconciliation.state.completedAt ?? new Date().toISOString() : null
    },
    p_events: buildEventRows(reconciliation.events, candles, candleResult.transport)
  });
  if (updateError) throw new AiHttpError(500, "outcome_save_failed", "AI setup outcome could not be saved.");
  return {
    setupId: row.setup_id,
    status: dbStatus,
    events: reconciliation.events.length,
    checkedThrough: reconciliation.checkedThrough,
    marketDataTransport: candleResult.transport
  };
}

async function buildPreviousState(supabase: SupabaseClient, row: OutcomeRow, candidate: AiCandidateSetup): Promise<AiOutcomeState> {
  const state = initialAiOutcomeState();
  state.status = row.status === "awaiting_entry"
    ? "waiting_entry"
    : row.status === "entry_triggered" || row.status === "tp_partial"
      ? "active"
      : row.status === "tp_hit" ? "tp_hit" : row.status === "sl_hit" ? "stopped" : row.status as AiOutcomeState["status"];
  state.enteredAt = row.entry_triggered_at;
  state.mfeR = Number(row.maximum_favorable_excursion_r ?? 0);
  state.maeR = Number(row.maximum_adverse_excursion_r ?? 0);
  state.realizedR = Number(row.realized_result_r ?? 0);
  state.estimatedResultAfterCostsR = Number(row.estimated_result_after_costs_r ?? 0);
  if ((row.highest_tp_hit ?? 0) > 0) state.hitTakeProfits = candidate.takeProfits.slice(0, row.highest_tp_hit!).map((target) => target.label);
  const { data: events } = await supabase
    .from("ai_setup_outcome_events")
    .select("event_type,take_profit_index")
    .eq("setup_id", row.setup_id)
    .eq("event_type", "take_profit_hit");
  for (const event of events ?? []) {
    const index = Number(event.take_profit_index) - 1;
    if (candidate.takeProfits[index] && !state.hitTakeProfits.includes(candidate.takeProfits[index].label)) {
      state.hitTakeProfits.push(candidate.takeProfits[index].label);
    }
  }
  return state;
}

async function fetchClosedOneMinuteCandles(startMs: number, endMs: number): Promise<OutcomeCandleResult> {
  const configuredTransport = configuredOutcomeMarketTransport();
  let activeTransport: OutcomeMarketTransport = configuredTransport === "coinglass" ? "coinglass" : "binance_direct";
  if (!Number.isFinite(startMs) || startMs >= endMs) {
    return { candles: [], transport: activeTransport, fellBackFromBinance451: false };
  }
  const candles: AiFuturesCandle[] = [];
  let fellBackFromBinance451 = false;
  let cursor = Math.max(0, startMs);
  for (let page = 0; page < maximumCandlePagesPerSetup && cursor < endMs; page += 1) {
    const payload = await fetchOutcomeCandlePage(cursor, endMs, configuredTransport, activeTransport);
    activeTransport = payload.transport;
    fellBackFromBinance451 ||= payload.fellBackFromBinance451;
    const parsed = payload.rows.map(payload.transport === "coinglass" ? parseCoinGlassCandle : parseCandle);
    if (parsed.some((candle) => candle === null)) {
      throw new OutcomeProviderError(
        "outcome_provider_invalid",
        `${outcomeProviderLabel(payload.transport)} outcome candles are malformed.`,
        payload.transport
      );
    }
    const pageCandles = (parsed as AiFuturesCandle[])
      .filter((candle) => candle.openTime >= cursor && candle.closeTime < endMs)
      .sort((left, right) => left.openTime - right.openTime);
    for (const candle of pageCandles) {
      const previous = candles[candles.length - 1];
      if (!previous || candle.openTime > previous.openTime) {
        if (previous && candle.openTime !== previous.closeTime + 1) {
          throw new OutcomeProviderError(
            "outcome_provider_gap",
            `${outcomeProviderLabel(activeTransport)} returned a gap in 1-minute outcome candles.`,
            activeTransport
          );
        }
        candles.push(candle);
      }
    }
    if (payload.rows.length < 1000 || !pageCandles.length) break;
    const nextCursor = pageCandles[pageCandles.length - 1].closeTime + 1;
    if (nextCursor <= cursor) {
      throw new OutcomeProviderError(
        "outcome_provider_cursor",
        `${outcomeProviderLabel(activeTransport)} outcome pagination did not advance.`,
        activeTransport
      );
    }
    cursor = nextCursor;
  }
  assertCompleteClosedCandleRange(candles, startMs, endMs, activeTransport);
  return { candles, transport: activeTransport, fellBackFromBinance451 };
}

async function fetchOutcomeCandlePage(
  startMs: number,
  endMs: number,
  configuredTransport: ConfiguredOutcomeMarketTransport,
  activeTransport: OutcomeMarketTransport
): Promise<OutcomeCandlePage> {
  if (activeTransport === "coinglass") {
    return { rows: await fetchCoinGlassOutcomeCandlePage(startMs, endMs), transport: "coinglass", fellBackFromBinance451: false };
  }
  try {
    return { rows: await fetchBinanceOutcomeCandlePage(startMs, endMs), transport: "binance_direct", fellBackFromBinance451: false };
  } catch (error) {
    if (configuredTransport !== "auto" || !(error instanceof OutcomeProviderError) || error.upstreamStatus !== 451) throw error;
    try {
      return { rows: await fetchCoinGlassOutcomeCandlePage(startMs, endMs), transport: "coinglass", fellBackFromBinance451: true };
    } catch (fallbackError) {
      if (fallbackError instanceof OutcomeProviderError) fallbackError.fellBackFromBinance451 = true;
      throw fallbackError;
    }
  }
}

async function fetchBinanceOutcomeCandlePage(startMs: number, endMs: number): Promise<unknown[]> {
  const params = new URLSearchParams({
    symbol: "BTCUSDT",
    interval: "1m",
    startTime: String(startMs),
    endTime: String(endMs),
    limit: "1000"
  });
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maximumProviderAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(`${binanceKlinesEndpoint}?${params}`, { signal: controller.signal });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < maximumProviderAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
          continue;
        }
        if (response.status === 401 || response.status === 403) {
          throw new OutcomeProviderError(
            "outcome_coinglass_interval_unavailable",
            "CoinGlass rejected required 1-minute history; verify the API key and a Standard plan or higher.",
            "coinglass",
            response.status,
            503
          );
        }
        throw new OutcomeProviderError(
          "outcome_provider_error",
          `Binance USD-M returned HTTP ${response.status}.`,
          "binance_direct",
          response.status
        );
      }
      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new OutcomeProviderError("outcome_provider_invalid", "Binance USD-M outcome candles are malformed.", "binance_direct");
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (error instanceof OutcomeProviderError || attempt === maximumProviderAttempts) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastError instanceof OutcomeProviderError) throw lastError;
  throw new OutcomeProviderError("outcome_provider_unavailable", "Binance USD-M outcome candles are unavailable.", "binance_direct");
}

async function fetchCoinGlassOutcomeCandlePage(startMs: number, endMs: number): Promise<unknown[]> {
  const apiKey = Deno.env.get("COINGLASS_API_KEY")?.trim();
  if (!apiKey) {
    throw new OutcomeProviderError(
      "missing_coinglass_key",
      "COINGLASS_API_KEY is required when CoinGlass provides Binance USD-M market data.",
      "coinglass",
      null,
      503
    );
  }
  const params = new URLSearchParams({
    exchange: "Binance",
    symbol: "BTCUSDT",
    interval: "1m",
    limit: "1000",
    start_time: String(startMs),
    end_time: String(endMs)
  });
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maximumProviderAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(`${coinGlassFuturesPriceHistoryEndpoint}?${params}`, {
        headers: { Accept: "application/json", "CG-API-KEY": apiKey },
        signal: controller.signal
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < maximumProviderAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
          continue;
        }
        throw new OutcomeProviderError(
          "outcome_coinglass_http_error",
          `CoinGlass returned HTTP ${response.status} for Binance BTCUSDT futures history.`,
          "coinglass",
          response.status
        );
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload) || payload.code !== "0" || !Array.isArray(payload.data)) {
        const responseCode = isRecord(payload) && typeof payload.code === "string" ? payload.code.slice(0, 40) : "invalid";
        throw new OutcomeProviderError(
          "outcome_coinglass_invalid",
          `CoinGlass rejected or malformed the Binance BTCUSDT 1-minute futures request (code ${responseCode}); verify the API plan supports 1m history.`,
          "coinglass"
        );
      }
      return payload.data;
    } catch (error) {
      lastError = error;
      if (error instanceof OutcomeProviderError || attempt === maximumProviderAttempts) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastError instanceof OutcomeProviderError) throw lastError;
  throw new OutcomeProviderError(
    "outcome_coinglass_unavailable",
    "CoinGlass Binance BTCUSDT futures history is unavailable.",
    "coinglass"
  );
}

function parseCandle(row: unknown): AiFuturesCandle | null {
  if (!Array.isArray(row) || row.length < 11) return null;
  const values = row.slice(0, 11).map(Number);
  if (!values.every(Number.isFinite)) return null;
  const candle: AiFuturesCandle = {
    openTime: values[0], open: values[1], high: values[2], low: values[3], close: values[4], volume: values[5],
    closeTime: values[6], quoteVolume: values[7], takerBuyBaseVolume: values[9], takerBuyQuoteVolume: values[10]
  };
  if (candle.open <= 0 || candle.close <= 0 || candle.low <= 0 || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) return null;
  return candle;
}

function parseCoinGlassCandle(row: unknown): AiFuturesCandle | null {
  if (!isRecord(row)) return null;
  const openTime = providerNumber(row.time);
  const open = providerNumber(row.open);
  const high = providerNumber(row.high);
  const low = providerNumber(row.low);
  const close = providerNumber(row.close);
  const quoteVolume = providerNumber(row.volume_usd);
  if (![openTime, open, high, low, close, quoteVolume].every(Number.isFinite) ||
    !Number.isInteger(openTime) || openTime < 0 || openTime % oneMinuteMs !== 0 ||
    open <= 0 || high <= 0 || low <= 0 || close <= 0 || quoteVolume < 0 ||
    high < Math.max(open, close) || low > Math.min(open, close) || high < low) return null;
  return {
    openTime,
    open,
    high,
    low,
    close,
    volume: quoteVolume / close,
    closeTime: openTime + oneMinuteMs - 1,
    quoteVolume,
    takerBuyBaseVolume: 0,
    takerBuyQuoteVolume: 0
  };
}

function buildEventRows(events: AiOutcomeEvent[], candles: AiFuturesCandle[], transport: OutcomeMarketTransport) {
  return events.map((event) => {
    const index = event.targetLabel?.match(/\d+/)?.[0];
    const candle = candles.find((item) => new Date(item.closeTime).toISOString() === event.occurredAt);
    return {
      event_key: event.key,
      event_type: event.type === "entry"
        ? "entry_triggered"
        : event.type === "take_profit"
          ? "take_profit_hit"
          : event.type === "stop_loss"
            ? "stop_loss_hit"
            : event.type,
      take_profit_index: index ? Number(index) : null,
      trigger_price: event.price,
      execution_price: event.price,
      occurred_at: event.occurredAt,
      candle_open_at: candle ? new Date(candle.openTime).toISOString() : null,
      candle_close_at: candle ? new Date(candle.closeTime).toISOString() : null,
      was_ambiguous: event.wasAmbiguous,
      metadata: {
        realized_r: event.realizedR,
        venue: "binance_usdm",
        market_data_transport: transport,
        source: outcomeProviderLabel(transport)
      }
    };
  });
}

function toDatabaseStatus(state: AiOutcomeState): string {
  if (state.status === "waiting_entry") return "awaiting_entry";
  if (state.status === "active") return state.hitTakeProfits.length ? "tp_partial" : "entry_triggered";
  if (state.status === "stopped") return "sl_hit";
  return state.status;
}

function terminalStatus(status: string): boolean {
  return ["tp_hit", "sl_hit", "expired", "invalidated"].includes(status);
}

function configuredOutcomeMarketTransport(): ConfiguredOutcomeMarketTransport {
  const value = Deno.env.get("AI_BINANCE_DATA_TRANSPORT")?.trim().toLowerCase() || "auto";
  if (value === "auto" || value === "direct" || value === "coinglass") return value;
  throw new AiHttpError(
    503,
    "invalid_market_data_transport",
    "AI_BINANCE_DATA_TRANSPORT must be auto, direct, or coinglass."
  );
}

function outcomeProviderLabel(transport: OutcomeMarketTransport): string {
  return transport === "coinglass" ? "CoinGlass API · Binance USD-M Futures" : "Binance USD-M Futures";
}

function assertCompleteClosedCandleRange(
  candles: AiFuturesCandle[],
  startMs: number,
  endMs: number,
  transport: OutcomeMarketTransport
): void {
  const expectedFirstOpen = Math.ceil(startMs / oneMinuteMs) * oneMinuteMs;
  const expectedLastOpen = Math.floor(endMs / oneMinuteMs) * oneMinuteMs - oneMinuteMs;
  if (expectedFirstOpen > expectedLastOpen) return;
  if (!candles.length || candles[0].openTime !== expectedFirstOpen || candles[candles.length - 1].openTime !== expectedLastOpen) {
    throw new OutcomeProviderError(
      "outcome_provider_incomplete",
      `${outcomeProviderLabel(transport)} returned an incomplete closed 1-minute outcome-candle range.`,
      transport
    );
  }
}

async function logOutcomeProviderSuccess(
  supabase: SupabaseClient,
  runId: string | null,
  setupId: string,
  result: OutcomeCandleResult,
  startMs: number,
  endMs: number
) {
  await supabase.from("ai_provider_events").insert({
    pipeline_run_id: runId,
    provider: result.transport === "coinglass" ? "coinglass" : "binance_usdm",
    data_category: "outcome_candles_1m",
    status: "success",
    source_timestamp: result.candles.length
      ? new Date(result.candles[result.candles.length - 1].closeTime).toISOString()
      : null,
    retry_count: 0,
    metadata: {
      setup_id: setupId,
      venue: "binance_usdm",
      transport: result.transport,
      source: outcomeProviderLabel(result.transport),
      fallback_from_binance_http_451: result.fellBackFromBinance451,
      candle_count: result.candles.length,
      requested_start_at: new Date(startMs).toISOString(),
      requested_end_at: new Date(endMs).toISOString()
    }
  });
}

async function logOutcomeProviderFailure(
  supabase: SupabaseClient,
  runId: string | null,
  setupId: string,
  error: unknown
) {
  const transport = error instanceof OutcomeProviderError ? error.transport : null;
  const upstreamStatus = error instanceof OutcomeProviderError ? error.upstreamStatus : null;
  await supabase.from("ai_provider_events").insert({
    pipeline_run_id: runId,
    provider: transport === "coinglass" ? "coinglass" : transport === "binance_direct" ? "binance_usdm" : "market_data_transport",
    data_category: "outcome_candles_1m",
    status: upstreamStatus === 429
      ? "rate_limited"
      : error instanceof OutcomeProviderError && error.code.includes("interval_unavailable")
        ? "error"
      : error instanceof OutcomeProviderError && error.code.includes("invalid")
        ? "invalid_response"
        : error instanceof OutcomeProviderError && error.code.includes("unavailable")
          ? "timeout"
          : "error",
    http_status: upstreamStatus,
    retry_count: 0,
    error_code: readCode(error),
    error_detail: error instanceof Error ? error.message.slice(0, 900) : "Outcome market-data provider failed.",
    metadata: {
      setup_id: setupId,
      venue: "binance_usdm",
      transport,
      fallback_from_binance_http_451: error instanceof OutcomeProviderError && error.fellBackFromBinance451
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  return Number(value);
}

class OutcomeProviderError extends AiHttpError {
  constructor(
    code: string,
    message: string,
    public readonly transport: OutcomeMarketTransport,
    public readonly upstreamStatus: number | null = null,
    responseStatus = 502,
    public fellBackFromBinance451 = false
  ) {
    super(responseStatus, code, message);
    this.name = "OutcomeProviderError";
  }
}

async function releaseLease(supabase: SupabaseClient, row: OutcomeRow) {
  await supabase.from("ai_setup_outcomes").update({
    processing_lease_token: null,
    processing_lease_owner: null,
    processing_lease_expires_at: null
  }).eq("setup_id", row.setup_id).eq("processing_lease_token", row.processing_lease_token);
}

async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  status: "succeeded" | "partial" | "failed",
  counters: Record<string, unknown>,
  errorCode: string | null = null,
  errorDetail: string | null = null
) {
  await supabase.from("ai_pipeline_runs").update({
    status, counters, error_code: errorCode, error_detail: errorDetail?.slice(0, 900) ?? null, finished_at: new Date().toISOString()
  }).eq("id", runId);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code.slice(0, 100);
  return "outcome_reconciliation_failed";
}
