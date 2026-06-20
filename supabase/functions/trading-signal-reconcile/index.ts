import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  reconcileTradingSignalWithCandles,
  type TradingSignalExecutionEvent,
  type TradingSignalReconciliationCandle
} from "../../../src/lib/tradingSignalReconciliation.ts";
import type { TradingSignal, TradingSignalUpdate } from "../../../src/types/content.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

const requestTimeoutMs = 8000;
const oneMinuteMs = 60 * 1000;
const defaultBatchLimit = 200;
const defaultMaxCandlesPerSignal = 60_000;
const candleProviders = [
  "https://api.binance.us/api/v3/klines",
  "https://api.binance.com/api/v3/klines"
];

interface ReconcileResult {
  signalId: string;
  symbol: string;
  normalizedSymbol: string | null;
  status: "updated" | "checked" | "skipped" | "error";
  reason: string | null;
  checkedThrough: string | null;
  events: TradingSignalExecutionEvent[];
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST" && request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed.", code: "method_not_allowed" }, 405);
  }

  try {
    requireServiceRole(request);

    const body = request.method === "POST" ? await readJsonBody(request) : {};
    if (body.scope !== undefined && body.scope !== "all") {
      throw new ApiError(400, "unsupported_scope", "Trading signal reconciliation only supports scope=all.");
    }

    const supabase = getServiceClient();
    const result = await reconcileAllActiveTradingSignals(supabase);
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trading signal reconciliation failed.";
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : "trading_signal_reconcile_failed";
    console.error("Trading signal reconciliation error", { code, message, error });
    return jsonResponse({ error: message, code }, status);
  }
});

async function reconcileAllActiveTradingSignals(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("trading_signals")
    .select("*")
    .eq("status", "active")
    .eq("is_active", true)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(getPositiveIntegerEnv("TRADING_SIGNAL_RECONCILE_LIMIT", defaultBatchLimit));

  if (error) {
    throw new ApiError(500, "trading_signal_lookup_failed", "Active trading signals could not be loaded.");
  }

  const rows = (data ?? []) as TradingSignal[];
  const results: ReconcileResult[] = [];
  for (const signal of rows) {
    try {
      results.push(await reconcileSignalRow(supabase, signal));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Signal could not be reconciled.";
      const code = error instanceof ApiError ? error.code : "signal_reconcile_failed";
      console.error("Trading signal row reconciliation error", { signalId: signal.id, code, message, error });
      results.push({
        signalId: signal.id,
        symbol: signal.symbol,
        normalizedSymbol: normalizeSignalSymbol(signal.symbol),
        status: "error",
        reason: code,
        checkedThrough: null,
        events: []
      });
    }
  }

  return {
    processed: results.length,
    updated: results.filter((result) => result.status === "updated").length,
    checked: results.filter((result) => result.status === "checked").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    errors: results.filter((result) => result.status === "error").length,
    results
  };
}

async function reconcileSignalRow(supabase: SupabaseClient, signal: TradingSignal): Promise<ReconcileResult> {
  const normalizedSymbol = normalizeSignalSymbol(signal.symbol);
  if (!normalizedSymbol) {
    return skippedSignal(signal, null, "unsupported_symbol");
  }

  const startMs = resolveStartTime(signal.last_checked_at ?? signal.created_at);
  const endMs = lastCompletedCandleEnd(Date.now());
  if (!startMs || startMs >= endMs) {
    return skippedSignal(signal, normalizedSymbol, "no_completed_candles");
  }

  const candles = await fetchHistoricalCandles(normalizedSymbol, startMs + 1, endMs);
  if (!candles.length) {
    return skippedSignal(signal, normalizedSymbol, "no_price_data");
  }

  const reconciliation = reconcileTradingSignalWithCandles(signal, candles, new Date(endMs).toISOString());
  if (!reconciliation.checkedThrough && reconciliation.events.length === 0) {
    return skippedSignal(signal, normalizedSymbol, "no_reconciliation_change");
  }

  const baseUpdateCount = getUpdateCount(signal.updates);
  const { data, error } = await supabase.rpc("save_reconciled_trading_signal", {
    next_signal: reconciliation.signal,
    base_status: signal.status,
    base_update_count: baseUpdateCount
  });

  if (error) {
    throw new ApiError(500, "trading_signal_save_failed", "Reconciled trading signal could not be saved.");
  }

  const savedSignal = readSavedSignal(data);
  const savedUpdateCount = getUpdateCount(savedSignal?.updates ?? signal.updates);
  const status = reconciliation.events.length > 0 || savedUpdateCount > baseUpdateCount ? "updated" : "checked";

  return {
    signalId: signal.id,
    symbol: signal.symbol,
    normalizedSymbol,
    status,
    reason: null,
    checkedThrough: reconciliation.checkedThrough,
    events: reconciliation.events
  };
}

