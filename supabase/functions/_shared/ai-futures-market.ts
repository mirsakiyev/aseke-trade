import { AI_FUTURES_LIMITS } from "../../../src/lib/aiFuturesConfig.ts";
import type {
  AiFuturesCandle,
  AiMarketDataSource,
  AiMarketDataTransport,
  AiNormalizedMarketSnapshot,
  AiSourceTimestamp,
  AiSymbolFilters
} from "../../../src/lib/aiFuturesTypes.ts";

const binanceFuturesBaseUrl = "https://fapi.binance.com";
const coinglassBaseUrl = "https://open-api-v4.coinglass.com";
const fearGreedEndpoint = "https://api.alternative.me/fng/?limit=2&format=json";
const defaultRequestTimeoutMs = 8_000;
const defaultMaximumAttempts = 2;
const candleLimit = 260;
const binanceSource: AiMarketDataSource = "Binance USD-M Futures";
const coinglassSource: AiMarketDataSource = "CoinGlass API · Binance USD-M Futures";
const coinglassFilterDefaults = {
  version: "binance-btcusdt-2026-07-12",
  stepSize: "0.001",
  minQuantity: "0.001",
  minNotional: "100"
} as const;

export type AiMarketTransportMode = "auto" | "direct" | "coinglass";

export interface AiMarketProviderOptions {
  now?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryCount?: number;
  maximumLeverage?: number;
  transport?: AiMarketTransportMode;
  coinglassApiKey?: string;
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
  transport: AiMarketTransportMode;
  coinglassApiKey: string;
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

interface PremiumData {
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  time: number;
  nextFundingTime: number;
  priceKind: "exchange_mark" | "current_futures_price";
}

export async function fetchAiFuturesMarketSnapshot(
  options: AiMarketProviderOptions = {}
): Promise<AiNormalizedMarketSnapshot> {
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const providerOptions = resolveProviderOptions(options);
  if (providerOptions.transport === "coinglass") {
    return fetchCoinGlassSnapshot(now, fetchImpl, providerOptions);
  }
  try {
    return await fetchDirectBinanceSnapshot(now, fetchImpl, providerOptions);
  } catch (error) {
    if (providerOptions.transport !== "auto" || !isBinanceRestriction(error)) throw error;
    return fetchCoinGlassSnapshot(now, fetchImpl, providerOptions, 451);
  }
}

export async function fetchCurrentMarkPrice(fetchImpl: typeof fetch = fetch, options: Omit<AiMarketProviderOptions, "fetchImpl"> = {}): Promise<{
  price: number;
  indexPrice: number;
  timestamp: string;
  priceKind: "exchange_mark" | "current_futures_price";
  source: AiMarketDataSource;
  transport: AiMarketDataTransport;
  fallbackFromBinanceStatus: 451 | null;
}> {
  const providerOptions = resolveProviderOptions(options);
  const now = options.now ?? Date.now();
  if (providerOptions.transport === "coinglass") {
    return currentPriceResult(await fetchCoinGlassPremium(now, fetchImpl, providerOptions), coinglassSource, "coinglass", null);
  }
  try {
    const premium = await fetchPremium((url) => fetchJson(url, fetchImpl, providerOptions));
    return currentPriceResult(premium, binanceSource, "binance_direct", null);
  } catch (error) {
    if (providerOptions.transport !== "auto" || !isBinanceRestriction(error)) throw error;
    return currentPriceResult(await fetchCoinGlassPremium(now, fetchImpl, providerOptions), coinglassSource, "coinglass", 451);
  }
}

function currentPriceResult(
  premium: PremiumData,
  source: AiMarketDataSource,
  transport: AiMarketDataTransport,
  fallbackFromBinanceStatus: 451 | null
) {
  return {
    price: premium.markPrice,
    indexPrice: premium.indexPrice,
    timestamp: new Date(premium.time).toISOString(),
    priceKind: premium.priceKind,
    source,
    transport,
    fallbackFromBinanceStatus
  };
}

async function fetchDirectBinanceSnapshot(
  now: number,
  fetchImpl: typeof fetch,
  options: ResolvedProviderOptions
): Promise<AiNormalizedMarketSnapshot> {
  const requestJson: ProviderJsonRequest = (url) => fetchJson(url, fetchImpl, options);
  // Probe before fan-out so a region-wide HTTP 451 produces one restricted request, not nine.
  const premium = await fetchPremium(requestJson);
  const [candles15m, candles1h, candles4h, openInterest, globalRatio, topRatio, takerRatio, filters, sentiment] = await Promise.all([
    fetchCandles("15m", now, requestJson),
    fetchCandles("1h", now, requestJson),
    fetchCandles("4h", now, requestJson),
    fetchOpenInterest(requestJson),
    fetchPositioning("/futures/data/globalLongShortAccountRatio", requestJson),
    fetchPositioning("/futures/data/topLongShortPositionRatio", requestJson),
    fetchTakerRatio(requestJson),
    fetchSymbolFilters(requestJson, options.maximumLeverage),
    fetchFearGreed(requestJson)
  ]);
  return buildSnapshot({
    now,
    options,
    candles15m,
    candles1h,
    candles4h,
    premium,
    openInterest,
    globalRatio,
    topRatio,
    takerRatio,
    filters,
    sentiment,
    source: binanceSource,
    transport: "binance_direct"
  });
}

interface SnapshotParts {
  now: number;
  options: ResolvedProviderOptions;
  candles15m: AiFuturesCandle[];
  candles1h: AiFuturesCandle[];
  candles4h: AiFuturesCandle[];
  premium: PremiumData;
  openInterest: { current: number; changePercent: number; timestamp: number };
  globalRatio: { ratio: number; timestamp: number };
  topRatio: { ratio: number; timestamp: number };
  takerRatio: { ratio: number; timestamp: number };
  filters: AiSymbolFilters;
  sentiment: AiNormalizedMarketSnapshot["sentiment"];
  source: AiMarketDataSource;
  transport: AiMarketDataTransport;
  fallbackStatus?: 451;
}

function buildSnapshot(parts: SnapshotParts): AiNormalizedMarketSnapshot {
  const latest15m = parts.candles15m[parts.candles15m.length - 1];
  if (!latest15m) throw new AiProviderError("missing_closed_candles", "No closed 15-minute futures candle is available.");
  const sourceTimestamps: AiSourceTimestamp[] = [
    sourceTimestamp("candles_15m", parts.source, latest15m.closeTime, parts.now, parts.options.staleAfterSeconds.candles15m),
    sourceTimestamp("candles_1h", parts.source, parts.candles1h[parts.candles1h.length - 1]?.closeTime, parts.now, parts.options.staleAfterSeconds.candles1h),
    sourceTimestamp("candles_4h", parts.source, parts.candles4h[parts.candles4h.length - 1]?.closeTime, parts.now, parts.options.staleAfterSeconds.candles4h),
    sourceTimestamp("mark_index_funding", parts.source, parts.premium.time, parts.now, parts.options.staleAfterSeconds.liveMetrics),
    sourceTimestamp("open_interest", parts.source, parts.openInterest.timestamp, parts.now, parts.options.staleAfterSeconds.positioning),
    sourceTimestamp("global_long_short", parts.source, parts.globalRatio.timestamp, parts.now, parts.options.staleAfterSeconds.positioning),
    sourceTimestamp("top_trader_long_short", parts.source, parts.topRatio.timestamp, parts.now, parts.options.staleAfterSeconds.positioning),
    sourceTimestamp("taker_flow", parts.source, parts.takerRatio.timestamp, parts.now, parts.options.staleAfterSeconds.positioning),
    sourceTimestamp("fear_greed", "Alternative.me", Date.parse(parts.sentiment.timestamp), parts.now, parts.options.staleAfterSeconds.sentiment)
  ];
  return {
    symbol: "BTCUSDT",
    analysisTimeframe: "15m",
    candleCloseAt: new Date(latest15m.closeTime).toISOString(),
    capturedAt: new Date(parts.now).toISOString(),
    currentPrice: parts.premium.markPrice,
    candles: { "15m": parts.candles15m, "1h": parts.candles1h, "4h": parts.candles4h },
    futures: {
      markPrice: parts.premium.markPrice,
      priceKind: parts.premium.priceKind,
      indexPrice: parts.premium.indexPrice,
      fundingRate: parts.premium.fundingRate,
      nextFundingAt: parts.premium.nextFundingTime ? new Date(parts.premium.nextFundingTime).toISOString() : null,
      openInterest: parts.openInterest.current,
      openInterestChangePercent: parts.openInterest.changePercent,
      globalLongShortRatio: parts.globalRatio.ratio,
      topTraderLongShortRatio: parts.topRatio.ratio,
      takerBuySellRatio: parts.takerRatio.ratio,
      basisPercent: ((parts.premium.markPrice - parts.premium.indexPrice) / parts.premium.indexPrice) * 100
    },
    sentiment: parts.sentiment,
    filters: parts.filters,
    sourceTimestamps,
    source: parts.source,
    marketDataTransport: parts.transport,
    ...(parts.fallbackStatus === 451 ? { transportFallback: { from: "binance_direct" as const, httpStatus: 451 as const } } : {})
  };
}

async function fetchCoinGlassSnapshot(
  now: number,
  fetchImpl: typeof fetch,
  options: ResolvedProviderOptions,
  fallbackStatus?: 451
): Promise<AiNormalizedMarketSnapshot> {
  requireCoinGlassKey(options);
  // The 15m request is also an entitlement probe: the feature requires CoinGlass Standard or higher.
  const candles15m = await fetchCoinGlassCandles("15m", now, fetchImpl, options);
  const [candles1h, candles4h, premium, openInterest, globalRatio, topRatio, takerRatio, filters, sentiment] =
    await Promise.all([
      fetchCoinGlassCandles("1h", now, fetchImpl, options),
      fetchCoinGlassCandles("4h", now, fetchImpl, options),
      fetchCoinGlassPremium(now, fetchImpl, options),
      fetchCoinGlassOpenInterest(fetchImpl, options),
      fetchCoinGlassRatio("global", fetchImpl, options),
      fetchCoinGlassRatio("top_position", fetchImpl, options),
      fetchCoinGlassTakerRatio(fetchImpl, options),
      fetchCoinGlassSymbolFilters(fetchImpl, options),
      fetchFearGreed((url) => fetchJson(url, fetchImpl, options))
    ]);
  return buildSnapshot({
    now,
    options,
    candles15m,
    candles1h,
    candles4h,
    premium,
    openInterest,
    globalRatio,
    topRatio,
    takerRatio,
    filters,
    sentiment,
    source: coinglassSource,
    transport: "coinglass",
    fallbackStatus
  });
}

async function fetchCoinGlassCandles(
  interval: "15m" | "1h" | "4h",
  now: number,
  fetchImpl: typeof fetch,
  options: ResolvedProviderOptions
): Promise<AiFuturesCandle[]> {
  const data = await fetchCoinGlassData("/api/futures/price/history", {
    exchange: "Binance",
    symbol: "BTCUSDT",
    interval,
    limit: String(candleLimit)
  }, fetchImpl, options, true);
  if (!Array.isArray(data)) throw new AiProviderError("malformed_coinglass_candles", `CoinGlass returned malformed ${interval} Binance futures candles.`);
  const intervalMs = intervalMilliseconds(interval);
  const candles = data.map((row) => parseCoinGlassCandle(row, intervalMs));
  if (candles.some((candle) => !candle)) {
    throw new AiProviderError("malformed_coinglass_candles", `CoinGlass returned a malformed ${interval} Binance futures candle row.`);
  }
  const closed = (candles as AiFuturesCandle[])
    .filter((candle) => candle.closeTime < now)
    .sort((left, right) => left.openTime - right.openTime);
  if (closed.length < AI_FUTURES_LIMITS.minimumCandles) {
    throw new AiProviderError(
      "coinglass_interval_unavailable",
      `CoinGlass returned too few closed ${interval} candles. The AI Futures Analyst requires a CoinGlass Standard plan or higher for 15-minute history.`,
      503
    );
  }
  assertUniqueOrderedCandles(closed, intervalMs, `CoinGlass ${interval}`);
  return closed;
}

function parseCoinGlassCandle(value: unknown, intervalMs: number): AiFuturesCandle | null {
  if (!isRecord(value)) return null;
  const openTime = numberValue(value.time);
  const open = positiveNumber(value.open);
  const high = positiveNumber(value.high);
  const low = positiveNumber(value.low);
  const close = positiveNumber(value.close);
  const quoteVolume = nonNegativeNumber(value.volume_usd);
  if (!Number.isFinite(openTime) || openTime < 1_000_000_000_000 || !open || !high || !low || !close || quoteVolume === null ||
    high < Math.max(open, close) || low > Math.min(open, close)) return null;
  return {
    openTime,
    closeTime: openTime + intervalMs - 1,
    open,
    high,
    low,
    close,
    // CoinGlass exposes USD volume only. Base volume is a documented deterministic approximation.
    volume: quoteVolume / close,
    quoteVolume,
    takerBuyBaseVolume: 0,
    takerBuyQuoteVolume: 0
  };
}

async function fetchCoinGlassPremium(now: number, fetchImpl: typeof fetch, options: ResolvedProviderOptions): Promise<PremiumData> {
  const data = await fetchCoinGlassData("/api/futures/pairs-markets", { symbol: "BTC" }, fetchImpl, options, false);
  const row = findExactCoinGlassPair(data);
  const markPrice = row ? positiveNumber(row.current_price) : null;
  const indexPrice = row ? positiveNumber(row.index_price) : null;
  const fundingPercent = row ? numberValue(row.funding_rate) : Number.NaN;
  const nextFundingTime = row ? numberValue(row.next_funding_time) : Number.NaN;
  if (!row || !markPrice || !indexPrice || !Number.isFinite(fundingPercent) || !Number.isFinite(nextFundingTime)) {
    throw new AiProviderError("malformed_coinglass_pair", "CoinGlass did not return complete Binance BTCUSDT futures price data.");
  }
  return {
    markPrice,
    indexPrice,
    // CoinGlass documents funding values in percentage points; engine thresholds use decimal fractions.
    fundingRate: fundingPercent / 100,
    time: now,
    nextFundingTime,
    priceKind: "current_futures_price"
  };
}

async function fetchCoinGlassOpenInterest(fetchImpl: typeof fetch, options: ResolvedProviderOptions) {
  const data = await fetchCoinGlassData("/api/futures/open-interest/history", {
    exchange: "Binance",
    symbol: "BTCUSDT",
    interval: "15m",
    limit: "5",
    unit: "coin"
  }, fetchImpl, options, true);
  if (!Array.isArray(data) || data.length < 2) {
    throw new AiProviderError("malformed_coinglass_open_interest", "CoinGlass returned incomplete Binance BTCUSDT open-interest history.");
  }
  const rows = data.filter(isRecord).map((row) => ({ value: positiveNumber(row.close), timestamp: numberValue(row.time) }));
  if (rows.length !== data.length || rows.some((row) => !row.value || !validProviderTimestamp(row.timestamp))) {
    throw new AiProviderError("malformed_coinglass_open_interest", "CoinGlass returned malformed Binance BTCUSDT open-interest history.");
  }
  rows.sort((left, right) => left.timestamp - right.timestamp);
  const first = rows[0];
  const last = rows[rows.length - 1];
  return { current: last.value!, changePercent: ((last.value! - first.value!) / first.value!) * 100, timestamp: last.timestamp };
}

async function fetchCoinGlassRatio(
  kind: "global" | "top_position",
  fetchImpl: typeof fetch,
  options: ResolvedProviderOptions
) {
  const path = kind === "global"
    ? "/api/futures/global-long-short-account-ratio/history"
    : "/api/futures/top-long-short-position-ratio/history";
  const ratioKey = kind === "global" ? "global_account_long_short_ratio" : "top_position_long_short_ratio";
  const data = await fetchCoinGlassData(path, {
    exchange: "Binance",
    symbol: "BTCUSDT",
    interval: "15m",
    limit: "2"
  }, fetchImpl, options, true);
  const rows = Array.isArray(data) ? data.filter(isRecord).sort((left, right) => numberValue(left.time) - numberValue(right.time)) : [];
  const row = rows[rows.length - 1];
  const ratio = row ? positiveNumber(row[ratioKey]) : null;
  const timestamp = row ? numberValue(row.time) : Number.NaN;
  if (!ratio || !validProviderTimestamp(timestamp)) {
    throw new AiProviderError("malformed_coinglass_positioning", "CoinGlass returned malformed Binance BTCUSDT positioning data.");
  }
  return { ratio, timestamp };
}

async function fetchCoinGlassTakerRatio(fetchImpl: typeof fetch, options: ResolvedProviderOptions) {
  const data = await fetchCoinGlassData("/api/futures/v2/taker-buy-sell-volume/history", {
    exchange: "Binance",
    symbol: "BTCUSDT",
    interval: "15m",
    limit: "2"
  }, fetchImpl, options, true);
  const rows = Array.isArray(data) ? data.filter(isRecord).sort((left, right) => numberValue(left.time) - numberValue(right.time)) : [];
  const row = rows[rows.length - 1];
  const buy = row ? nonNegativeNumber(row.taker_buy_volume_usd) : null;
  const sell = row ? positiveNumber(row.taker_sell_volume_usd) : null;
  const timestamp = row ? numberValue(row.time) : Number.NaN;
  if (buy === null || !sell || !validProviderTimestamp(timestamp)) {
    throw new AiProviderError("malformed_coinglass_taker_flow", "CoinGlass returned malformed Binance BTCUSDT taker-flow data.");
  }
  return { ratio: buy / sell, timestamp };
}

async function fetchCoinGlassSymbolFilters(fetchImpl: typeof fetch, options: ResolvedProviderOptions): Promise<AiSymbolFilters> {
  const data = await fetchCoinGlassData("/api/futures/supported-exchange-pairs", { exchange: "Binance" }, fetchImpl, options, false);
  const candidates = isRecord(data) && Array.isArray(data.Binance)
    ? data.Binance.filter(isRecord)
    : Array.isArray(data) ? data.filter(isRecord) : [];
  const row = candidates.find((candidate) => candidate.instrument_id === "BTCUSDT" &&
    (candidate.exchange_name === undefined || candidate.exchange_name === "Binance"));
  const tickSize = stringDecimal(row?.price_tick_size);
  const providerMaxLeverage = positiveNumber(row?.max_leverage);
  if (!row || !tickSize || !providerMaxLeverage) {
    throw new AiProviderError("malformed_coinglass_filters", "CoinGlass did not return Binance BTCUSDT instrument metadata.");
  }
  return {
    tickSize,
    stepSize: coinglassFilterDefaults.stepSize,
    minQuantity: coinglassFilterDefaults.minQuantity,
    minNotional: coinglassFilterDefaults.minNotional,
    maxLeverage: Math.min(options.maximumLeverage, Math.floor(providerMaxLeverage))
  };
}

function findExactCoinGlassPair(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data)) throw new AiProviderError("malformed_coinglass_pair", "CoinGlass returned malformed futures pair data.");
  const exact = data.filter(isRecord).filter((row) => row.exchange_name === "Binance" && row.instrument_id === "BTCUSDT");
  if (exact.length !== 1) {
    throw new AiProviderError("coinglass_pair_mismatch", "CoinGlass did not return exactly one Binance BTCUSDT futures instrument.");
  }
  return exact[0];
}

