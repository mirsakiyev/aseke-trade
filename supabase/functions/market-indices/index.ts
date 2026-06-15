import {
  buildBinanceFallbackLongShortIndex,
  buildMajorLongShortIndex,
  buildSingleExchangeLongShortIndex,
  createUnavailableMarketIndices,
  defaultLongShortExchanges,
  getFearGreedBand,
  majorLongShortSelection,
  normalizeLongShortPercentPair,
  normalizeLongShortExchangeSelection,
  ratioToLongShortPercent,
  roundTo,
  type FearGreedIndex,
  type LongShortExchangeInput,
  type LongShortExchangeSelection,
  type LongShortIndex,
  type MarketIndicesResponse,
  type VolatilityIndex
} from "../../../src/lib/marketIndexMath.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

const cacheMs = 5 * 60 * 1000;
const requestTimeoutMs = 8000;
const longShortSymbol = "BTCUSDT";
const longShortInterval = "5m";
const coinglassEndpoint =
  "https://open-api-v4.coinglass.com/api/futures/global-long-short-account-ratio/history";
const binanceLongShortEndpoint = "https://fapi.binance.com/futures/data/globalLongShortAccountRatio";
const fearGreedEndpoint = "https://api.alternative.me/fng/?limit=1&format=json";
const deribitVolatilityEndpoint = "https://www.deribit.com/api/v2/public/get_volatility_index_data";

const cachedPayloads = new Map<string, { expiresAt: number; payload: MarketIndicesResponse }>();

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST" && request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed.", code: "method_not_allowed" }, 405);
  }

  const selectedExchange = await readLongShortSelection(request);
  const cacheKey = `long-short:${selectedExchange}`;
  const cachedPayload = cachedPayloads.get(cacheKey);

  if (cachedPayload && cachedPayload.expiresAt > Date.now()) {
    return jsonResponse(cachedPayload.payload);
  }

  const [fearGreed, longShort, volatility] = await Promise.all([
    fetchFearGreedIndex().catch((error) => unavailableFearGreed(error)),
    fetchLongShortIndex(selectedExchange).catch((error) => unavailableLongShort(error, selectedExchange)),
    fetchVolatilityIndex().catch((error) => unavailableVolatility(error))
  ]);

  const payload: MarketIndicesResponse = {
    fearGreed,
    longShort,
    volatility,
    generatedAt: new Date().toISOString()
  };

  cachedPayloads.set(cacheKey, {
    expiresAt: Date.now() + cacheMs,
    payload
  });

  return jsonResponse(payload);
});

