import { AI_FUTURES_LIMITS } from "../../../src/lib/aiFuturesConfig.ts";
import type {
  AiFuturesCandle,
  AiNormalizedMarketSnapshot,
  AiSourceTimestamp,
  AiSymbolFilters
} from "../../../src/lib/aiFuturesTypes.ts";

const binanceFuturesBaseUrl = "https://fapi.binance.com";
const fearGreedEndpoint = "https://api.alternative.me/fng/?limit=2&format=json";
const defaultRequestTimeoutMs = 8_000;
const defaultMaximumAttempts = 2;
const candleLimit = 260;

export interface AiMarketProviderOptions {
  now?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryCount?: number;
  maximumLeverage?: number;
  staleAfterSeconds?: Partial<{
    candles15m: number;
    candles1h: number;
    candles4h: number;
    liveMetrics: number;
    positioning: number;
    sentiment: number;
  }>;
}

interface ResolvedProviderOptions {
  timeoutMs: number;
  maximumAttempts: number;
  maximumLeverage: number;
  staleAfterSeconds: {
    candles15m: number;
    candles1h: number;
    candles4h: number;
    liveMetrics: number;
    positioning: number;
    sentiment: number;
  };
}

type ProviderJsonRequest = (url: string) => Promise<unknown>;

export async function fetchAiFuturesMarketSnapshot(
  options: AiMarketProviderOptions = {}
): Promise<AiNormalizedMarketSnapshot> {
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const providerOptions = resolveProviderOptions(options);
  const requestJson: ProviderJsonRequest = (url) => fetchJson(url, fetchImpl, providerOptions);
  const observedAt = new Date(now).toISOString();
  const [candles15m, candles1h, candles4h, premium, openInterest, globalRatio, topRatio, takerRatio, filters, sentiment] =
    await Promise.all([
      fetchCandles("15m", now, requestJson),
      fetchCandles("1h", now, requestJson),
      fetchCandles("4h", now, requestJson),
      fetchPremium(requestJson),
      fetchOpenInterest(requestJson),
      fetchPositioning("/futures/data/globalLongShortAccountRatio", requestJson),
      fetchPositioning("/futures/data/topLongShortPositionRatio", requestJson),
      fetchTakerRatio(requestJson),
      fetchSymbolFilters(requestJson, providerOptions.maximumLeverage),
      fetchFearGreed(requestJson)
    ]);

  const latest15m = candles15m[candles15m.length - 1];
  if (!latest15m) throw new AiProviderError("missing_closed_candles", "No closed 15-minute futures candle is available.");
  const sourceTimestamps: AiSourceTimestamp[] = [
    sourceTimestamp("candles_15m", "Binance USD-M Futures", latest15m.closeTime, now, providerOptions.staleAfterSeconds.candles15m),
    sourceTimestamp("candles_1h", "Binance USD-M Futures", candles1h[candles1h.length - 1]?.closeTime, now, providerOptions.staleAfterSeconds.candles1h),
    sourceTimestamp("candles_4h", "Binance USD-M Futures", candles4h[candles4h.length - 1]?.closeTime, now, providerOptions.staleAfterSeconds.candles4h),
    sourceTimestamp("mark_index_funding", "Binance USD-M Futures", premium.time, now, providerOptions.staleAfterSeconds.liveMetrics),
    sourceTimestamp("open_interest", "Binance USD-M Futures", openInterest.timestamp, now, providerOptions.staleAfterSeconds.positioning),
    sourceTimestamp("global_long_short", "Binance USD-M Futures", globalRatio.timestamp, now, providerOptions.staleAfterSeconds.positioning),
    sourceTimestamp("top_trader_long_short", "Binance USD-M Futures", topRatio.timestamp, now, providerOptions.staleAfterSeconds.positioning),
    sourceTimestamp("taker_flow", "Binance USD-M Futures", takerRatio.timestamp, now, providerOptions.staleAfterSeconds.positioning),
    sourceTimestamp("fear_greed", "Alternative.me", Date.parse(sentiment.timestamp), now, providerOptions.staleAfterSeconds.sentiment)
  ];

  return {
    symbol: "BTCUSDT",
    analysisTimeframe: "15m",
    candleCloseAt: new Date(latest15m.closeTime).toISOString(),
    capturedAt: observedAt,
    currentPrice: premium.markPrice,
    candles: { "15m": candles15m, "1h": candles1h, "4h": candles4h },
    futures: {
      markPrice: premium.markPrice,
      indexPrice: premium.indexPrice,
      fundingRate: premium.fundingRate,
      nextFundingAt: premium.nextFundingTime ? new Date(premium.nextFundingTime).toISOString() : null,
      openInterest: openInterest.current,
      openInterestChangePercent: openInterest.changePercent,
      globalLongShortRatio: globalRatio.ratio,
      topTraderLongShortRatio: topRatio.ratio,
      takerBuySellRatio: takerRatio.ratio,
      basisPercent: ((premium.markPrice - premium.indexPrice) / premium.indexPrice) * 100
    },
    sentiment,
    filters,
    sourceTimestamps,
    source: "Binance USD-M Futures"
  };
}