async function fetchCoinGlassData(
  path: string,
  parameters: Record<string, string>,
  fetchImpl: typeof fetch,
  options: ResolvedProviderOptions,
  requiresStandard: boolean
): Promise<unknown> {
  const apiKey = requireCoinGlassKey(options);
  const query = new URLSearchParams(parameters);
  let payload: unknown;
  try {
    payload = await fetchJson(`${coinglassBaseUrl}${path}?${query}`, fetchImpl, options, {
      "CG-API-KEY": apiKey
    }, "coinglass");
  } catch (error) {
    if (requiresStandard && error instanceof AiProviderError && (error.upstreamStatus === 401 || error.upstreamStatus === 403)) {
      throw new AiProviderError(
        "coinglass_interval_unavailable",
        "CoinGlass rejected required intraday history. Verify the API key and a Standard plan or higher.",
        503,
        error.upstreamStatus
      );
    }
    throw error;
  }
  if (!isRecord(payload) || String(payload.code) !== "0") {
    const providerMessage = isRecord(payload) && typeof payload.msg === "string" ? payload.msg.slice(0, 180) : "request rejected";
    const planHint = requiresStandard ? " Confirm the API key has a CoinGlass Standard plan or higher for 15-minute data." : "";
    throw new AiProviderError("coinglass_api_error", `CoinGlass API error: ${providerMessage}.${planHint}`, 503);
  }
  return payload.data;
}