async function fetchFearGreedIndex(): Promise<FearGreedIndex> {
  const payload = await fetchJson(fearGreedEndpoint);
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

async function fetchLongShortIndex(selectedExchange: LongShortExchangeSelection): Promise<LongShortIndex> {
  const apiKey = Deno.env.get("COINGLASS_API_KEY")?.trim();

  if (!apiKey) {
    return selectedExchange === majorLongShortSelection || selectedExchange === "Binance"
      ? fetchBinanceLongShortIndex({
          error: "Add COINGLASS_API_KEY to enable multi-exchange data."
        })
      : {
          ...unavailableLongShort("Add COINGLASS_API_KEY to enable multi-exchange data.", selectedExchange, {
            availableExchanges: ["Binance"],
            failedExchanges: defaultLongShortExchanges.filter((exchange) => exchange !== "Binance")
          })
        };
  }

  if (selectedExchange !== majorLongShortSelection) {
    const row = await fetchCoinGlassExchangeLongShort(selectedExchange, apiKey);
    const singleExchange = row ? buildSingleExchangeLongShortIndex(row) : null;

    if (singleExchange) {
      return singleExchange;
    }

    if (selectedExchange === "Binance") {
      return fetchBinanceLongShortIndex({
        availableExchanges: defaultLongShortExchanges,
        error: "CoinGlass Binance data unavailable. Showing Binance public fallback."
      });
    }

    return unavailableLongShort(`CoinGlass ${selectedExchange} long/short data unavailable.`, selectedExchange, {
      availableExchanges: defaultLongShortExchanges,
      failedExchanges: [selectedExchange]
    });
  }

  const exchangeRows = await Promise.all(
    defaultLongShortExchanges.map(async (exchange) => {
      try {
        return await fetchCoinGlassExchangeLongShort(exchange, apiKey);
      } catch {
        return null;
      }
    })
  );

  const validRows = exchangeRows.filter((row): row is LongShortExchangeInput => Boolean(row));
  const aggregate = buildMajorLongShortIndex(validRows);

  if (aggregate) {
    return aggregate;
  }

  if (validRows.length === 1) {
    const singleExchange = buildSingleExchangeLongShortIndex(validRows[0]);
    if (singleExchange) return singleExchange;
  }

  return fetchBinanceLongShortIndex({
    availableExchanges: defaultLongShortExchanges,
    error: "CoinGlass average unavailable. Showing Binance public fallback."
  }).catch(() =>
    unavailableLongShort("CoinGlass long/short data unavailable.", majorLongShortSelection, {
      availableExchanges: defaultLongShortExchanges,
      failedExchanges: defaultLongShortExchanges
    })
  );
}

async function fetchCoinGlassExchangeLongShort(
  exchange: string,
  apiKey: string
): Promise<LongShortExchangeInput | null> {
  const params = new URLSearchParams({
    exchange,
    symbol: longShortSymbol,
    interval: longShortInterval,
    limit: "1"
  });
  const payload = await fetchJson(`${coinglassEndpoint}?${params.toString()}`, {
    headers: {
      accept: "application/json",
      "CG-API-KEY": apiKey
    }
  });
  const record = findLongShortRecord(payload);

  if (!record) {
    return null;
  }

  return {
    exchange,
    longPct: firstNumber(record, [
      "longAccount",
      "longAccountRatio",
      "longRate",
      "longRatio",
      "longPct",
      "longPercent",
      "long_percentage"
    ]),
    shortPct: firstNumber(record, [
      "shortAccount",
      "shortAccountRatio",
      "shortRate",
      "shortRatio",
      "shortPct",
      "shortPercent",
      "short_percentage"
    ]),
    longShortRatio: firstNumber(record, ["longShortRatio", "long_short_ratio", "ratio"]),
    timestamp: firstTimestamp(record)
  };
}

interface LongShortFallbackOptions {
  availableExchanges?: LongShortExchangeInput["exchange"][];
  failedExchanges?: string[];
  error?: string;
}

async function fetchBinanceLongShortIndex(options: LongShortFallbackOptions = {}): Promise<LongShortIndex> {
  const params = new URLSearchParams({
    symbol: longShortSymbol,
    period: longShortInterval,
    limit: "1"
  });
  const payload = await fetchJson(`${binanceLongShortEndpoint}?${params.toString()}`);
  const row = Array.isArray(payload) ? payload.find(isRecord) : null;

  if (!row) {
    return unavailableLongShort("Binance long/short data unavailable.", "Binance", options);
  }

  const direct = normalizeLongShortPercentPair(
    firstNumber(row, ["longAccount", "longAccountRatio", "longPct"]),
    firstNumber(row, ["shortAccount", "shortAccountRatio", "shortPct"])
  );
  const fromRatio = direct ?? ratioToLongShortPercent(firstNumber(row, ["longShortRatio", "ratio"]));

  if (!fromRatio) {
    return unavailableLongShort("Binance long/short data unavailable.", "Binance", options);
  }

  const fallback = buildBinanceFallbackLongShortIndex({
    exchange: "Binance",
    longPct: fromRatio.longPct,
    shortPct: fromRatio.shortPct,
    timestamp: firstTimestamp(row)
  }, defaultLongShortExchanges, options);

  if (!fallback) {
    return unavailableLongShort("Binance long/short data unavailable.", "Binance", options);
  }

  return fallback;
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

function unavailableLongShort(
  error: unknown,
  selectedExchange: LongShortExchangeSelection = majorLongShortSelection,
  options: LongShortFallbackOptions = {}
): LongShortIndex {
  const fallback = createUnavailableMarketIndices(readError(error), selectedExchange);
  return {
    ...fallback.longShort,
    availableExchanges: options.availableExchanges ?? defaultLongShortExchanges,
    failedExchanges:
      options.failedExchanges ??
      (selectedExchange === majorLongShortSelection
        ? defaultLongShortExchanges
        : defaultLongShortExchanges.filter((exchange) => exchange === selectedExchange)),
    error: options.error ?? fallback.longShort.error
  };
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
      "Cache-Control": `public, max-age=${Math.floor(cacheMs / 1000)}`
    }
  });
}

async function readLongShortSelection(request: Request): Promise<LongShortExchangeSelection> {
  const url = new URL(request.url);
  const querySelection = url.searchParams.get("longShortExchange");
  if (querySelection) return normalizeLongShortExchangeSelection(querySelection);

  if (request.method !== "POST") return majorLongShortSelection;

  try {
    const body = (await request.clone().json()) as { longShortExchange?: unknown };
    return normalizeLongShortExchangeSelection(body.longShortExchange);
  } catch {
    return majorLongShortSelection;
  }
}

function findLongShortRecord(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5) return null;

  if (Array.isArray(value)) {
    return value.map((item) => findLongShortRecord(item, depth + 1)).find(Boolean) ?? null;
  }

  if (!isRecord(value)) return null;

  if (
    firstNumber(value, [
      "longShortRatio",
      "long_short_ratio",
      "ratio",
      "longAccount",
      "longAccountRatio",
      "longPct",
      "longPercent"
    ]) !== null
  ) {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    const found = findLongShortRecord(nestedValue, depth + 1);
    if (found) return found;
  }

  return null;
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

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Market index data unavailable.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
