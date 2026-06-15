import {
  createUnavailableMarketIndices,
  defaultLongShortExchanges,
  getFearGreedBand,
  normalizeLongShortPercentPair,
  ratioToLongShortPercent,
  roundTo,
  type FearGreedIndex,
  type LongShortIndex,
  type MarketIndicesResponse,
  type VolatilityIndex
} from "./marketIndexMath";
import { supabase } from "./supabase";

const clientCacheMs = 5 * 60 * 1000;
const fearGreedEndpoint = "https://api.alternative.me/fng/?limit=1&format=json";
const binanceLongShortEndpoint =
  "https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1";
const deribitVolatilityEndpoint = "https://www.deribit.com/api/v2/public/get_volatility_index_data";

let clientMarketIndicesCache: { expiresAt: number; data: MarketIndicesResponse } | null = null;

export async function fetchMarketIndices(): Promise<MarketIndicesResponse> {
  if (clientMarketIndicesCache && clientMarketIndicesCache.expiresAt > Date.now()) {
    return clientMarketIndicesCache.data;
  }

  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke("market-indices", {
        body: {}
      });

      if (!error) {
        return cacheMarketIndices(normalizeMarketIndicesResponse(data));
      }
    } catch {
      // Public fallback below keeps the charts page useful when the function is not deployed yet.
    }
  }

  return cacheMarketIndices(await fetchPublicMarketIndices());
}

function normalizeMarketIndicesResponse(data: unknown): MarketIndicesResponse {
  if (!isRecord(data)) {
    return createUnavailableMarketIndices("Market index response was malformed.");
  }

  const fallback = createUnavailableMarketIndices("Market index data unavailable.");
  const fearGreed = isRecord(data.fearGreed) ? data.fearGreed : fallback.fearGreed;
  const longShort = isRecord(data.longShort) ? data.longShort : fallback.longShort;
  const volatility = isRecord(data.volatility) ? data.volatility : fallback.volatility;

  return {
    generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : fallback.generatedAt,
    fearGreed: {
      ...fallback.fearGreed,
      ...fearGreed,
      source: "Alternative.me"
    },
    longShort: {
      ...fallback.longShort,
      ...longShort,
      includedExchanges: Array.isArray(longShort.includedExchanges) ? longShort.includedExchanges.map(String) : [],
      requestedExchanges: Array.isArray(longShort.requestedExchanges)
        ? longShort.requestedExchanges.map(String)
        : fallback.longShort.requestedExchanges
    },
    volatility: {
      ...fallback.volatility,
      ...volatility,
      source: "Deribit"
    }
  } as MarketIndicesResponse;
}

async function fetchPublicMarketIndices(): Promise<MarketIndicesResponse> {
  const fallback = createUnavailableMarketIndices("Live market index data is temporarily unavailable.");
  const [fearGreed, longShort, volatility] = await Promise.all([
    fetchPublicFearGreed().catch(() => fallback.fearGreed),
    fetchPublicBinanceLongShort().catch(() => fallback.longShort),
    fetchPublicVolatility().catch(() => fallback.volatility)
  ]);

  return {
    generatedAt: new Date().toISOString(),
    fearGreed,
    longShort,
    volatility
  };
}

async function fetchPublicFearGreed(): Promise<FearGreedIndex> {
  const payload = await fetchJson(fearGreedEndpoint);
  const row = isRecord(payload) && Array.isArray(payload.data) ? payload.data.find(isRecord) : null;
  const value = parseNumberish(row?.value);

  if (value === null) {
    throw new Error("Fear & Greed data unavailable.");
  }

  const score = Math.round(Math.min(100, Math.max(0, value)));
  const classification =
    typeof row?.value_classification === "string" ? row.value_classification : getFearGreedBand(score).label;

  return {
    status: "ready",
    value: score,
    classification,
    timestamp: toIsoTimestamp(row?.timestamp),
    timeUntilUpdate: parseNumberish(row?.time_until_update),
    source: "Alternative.me"
  };
}

async function fetchPublicBinanceLongShort(): Promise<LongShortIndex> {
  const payload = await fetchJson(binanceLongShortEndpoint);
  const row = Array.isArray(payload) ? payload.find(isRecord) : null;

  if (!row) {
    throw new Error("Binance long/short data unavailable.");
  }

  const direct = normalizeLongShortPercentPair(
    firstNumber(row, ["longAccount", "longAccountRatio", "longPct"]),
    firstNumber(row, ["shortAccount", "shortAccountRatio", "shortPct"])
  );
  const fromRatio = direct ?? ratioToLongShortPercent(firstNumber(row, ["longShortRatio", "ratio"]));

  if (!fromRatio) {
    throw new Error("Binance long/short data unavailable.");
  }

  return {
    status: "ready",
    longPct: roundTo(fromRatio.longPct, 2),
    shortPct: roundTo(fromRatio.shortPct, 2),
    mode: "binance-only",
    includedExchanges: ["Binance"],
    requestedExchanges: defaultLongShortExchanges,
    timestamp: firstTimestamp(row),
    source: "Binance"
  };
}

async function fetchPublicVolatility(): Promise<VolatilityIndex> {
  const [btc, eth] = await Promise.all([
    fetchDeribitVolatility("BTC").catch(() => null),
    fetchDeribitVolatility("ETH").catch(() => null)
  ]);
  const validRows = [btc, eth].filter((row): row is DeribitVolatilityPoint => Boolean(row));

  if (!validRows.length) {
    throw new Error("Deribit volatility data unavailable.");
  }

  const value = average(validRows.map((row) => row.close));
  const previous = average(validRows.map((row) => row.previousClose).filter((item): item is number => item !== null));
  const changePct = previous && previous > 0 ? ((value - previous) / previous) * 100 : null;

  return {
    status: "ready",
    value: roundTo(value, 1),
    btc: btc ? roundTo(btc.close, 1) : null,
    eth: eth ? roundTo(eth.close, 1) : null,
    basis: btc && eth ? "BTC/ETH DVOL average" : btc ? "BTC DVOL" : "ETH DVOL",
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
  const rows =
    isRecord(payload) && isRecord(payload.result) && Array.isArray(payload.result.data) ? payload.result.data : [];
  const points = rows.map(parseDeribitVolatilityRow).filter((point): point is DeribitVolatilityPoint => Boolean(point));

  if (!points.length) return null;

  points.sort((left, right) => Date.parse(left.timestamp ?? "") - Date.parse(right.timestamp ?? ""));
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

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Market data request failed.");
  }

  return response.json();
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

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function cacheMarketIndices(data: MarketIndicesResponse): MarketIndicesResponse {
  clientMarketIndicesCache = {
    data,
    expiresAt: Date.now() + clientCacheMs
  };

  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
