import {
  binanceLongShortUnavailableMessage,
  buildBinanceLongShortIndex,
  createUnavailableMarketIndices,
  getFearGreedBand,
  roundTo,
  type FearGreedIndex,
  type LongShortIndex,
  type MarketIndicesResponse,
  type VolatilityIndex
} from "../../../src/lib/marketIndexMath.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

const requestTimeoutMs = 8000;
const longShortSymbol = "BTCUSDT";
const longShortPeriod = "5m";
const binanceLongShortEndpoint = "https://fapi.binance.com/futures/data/globalLongShortAccountRatio";
const coinMarketCapFearGreedEndpoint = "https://api.coinmarketcap.com/data-api/v3/fear-greed/chart";
const alternativeFearGreedEndpoint = "https://api.alternative.me/fng/?limit=1&format=json";
const deribitVolatilityEndpoint = "https://www.deribit.com/api/v2/public/get_volatility_index_data";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST" && request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed.", code: "method_not_allowed" }, 405);
  }

  const [fearGreed, longShort, volatility] = await Promise.all([
    fetchFearGreedIndex().catch((error) => unavailableFearGreed(error)),
    fetchBinanceLongShortIndex().catch((error) => unavailableLongShort(error)),
    fetchVolatilityIndex().catch((error) => unavailableVolatility(error))
  ]);

  const payload: MarketIndicesResponse = {
    fearGreed,
    longShort,
    volatility,
    generatedAt: new Date().toISOString()
  };

  return jsonResponse(payload);
});

async function fetchFearGreedIndex(): Promise<FearGreedIndex> {
  return fetchCoinMarketCapFearGreed().catch(() => fetchAlternativeFearGreed());
}

async function fetchCoinMarketCapFearGreed(): Promise<FearGreedIndex> {
  const payload = await fetchJson(coinMarketCapFearGreedUrl());
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  const historicalNow = isRecord(data?.historicalValues) && isRecord(data.historicalValues.now)
    ? data.historicalValues.now
    : null;
  const rows = Array.isArray(data?.dataList) ? data.dataList.filter(isRecord) : [];
  const latestRow = historicalNow ?? newestTimestampedRecord(rows);
  const value = latestRow ? firstNumber(latestRow, ["score", "value"]) : null;

  if (value === null) {
    throw new Error("CoinMarketCap Fear & Greed data unavailable.");
  }

  const score = Math.round(Math.min(100, Math.max(0, value)));
  const classification = typeof latestRow?.name === "string"
    ? latestRow.name
    : typeof latestRow?.value_classification === "string"
      ? latestRow.value_classification
      : getFearGreedBand(score).label;

  return {
    status: "ready",
    value: score,
    classification,
    timestamp: latestRow ? firstTimestamp(latestRow) : null,
    timeUntilUpdate: null,
    source: "CoinMarketCap"
  };
}

async function fetchAlternativeFearGreed(): Promise<FearGreedIndex> {
  const payload = await fetchJson(alternativeFearGreedEndpoint);
  const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const row = rows.find(isRecord);
  const value = parseNumberish(row?.value);

  if (value === null) {
    throw new Error("Fear & Greed data unavailable.");
  }

  const score = Math.round(Math.min(100, Math.max(0, value)));
  const classification = typeof row?.value_classification === "string"
    ? row.value_classification
    : getFearGreedBand(score).label;

  return {
    status: "ready",
    value: score,
    classification,
    timestamp: toIsoTimestamp(row?.timestamp),
    timeUntilUpdate: parseNumberish(row?.time_until_update),
    source: "Alternative.me"
  };
}

function coinMarketCapFearGreedUrl(): string {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 7 * 24 * 60 * 60;
  const params = new URLSearchParams({
    start: String(start),
    end: String(end)
  });

  return `${coinMarketCapFearGreedEndpoint}?${params.toString()}`;
}

async function fetchBinanceLongShortIndex(): Promise<LongShortIndex> {
  const params = new URLSearchParams({
    symbol: longShortSymbol,
    period: longShortPeriod,
    limit: "1"
  });
  const payload = await fetchJson(`${binanceLongShortEndpoint}?${params.toString()}`);
  const row = Array.isArray(payload) ? payload.find(isRecord) : null;

  if (!row) {
    return unavailableLongShort(binanceLongShortUnavailableMessage);
  }

  const longShort = buildBinanceLongShortIndex({
    longAccount: firstNumber(row, ["longAccount"]),
    shortAccount: firstNumber(row, ["shortAccount"]),
    longShortRatio: firstNumber(row, ["longShortRatio"]),
    timestamp: firstTimestamp(row)
  });

  return longShort ?? unavailableLongShort(binanceLongShortUnavailableMessage);
}