async function fetchHistoricalCandles(
  symbol: string,
  startMs: number,
  endMs: number
): Promise<TradingSignalReconciliationCandle[]> {
  let latestError: unknown = null;
  for (const provider of candleProviders) {
    try {
      return await fetchKlinePages(provider, symbol, startMs, endMs);
    } catch (error) {
      latestError = error;
    }
  }

  throw latestError instanceof Error
    ? latestError
    : new ApiError(502, "trading_signal_candles_unavailable", "Historical signal candles are unavailable.");
}

async function fetchKlinePages(
  endpoint: string,
  symbol: string,
  startMs: number,
  endMs: number
): Promise<TradingSignalReconciliationCandle[]> {
  const candles: TradingSignalReconciliationCandle[] = [];
  let cursor = Math.max(0, startMs);
  const maxCandles = getPositiveIntegerEnv("TRADING_SIGNAL_MAX_CANDLES", defaultMaxCandlesPerSignal);

  while (cursor < endMs && candles.length < maxCandles) {
    const params = new URLSearchParams({
      symbol,
      interval: "1m",
      startTime: String(cursor),
      endTime: String(endMs),
      limit: "1000"
    });
    const payload = await fetchJson(`${endpoint}?${params.toString()}`, symbol);
    const rows = Array.isArray(payload) ? payload : [];
    const pageCandles = rows.map(normalizeBinanceKline).filter((candle): candle is TradingSignalReconciliationCandle => Boolean(candle));
    if (!pageCandles.length) break;

    candles.push(...pageCandles);
    const lastCandle = pageCandles[pageCandles.length - 1];
    const nextCursor = lastCandle.timestamp + oneMinuteMs;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
  }

  return candles
    .filter((candle) => candle.timestamp >= startMs && candle.timestamp <= endMs)
    .slice(0, maxCandles);
}

function normalizeBinanceKline(row: unknown): TradingSignalReconciliationCandle | null {
  if (!Array.isArray(row) || row.length < 7) return null;
  const timestamp = Number(row[0]);
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const closeTimestamp = Number(row[6]);

  if (![timestamp, open, high, low, close].every(Number.isFinite)) return null;
  if (high <= 0 || low <= 0 || high < low) return null;

  return {
    timestamp,
    closeTimestamp: Number.isFinite(closeTimestamp) ? closeTimestamp : timestamp,
    open,
    high,
    low,
    close
  };
}

async function fetchJson(url: string, symbol: string): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      throw new ApiError(502, "trading_signal_candle_request_failed", `Historical ${symbol} candle request failed with ${response.status}.`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function getServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = getServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new ApiError(500, "missing_supabase_secrets", "Supabase server secrets are not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function requireServiceRole(request: Request): void {
  const token = getBearerToken(request);
  const serviceRoleKey = getServiceRoleKey();
  if (!token || !serviceRoleKey || token !== serviceRoleKey) {
    throw new ApiError(403, "server_only", "Scheduled trading signal reconciliation is server-only.");
  }
}

function getServiceRoleKey(): string | null {
  return Deno.env.get("SERVICE_ROLE_KEY")?.trim()
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
    || null;
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function readSavedSignal(value: unknown): TradingSignal | null {
  return isRecord(value) && typeof value.id === "string" ? value as unknown as TradingSignal : null;
}

function resolveStartTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function lastCompletedCandleEnd(nowMs: number): number {
  return Math.max(0, Math.floor(nowMs / oneMinuteMs) * oneMinuteMs - 1);
}

function normalizeSignalSymbol(symbol: string): string | null {
  const normalized = symbol.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!/^[A-Z0-9]{2,24}$/.test(normalized)) return null;
  if (normalized.endsWith("USDT")) return normalized;
  if (normalized.endsWith("USD")) return `${normalized.slice(0, -3)}USDT`;
  return `${normalized}USDT`;
}

function getUpdateCount(updates: TradingSignalUpdate[] | null | undefined): number {
  return Array.isArray(updates) ? updates.length : 0;
}

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function skippedSignal(signal: TradingSignal, normalizedSymbol: string | null, reason: string): ReconcileResult {
  return {
    signalId: signal.id,
    symbol: signal.symbol,
    normalizedSymbol,
    status: "skipped",
    reason,
    checkedThrough: null,
    events: []
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