export async function fetchCurrentMarkPrice(fetchImpl: typeof fetch = fetch, options: Omit<AiMarketProviderOptions, "fetchImpl"> = {}): Promise<{
  price: number;
  indexPrice: number;
  timestamp: string;
}> {
  const providerOptions = resolveProviderOptions(options);
  const premium = await fetchPremium((url) => fetchJson(url, fetchImpl, providerOptions));
  return { price: premium.markPrice, indexPrice: premium.indexPrice, timestamp: new Date(premium.time).toISOString() };
}

async function fetchCandles(interval: "15m" | "1h" | "4h", now: number, requestJson: ProviderJsonRequest) {
  const query = new URLSearchParams({ symbol: "BTCUSDT", interval, limit: String(candleLimit) });
  const payload = await requestJson(`${binanceFuturesBaseUrl}/fapi/v1/klines?${query}`);
  if (!Array.isArray(payload)) throw new AiProviderError("malformed_candles", `Malformed ${interval} futures candles.`);
  const candles = payload.map(parseCandle).filter((candle): candle is AiFuturesCandle => Boolean(candle));
  if (candles.length !== payload.length) throw new AiProviderError("malformed_candles", `Malformed ${interval} futures candle row.`);
  const closed = candles.filter((candle) => candle.closeTime < now).sort((a, b) => a.openTime - b.openTime);
  if (closed.length < AI_FUTURES_LIMITS.minimumCandles) {
    throw new AiProviderError("insufficient_candles", `Binance returned too few closed ${interval} futures candles.`);
  }
  return closed;
}

function parseCandle(row: unknown): AiFuturesCandle | null {
  if (!Array.isArray(row) || row.length < 11) return null;
  const candle: AiFuturesCandle = {
    openTime: numberValue(row[0]),
    open: numberValue(row[1]),
    high: numberValue(row[2]),
    low: numberValue(row[3]),
    close: numberValue(row[4]),
    volume: numberValue(row[5]),
    closeTime: numberValue(row[6]),
    quoteVolume: numberValue(row[7]),
    takerBuyBaseVolume: numberValue(row[9]),
    takerBuyQuoteVolume: numberValue(row[10])
  };
  const values = Object.values(candle);
  if (!values.every(Number.isFinite) || candle.open <= 0 || candle.close <= 0 || candle.low <= 0 ||
    candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) ||
    candle.closeTime <= candle.openTime || candle.volume < 0) return null;
  return candle;
}

async function fetchPremium(requestJson: ProviderJsonRequest) {
  const payload = await requestJson(`${binanceFuturesBaseUrl}/fapi/v1/premiumIndex?symbol=BTCUSDT`);
  if (!isRecord(payload)) throw new AiProviderError("malformed_premium", "Malformed Binance mark/index response.");
  const markPrice = positiveNumber(payload.markPrice);
  const indexPrice = positiveNumber(payload.indexPrice);
  const fundingRate = numberValue(payload.lastFundingRate);
  const time = numberValue(payload.time);
  const nextFundingTime = numberValue(payload.nextFundingTime);
  if (!markPrice || !indexPrice || !Number.isFinite(fundingRate) || !Number.isFinite(time)) {
    throw new AiProviderError("malformed_premium", "Binance mark/index/funding data is incomplete.");
  }
  return { markPrice, indexPrice, fundingRate, time, nextFundingTime };
}