async function fetchVolatilityIndex(): Promise<VolatilityIndex> {
  const [btc, eth] = await Promise.all([
    fetchDeribitVolatility("BTC").catch(() => null),
    fetchDeribitVolatility("ETH").catch(() => null)
  ]);
  const validRows = [btc, eth].filter((row): row is DeribitVolatilityPoint => Boolean(row));

  if (!validRows.length) {
    return unavailableVolatility("Deribit volatility data unavailable.");
  }

  const value = average(validRows.map((row) => row.close));
  const previous = average(validRows.map((row) => row.previousClose).filter((value): value is number => value !== null));
  const changePct = previous && previous > 0 ? ((value - previous) / previous) * 100 : null;
  const hasBtc = Boolean(btc);
  const hasEth = Boolean(eth);

  return {
    status: "ready",
    value: roundTo(value, 1),
    btc: btc ? roundTo(btc.close, 1) : null,
    eth: eth ? roundTo(eth.close, 1) : null,
    basis: hasBtc && hasEth ? "BTC/ETH DVOL average" : hasBtc ? "BTC DVOL" : "ETH DVOL",
    changePct: changePct === null ? null : roundTo(changePct, 2),
    timestamp: newestIso(validRows.map((row) => row.timestamp)),
    source: "Deribit"
  };
}

interface DeribitVolatilityPoint {
  close: number;
  previousClose: number | null;
  timestamp: string | null;
}

async function fetchDeribitVolatility(currency: "BTC" | "ETH"): Promise<DeribitVolatilityPoint | null> {
  const endTimestamp = Date.now();
  const startTimestamp = endTimestamp - 24 * 60 * 60 * 1000;
  const params = new URLSearchParams({
    currency,
    start_timestamp: String(startTimestamp),
    end_timestamp: String(endTimestamp),
    resolution: "3600"
  });
  const payload = await fetchJson(`${deribitVolatilityEndpoint}?${params.toString()}`);
  const rows = isRecord(payload) && isRecord(payload.result) && Array.isArray(payload.result.data)
    ? payload.result.data
    : [];
  const points = rows.map(parseDeribitVolatilityRow).filter((point): point is DeribitVolatilityPoint => Boolean(point));

  if (!points.length) return null;

  points.sort((left, right) => {
    const leftTime = left.timestamp ? Date.parse(left.timestamp) : 0;
    const rightTime = right.timestamp ? Date.parse(right.timestamp) : 0;
    return leftTime - rightTime;
  });

  const latest = points[points.length - 1];
  const previous = points.length > 1 ? points[points.length - 2] : null;

  return {
    close: latest.close,
    previousClose: previous?.close ?? null,
    timestamp: latest.timestamp
  };
}

function parseDeribitVolatilityRow(row: unknown): DeribitVolatilityPoint | null {
  if (Array.isArray(row)) {
    const close = parseNumberish(row[4] ?? row[1]);
    if (close === null) return null;

    return {
      close,
      previousClose: null,
      timestamp: toIsoTimestamp(row[0])
    };
  }

  if (isRecord(row)) {
    const close = firstNumber(row, ["close", "c", "value"]);
    if (close === null) return null;

    return {
      close,
      previousClose: null,
      timestamp: firstTimestamp(row)
    };
  }

  return null;
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}.`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function unavailableFearGreed(error: unknown): FearGreedIndex {
  const fallback = createUnavailableMarketIndices(readError(error));
  return fallback.fearGreed;
}

function unavailableLongShort(error: unknown): LongShortIndex {
  const fallback = createUnavailableMarketIndices(readError(error));
  return fallback.longShort;
}

function unavailableVolatility(error: unknown): VolatilityIndex {
  const fallback = createUnavailableMarketIndices(readError(error));
  return fallback.volatility;
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

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = parseNumberish(record[key]);
    if (value !== null) return value;
  }

  return null;
}

function parseNumberish(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const numericValue = Number(value.replace("%", "").trim());
  return Number.isFinite(numericValue) ? numericValue : null;
}

function firstTimestamp(record: Record<string, unknown>): string | null {
  for (const key of ["timestamp", "time", "t", "createdAt", "createTime", "date"]) {
    const timestamp = toIsoTimestamp(record[key]);
    if (timestamp) return timestamp;
  }

  return null;
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value);
    const date = Number.isFinite(numericValue)
      ? new Date(numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue)
      : new Date(value);

    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function newestIso(values: Array<string | null>): string | null {
  return values.reduce<string | null>((newest, value) => {
    if (!value) return newest;
    if (!newest) return value;
    return Date.parse(value) > Date.parse(newest) ? value : newest;
  }, null);
}

function newestTimestampedRecord(rows: Array<Record<string, unknown>>): Record<string, unknown> | null {
  return rows.reduce<Record<string, unknown> | null>((newest, row) => {
    const timestamp = firstTimestamp(row);
    if (!timestamp) return newest;
    if (!newest) return row;

    const newestTimestamp = firstTimestamp(newest);
    return !newestTimestamp || Date.parse(timestamp) > Date.parse(newestTimestamp) ? row : newest;
  }, null);
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Market index data unavailable.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