function requireCoinGlassKey(options: ResolvedProviderOptions): string {
  if (!options.coinglassApiKey) {
    throw new AiProviderError(
      "missing_coinglass_key",
      "CoinGlass transport requires the COINGLASS_API_KEY Edge secret.",
      503
    );
  }
  return options.coinglassApiKey;
}

function isBinanceRestriction(error: unknown): boolean {
  return error instanceof AiProviderError && error.upstreamStatus === 451;
}

function validProviderTimestamp(value: number): boolean {
  return Number.isFinite(value) && value >= 1_000_000_000_000;
}

function intervalMilliseconds(interval: "15m" | "1h" | "4h"): number {
  return interval === "15m" ? 900_000 : interval === "1h" ? 3_600_000 : 14_400_000;
}

function assertUniqueOrderedCandles(candles: AiFuturesCandle[], intervalMs: number, provider: string): void {
  for (let index = 1; index < candles.length; index += 1) {
    const delta = candles[index].openTime - candles[index - 1].openTime;
    if (delta <= 0 || delta % intervalMs !== 0) {
      throw new AiProviderError("malformed_candle_sequence", `${provider} candle history is duplicated or out of sequence.`);
    }
  }
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
  return { markPrice, indexPrice, fundingRate, time, nextFundingTime, priceKind: "exchange_mark" as const };
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

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
  options: ResolvedProviderOptions,
  extraHeaders: Record<string, string> = {},
  providerCode = "provider"
): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= options.maximumAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json", ...extraHeaders }, signal: controller.signal });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < options.maximumAttempts) {
          await boundedBackoff(response, attempt);
          continue;
        }
        const code = providerCode === "coinglass" ? "coinglass_http_error" : "provider_http_error";
        const label = providerCode === "coinglass" ? "CoinGlass" : "Market provider";
        throw new AiProviderError(code, `${label} returned HTTP ${response.status}.`, response.status, response.status);
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
  const code = providerCode === "coinglass" ? "coinglass_unavailable" : "provider_unavailable";
  const message = providerCode === "coinglass" ? "CoinGlass futures market data is unavailable." : "Required futures market data is unavailable.";
  throw new AiProviderError(code, message);
}