async function fetchOpenInterest(requestJson: ProviderJsonRequest) {
  const query = new URLSearchParams({ symbol: "BTCUSDT", period: "15m", limit: "5" });
  const payload = await requestJson(`${binanceFuturesBaseUrl}/futures/data/openInterestHist?${query}`);
  if (!Array.isArray(payload) || payload.length < 2) {
    throw new AiProviderError("malformed_open_interest", "Binance open-interest history is incomplete.");
  }
  const rows = payload.filter(isRecord).map((row) => ({
    value: positiveNumber(row.sumOpenInterest),
    timestamp: numberValue(row.timestamp)
  }));
  if (rows.length !== payload.length || rows.some((row) => !row.value || !Number.isFinite(row.timestamp))) {
    throw new AiProviderError("malformed_open_interest", "Binance open-interest history is malformed.");
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  return { current: last.value!, changePercent: ((last.value! - first.value!) / first.value!) * 100, timestamp: last.timestamp };
}

async function fetchPositioning(path: string, requestJson: ProviderJsonRequest) {
  const query = new URLSearchParams({ symbol: "BTCUSDT", period: "15m", limit: "1" });
  const payload = await requestJson(`${binanceFuturesBaseUrl}${path}?${query}`);
  const row = Array.isArray(payload) && isRecord(payload[0]) ? payload[0] : null;
  const ratio = row ? positiveNumber(row.longShortRatio) : null;
  const timestamp = row ? numberValue(row.timestamp) : Number.NaN;
  if (!ratio || !Number.isFinite(timestamp)) throw new AiProviderError("malformed_positioning", "Binance positioning data is malformed.");
  return { ratio, timestamp };
}

async function fetchTakerRatio(requestJson: ProviderJsonRequest) {
  const query = new URLSearchParams({ symbol: "BTCUSDT", period: "15m", limit: "1" });
  const payload = await requestJson(`${binanceFuturesBaseUrl}/futures/data/takerlongshortRatio?${query}`);
  const row = Array.isArray(payload) && isRecord(payload[0]) ? payload[0] : null;
  const ratio = row ? positiveNumber(row.buySellRatio) : null;
  const timestamp = row ? numberValue(row.timestamp) : Number.NaN;
  if (!ratio || !Number.isFinite(timestamp)) throw new AiProviderError("malformed_taker_flow", "Binance taker-flow data is malformed.");
  return { ratio, timestamp };
}

async function fetchSymbolFilters(requestJson: ProviderJsonRequest, maximumLeverage: number): Promise<AiSymbolFilters> {
  const payload = await requestJson(`${binanceFuturesBaseUrl}/fapi/v1/exchangeInfo`);
  const symbols = isRecord(payload) && Array.isArray(payload.symbols) ? payload.symbols.filter(isRecord) : [];
  const symbol = symbols.find((row) => row.symbol === "BTCUSDT");
  const filters = symbol && Array.isArray(symbol.filters) ? symbol.filters.filter(isRecord) : [];
  const price = filters.find((filter) => filter.filterType === "PRICE_FILTER");
  const lot = filters.find((filter) => filter.filterType === "LOT_SIZE");
  const notional = filters.find((filter) => filter.filterType === "MIN_NOTIONAL");
  const tickSize = stringDecimal(price?.tickSize);
  const stepSize = stringDecimal(lot?.stepSize);
  const minQuantity = stringDecimal(lot?.minQty);
  const minNotional = stringDecimal(notional?.notional);
  if (!tickSize || !stepSize || !minQuantity || !minNotional) {
    throw new AiProviderError("malformed_symbol_filters", "Binance BTCUSDT symbol filters are incomplete.");
  }
  return { tickSize, stepSize, minQuantity, minNotional, maxLeverage: maximumLeverage };
}

async function fetchFearGreed(requestJson: ProviderJsonRequest): Promise<AiNormalizedMarketSnapshot["sentiment"]> {
  const payload = await requestJson(fearGreedEndpoint);
  const row = isRecord(payload) && Array.isArray(payload.data) && isRecord(payload.data[0]) ? payload.data[0] : null;
  const value = row ? numberValue(row.value) : Number.NaN;
  const timestampSeconds = row ? numberValue(row.timestamp) : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || value > 100 || !Number.isFinite(timestampSeconds)) {
    throw new AiProviderError("malformed_sentiment", "Alternative.me Fear & Greed data is malformed.");
  }
  return {
    fearGreedValue: Math.round(value),
    fearGreedClassification: typeof row?.value_classification === "string" ? row.value_classification : "Unknown",
    source: "Alternative.me",
    sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
    timestamp: new Date(timestampSeconds * 1000).toISOString()
  };
}

