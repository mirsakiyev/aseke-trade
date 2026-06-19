import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  reconcileDemoTradeStateWithCandles,
  type DemoTradeExecutionEvent,
  type DemoTradeReconciliationCandle
} from "../../../src/lib/demoTradeReconciliation.ts";
import type { DemoTradeState } from "../../../src/lib/demoTradeMath.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

const requestTimeoutMs = 8000;
const oneMinuteMs = 60 * 1000;
const maxCandlesPerPosition = 60_000;
const candleProviders = [
  "https://api.binance.us/api/v3/klines",
  "https://api.binance.com/api/v3/klines"
];

interface DemoTradeStateRow {
  user_id: string;
  state: DemoTradeState;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST" && request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed.", code: "method_not_allowed" }, 405);
  }

  try {
    const supabase = getServiceClient();
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    const isServiceRequest = isServiceRoleRequest(request);
    const scope = body.scope === "all" || (request.method === "GET" && isServiceRequest) ? "all" : "user";

    if (scope === "all") {
      requireServiceRole(request);
      const result = await reconcileAllActiveDemoTrades(supabase);
      return jsonResponse(result);
    }

    const userId = await getAuthenticatedUserId(request, supabase);
    const result = await reconcileUserDemoTrade(supabase, userId);
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo trade reconciliation failed.";
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : "demo_trade_reconcile_failed";
    console.error("Demo trade reconciliation error", { code, message, error });
    return jsonResponse({ error: message, code }, status);
  }
});

async function reconcileAllActiveDemoTrades(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("demo_trade_states")
    .select("user_id,state");

  if (error) {
    throw new ApiError(500, "demo_trade_state_lookup_failed", "Active demo trades could not be loaded.");
  }

  const rows = ((data ?? []) as DemoTradeStateRow[]).filter(hasReconcilableDemoState);
  const results = [];
  for (const row of rows) {
    results.push(await reconcileStateRow(supabase, row));
  }

  return {
    processed: results.length,
    updated: results.filter((result) => result.events.length > 0 || result.checkedThrough).length,
    results
  };
}

async function reconcileUserDemoTrade(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("demo_trade_states")
    .select("user_id,state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "demo_trade_state_lookup_failed", "Demo trade state could not be loaded.");
  }

  if (!data) {
    return { processed: 0, updated: 0, state: null, events: [] };
  }

  const result = await reconcileStateRow(supabase, data as DemoTradeStateRow);
  return {
    processed: 1,
    updated: result.events.length > 0 || result.checkedThrough ? 1 : 0,
    state: result.state,
    events: result.events
  };
}

async function reconcileStateRow(supabase: SupabaseClient, row: DemoTradeStateRow) {
  const state = row.state;
  const position = state.openPosition;
  const pendingOrder = state.pendingLimitOrder;
  if (!position && !pendingOrder) {
    return { userId: row.user_id, state, events: [] as DemoTradeExecutionEvent[], checkedThrough: null };
  }

  const startMs = resolveStartTime(position?.lastCheckedAt ?? position?.openedAt ?? pendingOrder?.updatedAt ?? pendingOrder?.createdAt);
  const endMs = Date.now();
  if (!startMs || startMs >= endMs) {
    return { userId: row.user_id, state, events: [] as DemoTradeExecutionEvent[], checkedThrough: null };
  }

  const candles = await fetchHistoricalCandles(position?.symbol ?? pendingOrder?.symbol ?? state.symbol, startMs + 1, endMs);
  const reconciliation = reconcileDemoTradeStateWithCandles(state, candles, new Date(endMs).toISOString());
  if (!reconciliation.checkedThrough && reconciliation.events.length === 0) {
    return { userId: row.user_id, state, events: [] as DemoTradeExecutionEvent[], checkedThrough: null };
  }

  const { data, error } = await supabase.rpc("save_reconciled_demo_trade_state", {
    next_state: reconciliation.state,
    base_updated_at: state.updatedAt,
    base_trade_id: position?.tradeId ?? null,
    execution_events: reconciliation.events
  });

  if (error) {
    throw new ApiError(500, "demo_trade_state_save_failed", "Reconciled demo trade state could not be saved.");
  }

  const savedState = readSavedState(data) ?? reconciliation.state;
  return {
    userId: row.user_id,
    state: savedState,
    events: reconciliation.events,
    checkedThrough: reconciliation.checkedThrough
  };
}