function resolveProviderOptions(options: Omit<AiMarketProviderOptions, "fetchImpl">): ResolvedProviderOptions {
  const stale = options.staleAfterSeconds ?? {};
  const transport = resolveTransportMode(options.transport ?? readEdgeEnvironment("AI_BINANCE_DATA_TRANSPORT") ?? "auto");
  return {
    timeoutMs: boundedInteger(options.timeoutMs, defaultRequestTimeoutMs, 1_000, 30_000),
    maximumAttempts: boundedInteger(
      options.retryCount === undefined ? undefined : options.retryCount + 1,
      defaultMaximumAttempts,
      1,
      4
    ),
    maximumLeverage: boundedInteger(options.maximumLeverage, AI_FUTURES_LIMITS.maximumLeverage, 1, AI_FUTURES_LIMITS.maximumLeverage),
    transport,
    coinglassApiKey: String(options.coinglassApiKey ?? readEdgeEnvironment("COINGLASS_API_KEY") ?? "").trim(),
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

function resolveTransportMode(value: string): AiMarketTransportMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto" || normalized === "direct" || normalized === "coinglass") return normalized;
  throw new AiProviderError(
    "invalid_market_transport",
    "AI_BINANCE_DATA_TRANSPORT must be auto, direct, or coinglass.",
    503
  );
}

function readEdgeEnvironment(name: string): string | undefined {
  const denoRuntime = (globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  }).Deno;
  return denoRuntime?.env?.get?.(name);
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

function nonNegativeNumber(value: unknown): number | null {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
    public readonly upstreamStatus: number | null = null
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