async function fetchJson(url: string, fetchImpl: typeof fetch, options: ResolvedProviderOptions): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= options.maximumAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < options.maximumAttempts) {
          await boundedBackoff(response, attempt);
          continue;
        }
        throw new AiProviderError("provider_http_error", `Market provider returned HTTP ${response.status}.`, response.status);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error instanceof AiProviderError || attempt === options.maximumAttempts) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastError instanceof AiProviderError) throw lastError;
  throw new AiProviderError("provider_unavailable", "Required futures market data is unavailable.");
}

function resolveProviderOptions(options: Omit<AiMarketProviderOptions, "fetchImpl">): ResolvedProviderOptions {
  const stale = options.staleAfterSeconds ?? {};
  return {
    timeoutMs: boundedInteger(options.timeoutMs, defaultRequestTimeoutMs, 1_000, 30_000),
    maximumAttempts: boundedInteger(
      options.retryCount === undefined ? undefined : options.retryCount + 1,
      defaultMaximumAttempts,
      1,
      4
    ),
    maximumLeverage: boundedInteger(options.maximumLeverage, AI_FUTURES_LIMITS.maximumLeverage, 1, AI_FUTURES_LIMITS.maximumLeverage),
    staleAfterSeconds: {
      candles15m: positiveFiniteOr(stale.candles15m, AI_FUTURES_LIMITS.candleStaleAfterSeconds["15m"]),
      candles1h: positiveFiniteOr(stale.candles1h, AI_FUTURES_LIMITS.candleStaleAfterSeconds["1h"]),
      candles4h: positiveFiniteOr(stale.candles4h, AI_FUTURES_LIMITS.candleStaleAfterSeconds["4h"]),
      liveMetrics: positiveFiniteOr(stale.liveMetrics, AI_FUTURES_LIMITS.liveMetricStaleAfterSeconds),
      positioning: positiveFiniteOr(stale.positioning, AI_FUTURES_LIMITS.positioningStaleAfterSeconds),
      sentiment: positiveFiniteOr(stale.sentiment, AI_FUTURES_LIMITS.sentimentStaleAfterSeconds)
    }
  };
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, Number(value))) : fallback;
}

function positiveFiniteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

async function boundedBackoff(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("retry-after"));
  const delay = Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 1200) : Math.min(250 * attempt, 500);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

function sourceTimestamp(category: string, source: string, sourceMs: number | undefined, now: number, staleAfterSeconds: number): AiSourceTimestamp {
  if (!Number.isFinite(sourceMs)) throw new AiProviderError("missing_timestamp", `${category} source timestamp is missing.`);
  if (Number(sourceMs) > now + 5_000) throw new AiProviderError("future_timestamp", `${category} source timestamp is unexpectedly in the future.`);
  const ageSeconds = Math.max(0, (now - Number(sourceMs)) / 1000);
  return {
    category,
    source,
    observedAt: new Date(now).toISOString(),
    sourceAt: new Date(Number(sourceMs)).toISOString(),
    ageSeconds,
    stale: ageSeconds > staleAfterSeconds
  };
}

function stringDecimal(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return /^\d+(?:\.\d+)?$/.test(text) && Number(text) > 0 ? text : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class AiProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 502) {
    super(message);
    this.name = "AiProviderError";
  }
}