function hasReconcilableDemoState(row: DemoTradeStateRow): boolean {
  return Boolean(row.state.openPosition || row.state.pendingLimitOrder);
}

async function fetchHistoricalCandles(
  symbol: string,
  startMs: number,
  endMs: number
): Promise<DemoTradeReconciliationCandle[]> {
  if (normalizeSymbol(symbol) !== "BTCUSDT") {
    throw new ApiError(400, "unsupported_demo_symbol", "BTC/USDT is the only supported demo pair for reconciliation.");
  }

  let latestError: unknown = null;
  for (const provider of candleProviders) {
    try {
      return await fetchKlinePages(provider, "BTCUSDT", startMs, endMs);
    } catch (error) {
      latestError = error;
    }
  }

  throw latestError instanceof Error
    ? latestError
    : new ApiError(502, "demo_trade_candles_unavailable", "Historical BTC candles are unavailable.");
}

async function fetchKlinePages(
  endpoint: string,
  symbol: "BTCUSDT",
  startMs: number,
  endMs: number
): Promise<DemoTradeReconciliationCandle[]> {
  const candles: DemoTradeReconciliationCandle[] = [];
  let cursor = Math.max(0, startMs);

  while (cursor < endMs && candles.length < maxCandlesPerPosition) {
    const params = new URLSearchParams({
      symbol,
      interval: "1m",
      startTime: String(cursor),
      endTime: String(endMs),
      limit: "1000"
    });
    const payload = await fetchJson(`${endpoint}?${params.toString()}`);
    const rows = Array.isArray(payload) ? payload : [];
    const pageCandles = rows.map(normalizeBinanceKline).filter((candle): candle is DemoTradeReconciliationCandle => Boolean(candle));
    if (!pageCandles.length) break;

    candles.push(...pageCandles);
    const lastCandle = pageCandles[pageCandles.length - 1];
    const nextCursor = lastCandle.timestamp + oneMinuteMs;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
  }

  return candles
    .filter((candle) => candle.timestamp >= startMs && candle.timestamp <= endMs)
    .slice(0, maxCandlesPerPosition);
}

function normalizeBinanceKline(row: unknown): DemoTradeReconciliationCandle | null {
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

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      throw new ApiError(502, "demo_trade_candle_request_failed", `Historical BTC candle request failed with ${response.status}.`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function getServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")?.trim()
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

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

async function getAuthenticatedUserId(request: Request, supabase: SupabaseClient): Promise<string> {
  const token = getBearerToken(request);
  if (!token) {
    throw new ApiError(401, "auth_required", "Sign in before reconciling demo trades.");
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new ApiError(401, "invalid_session", "Your session could not be verified.");
  }

  return data.user.id;
}

function requireServiceRole(request: Request): void {
  if (!isServiceRoleRequest(request)) {
    throw new ApiError(403, "server_only", "Scheduled demo trade reconciliation is server-only.");
  }
}

function isServiceRoleRequest(request: Request): boolean {
  const token = getBearerToken(request);
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")?.trim()
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  return Boolean(token && serviceRoleKey && token === serviceRoleKey);
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

function readSavedState(value: unknown): DemoTradeState | null {
  if (isRecord(value) && isRecord(value.state)) {
    return value.state as unknown as DemoTradeState;
  }
  return null;
}

function resolveStartTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeSymbol(symbol: string): string {
  return symbol.replace(/[^a-z0-9]/gi, "").toUpperCase();
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
