export interface DemoTradeCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DemoTradeTicker {
  symbol: "BTCUSDT";
  price: number;
  timestamp: string;
  source: string;
}

export interface DemoTradePriceStream {
  close: () => void;
}

export type DemoTradeTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "6h" | "12h" | "1d" | "1w" | "1M";

export interface DemoTradeCandleResult {
  candles: DemoTradeCandle[];
  source: string;
  isCached: boolean;
}

export interface DemoTradeMarketSnapshot {
  candles: DemoTradeCandle[];
  ticker: DemoTradeTicker;
  candleSource: string;
  source: string;
  isCached: boolean;
}

export const demoTradeTimeframes: Array<{ value: DemoTradeTimeframe; label: string }> = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "6h", label: "6H" },
  { value: "12h", label: "12H" },
  { value: "1d", label: "D" },
  { value: "1w", label: "W" },
  { value: "1M", label: "M" }
];

export const demoTradeSymbols = [
  {
    symbol: "BTCUSDT" as const,
    label: "BTC/USDT",
    baseAsset: "BTC",
    quoteAsset: "USDT"
  }
];

const binanceUsBaseUrl = "https://api.binance.us/api/v3";
const binanceBaseUrl = "https://api.binance.com/api/v3";
const binanceUsStreamBaseUrl = "wss://stream.binance.us:9443/ws";
const coinbaseExchangeBaseUrl = "https://api.exchange.coinbase.com";
const coinbaseSpotPriceUrl = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const fetchTimeoutMs = 6000;
const demoTradeMarketCacheKey = "aseke-demo-trade-market-cache-v1";
const demoTradeMarketCacheMaxAgeMs = 24 * 60 * 60 * 1000;

interface DemoTradeCachedMarketData {
  version: 1;
  symbol: "BTCUSDT";
  ticker?: CachedTicker;
  candles?: Partial<Record<DemoTradeTimeframe, CachedCandles>>;
}

interface CachedTicker {
  price: number;
  timestamp: string;
  source: string;
  savedAt: number;
}

interface CachedCandles {
  candles: DemoTradeCandle[];
  source: string;
  savedAt: number;
}

interface RestProvider<T> {
  key: string;
  source: string;
  load: () => Promise<T>;
}

interface CoinbaseCandlePlan {
  granularity: 60 | 300 | 900 | 3600 | 21600 | 86400;
  aggregateTo?: DemoTradeTimeframe;
}

let preferredTickerProviderKey: string | null = null;
let preferredCandleProviderKey: string | null = null;

export async function fetchDemoTradeCandles(
  symbol = "BTCUSDT",
  timeframe: DemoTradeTimeframe = "1h",
  limit = 140
): Promise<DemoTradeCandle[]> {
  const result = await fetchDemoTradeCandleResult(symbol, timeframe, limit);
  return result.candles;
}

export async function fetchDemoTradeCandleResult(
  symbol = "BTCUSDT",
  timeframe: DemoTradeTimeframe = "1h",
  limit = 140
): Promise<DemoTradeCandleResult> {
  const safeSymbol = normalizeDemoSymbol(symbol);
  const safeLimit = normalizeCandleLimit(limit);
  const providers = buildCandleProviders(safeSymbol, timeframe, safeLimit);

  try {
    const result = await fetchFromProviders(providers, preferredCandleProviderKey, (providerKey) => {
      preferredCandleProviderKey = providerKey;
    });
    writeCachedCandles(timeframe, result.candles, result.source);
    return { ...result, isCached: false };
  } catch (error) {
    const cached = readCachedCandles(timeframe);
    if (cached) {
      return {
        candles: cached.candles,
        source: `${cached.source} cached`,
        isCached: true
      };
    }
    throw new Error(error instanceof Error ? error.message : "BTC candle data is unavailable.");
  }
}

export async function fetchDemoTradeTicker(symbol = "BTCUSDT"): Promise<DemoTradeTicker> {
  const safeSymbol = normalizeDemoSymbol(symbol);
  const providers = buildTickerProviders(safeSymbol);

  try {
    const ticker = await fetchFromProviders(providers, preferredTickerProviderKey, (providerKey) => {
      preferredTickerProviderKey = providerKey;
    });
    writeCachedTicker(ticker);
    return ticker;
  } catch (error) {
    const cached = readCachedTicker();
    if (cached) {
      return {
        symbol: "BTCUSDT",
        price: cached.price,
        timestamp: cached.timestamp,
        source: `${cached.source} cached`
      };
    }
    throw new Error(error instanceof Error ? error.message : "BTC price data is unavailable.");
  }
}

export async function fetchDemoTradeMarketSnapshot(
  symbol = "BTCUSDT",
  timeframe: DemoTradeTimeframe = "1h",
  limit = 140
): Promise<DemoTradeMarketSnapshot> {
  const [candleResult, ticker] = await Promise.all([
    fetchDemoTradeCandleResult(symbol, timeframe, limit),
    fetchDemoTradeTicker(symbol)
  ]);
  const source = formatSnapshotSource(ticker.source, candleResult.source);
  return {
    candles: candleResult.candles,
    ticker,
    candleSource: candleResult.source,
    source,
    isCached: candleResult.isCached || ticker.source.includes(" cached")
  };
}

export function subscribeDemoTradePriceStream(
  symbol: string,
  onTicker: (ticker: DemoTradeTicker) => void,
  onError?: () => void
): DemoTradePriceStream | null {
  if (typeof WebSocket === "undefined") return null;

  const safeSymbol = normalizeDemoSymbol(symbol);
  const socket = new WebSocket(`${binanceUsStreamBaseUrl}/${safeSymbol.toLowerCase()}@trade`);
  let isClosedByCaller = false;

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as unknown;
      if (!isRecord(payload)) return;

      const price = Number(payload.p);
      const tradeTime = Number(payload.T);
      if (!Number.isFinite(price) || price <= 0) return;

      onTicker({
        symbol: "BTCUSDT",
        price,
        timestamp: Number.isFinite(tradeTime) ? new Date(tradeTime).toISOString() : new Date().toISOString(),
        source: "Binance.US live trade stream"
      });
    } catch {
      onError?.();
    }
  };

  socket.onerror = () => {
    if (!isClosedByCaller) onError?.();
  };

  socket.onclose = () => {
    if (!isClosedByCaller) onError?.();
  };

  return {
    close: () => {
      isClosedByCaller = true;
      socket.close();
    }
  };
}

function normalizeDemoSymbol(symbol: string): "BTCUSDT" {
  const normalized = symbol.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (normalized !== "BTCUSDT") throw new Error("BTC/USDT is the only supported demo pair for v1.");
  return "BTCUSDT";
}

function buildTickerProviders(symbol: "BTCUSDT"): Array<RestProvider<DemoTradeTicker>> {
  return [
    {
      key: "binance-us",
      source: "Binance.US public market data",
      load: () => fetchBinanceTicker(binanceUsBaseUrl, "Binance.US public market data", symbol)
    },
    {
      key: "binance-global",
      source: "Binance public market data",
      load: () => fetchBinanceTicker(binanceBaseUrl, "Binance public market data", symbol)
    },
    {
      key: "coinbase-exchange",
      source: "Coinbase Exchange public market data",
      load: fetchCoinbaseExchangeTicker
    },
    {
      key: "coinbase-spot",
      source: "Coinbase public spot price",
      load: fetchCoinbaseSpotTicker
    }
  ];
}

function buildCandleProviders(
  symbol: "BTCUSDT",
  timeframe: DemoTradeTimeframe,
  limit: number
): Array<RestProvider<DemoTradeCandleResult>> {
  return [
    {
      key: "binance-us",
      source: "Binance.US public market data",
      load: async () => ({
        candles: await fetchBinanceCandles(binanceUsBaseUrl, symbol, timeframe, limit),
        source: "Binance.US public market data",
        isCached: false
      })
    },
    {
      key: "binance-global",
      source: "Binance public market data",
      load: async () => ({
        candles: await fetchBinanceCandles(binanceBaseUrl, symbol, timeframe, limit),
        source: "Binance public market data",
        isCached: false
      })
    },
    {
      key: "coinbase-exchange",
      source: "Coinbase Exchange public market data",
      load: async () => ({
        candles: await fetchCoinbaseCandles(timeframe, limit),
        source: "Coinbase Exchange public market data",
        isCached: false
      })
    }
  ];
}

async function fetchFromProviders<T>(
  providers: Array<RestProvider<T>>,
  preferredProviderKey: string | null,
  onSuccess: (providerKey: string) => void
): Promise<T> {
  const errors: string[] = [];

  for (const provider of orderProviders(providers, preferredProviderKey)) {
    try {
      const result = await provider.load();
      onSuccess(provider.key);
      return result;
    } catch (error) {
      errors.push(`${provider.source}: ${error instanceof Error ? error.message : "unavailable"}`);
    }
  }

  throw new Error(`BTC market data could not be loaded from backup providers. ${errors.join(" ")}`);
}

function orderProviders<T>(providers: Array<RestProvider<T>>, preferredProviderKey: string | null): Array<RestProvider<T>> {
  if (!preferredProviderKey) return providers;
  const preferredProvider = providers.find((provider) => provider.key === preferredProviderKey);
  if (!preferredProvider) return providers;
  return [preferredProvider, ...providers.filter((provider) => provider.key !== preferredProviderKey)];
}

async function fetchBinanceTicker(baseUrl: string, source: string, symbol: "BTCUSDT"): Promise<DemoTradeTicker> {
  const payload = await fetchJson(`${baseUrl}/ticker/price?symbol=${symbol}`, { cache: "no-store" });

  if (!isRecord(payload)) throw new Error("BTC price data was malformed.");
  const price = Number(payload.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("BTC price data is unavailable.");

  return {
    symbol: "BTCUSDT",
    price,
    timestamp: new Date().toISOString(),
    source
  };
}

async function fetchBinanceCandles(
  baseUrl: string,
  symbol: "BTCUSDT",
  timeframe: DemoTradeTimeframe,
  limit: number
): Promise<DemoTradeCandle[]> {
  const url = `${baseUrl}/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`;
  const payload = await fetchJson(url);

  if (!Array.isArray(payload)) throw new Error("BTC candle data was malformed.");

  const candles = payload.map(normalizeKline).filter((candle): candle is DemoTradeCandle => candle !== null);
  if (!candles.length) throw new Error("BTC candle data is unavailable.");
  return candles;
}

async function fetchCoinbaseExchangeTicker(): Promise<DemoTradeTicker> {
  const payload = await fetchJson(`${coinbaseExchangeBaseUrl}/products/BTC-USD/ticker`, { cache: "no-store" });

  if (!isRecord(payload)) throw new Error("BTC price data was malformed.");
  const price = Number(payload.price);
  const timestamp = typeof payload.time === "string" ? payload.time : new Date().toISOString();
  if (!Number.isFinite(price) || price <= 0) throw new Error("BTC price data is unavailable.");

  return {
    symbol: "BTCUSDT",
    price,
    timestamp,
    source: "Coinbase Exchange public market data"
  };
}

async function fetchCoinbaseSpotTicker(): Promise<DemoTradeTicker> {
  const payload = await fetchJson(coinbaseSpotPriceUrl, { cache: "no-store" });
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;

  if (!data) throw new Error("BTC price data was malformed.");
  const price = Number(data.amount);
  if (!Number.isFinite(price) || price <= 0) throw new Error("BTC price data is unavailable.");

  return {
    symbol: "BTCUSDT",
    price,
    timestamp: new Date().toISOString(),
    source: "Coinbase public spot price"
  };
}

async function fetchCoinbaseCandles(timeframe: DemoTradeTimeframe, limit: number): Promise<DemoTradeCandle[]> {
  const plan = coinbaseCandlePlans[timeframe];
  const rawLimit = plan.aggregateTo ? Math.min(300, limit * rawCandleMultiplier(plan.aggregateTo)) : limit;
  const url = `${coinbaseExchangeBaseUrl}/products/BTC-USD/candles?granularity=${plan.granularity}`;
  const payload = await fetchJson(url);

  if (!Array.isArray(payload)) throw new Error("BTC candle data was malformed.");

  const rawCandles = payload
    .slice(0, Math.max(rawLimit, limit))
    .map(normalizeCoinbaseCandle)
    .filter((candle): candle is DemoTradeCandle => candle !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
  const candles = plan.aggregateTo ? aggregateCandles(rawCandles, plan.aggregateTo) : rawCandles;
  const limitedCandles = candles.slice(-limit);

  if (!limitedCandles.length) throw new Error("BTC candle data is unavailable.");
  return limitedCandles;
}

const coinbaseCandlePlans: Record<DemoTradeTimeframe, CoinbaseCandlePlan> = {
  "1m": { granularity: 60 },
  "5m": { granularity: 300 },
  "15m": { granularity: 900 },
  "1h": { granularity: 3600 },
  "4h": { granularity: 3600, aggregateTo: "4h" },
  "6h": { granularity: 21600 },
  "12h": { granularity: 21600, aggregateTo: "12h" },
  "1d": { granularity: 86400 },
  "1w": { granularity: 86400, aggregateTo: "1w" },
  "1M": { granularity: 86400, aggregateTo: "1M" }
};

function normalizeKline(row: unknown): DemoTradeCandle | null {
  if (!Array.isArray(row) || row.length < 6) return null;

  const timestamp = Number(row[0]);
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const volume = Number(row[5]);

  if (![timestamp, open, high, low, close, volume].every(Number.isFinite)) return null;
  return { timestamp, open, high, low, close, volume };
}

function normalizeCoinbaseCandle(row: unknown): DemoTradeCandle | null {
  if (!Array.isArray(row) || row.length < 6) return null;

  const timestamp = Number(row[0]) * 1000;
  const low = Number(row[1]);
  const high = Number(row[2]);
  const open = Number(row[3]);
  const close = Number(row[4]);
  const volume = Number(row[5]);

  if (![timestamp, open, high, low, close, volume].every(Number.isFinite)) return null;
  return { timestamp, open, high, low, close, volume };
}

function aggregateCandles(candles: DemoTradeCandle[], timeframe: DemoTradeTimeframe): DemoTradeCandle[] {
  const buckets = new Map<number, DemoTradeCandle>();

  for (const candle of candles) {
    const timestamp = getCandleBucketStart(candle.timestamp, timeframe);
    const bucket = buckets.get(timestamp);
    if (!bucket) {
      buckets.set(timestamp, { ...candle, timestamp });
      continue;
    }

    bucket.high = Math.max(bucket.high, candle.high);
    bucket.low = Math.min(bucket.low, candle.low);
    bucket.close = candle.close;
    bucket.volume += candle.volume;
  }

  return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function getCandleBucketStart(timestamp: number, timeframe: DemoTradeTimeframe): number {
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();

  if (timeframe === "1M") {
    const date = new Date(safeTimestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }

  if (timeframe === "1w") {
    const date = new Date(safeTimestamp);
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
  }

  const duration = demoTimeframeDurationMs[timeframe] ?? demoTimeframeDurationMs["1h"];
  return Math.floor(safeTimestamp / duration) * duration;
}

function rawCandleMultiplier(timeframe: DemoTradeTimeframe): number {
  if (timeframe === "4h") return 4;
  if (timeframe === "12h") return 2;
  if (timeframe === "1w") return 7;
  if (timeframe === "1M") return 31;
  return 1;
}

function normalizeCandleLimit(limit: number): number {
  return Math.min(Math.max(Math.round(limit), 40), 240);
}

function formatSnapshotSource(tickerSource: string, candleSource: string): string {
  if (tickerSource === candleSource) return tickerSource;
  if (tickerSource.replace(" cached", "") === candleSource.replace(" cached", "")) return tickerSource;
  return `${tickerSource}; chart ${candleSource}`;
}

function writeCachedTicker(ticker: DemoTradeTicker): void {
  const cache = readMarketCache() ?? createEmptyMarketCache();
  cache.ticker = {
    price: ticker.price,
    timestamp: ticker.timestamp,
    source: ticker.source,
    savedAt: Date.now()
  };
  writeMarketCache(cache);
}

function writeCachedCandles(timeframe: DemoTradeTimeframe, candles: DemoTradeCandle[], source: string): void {
  const cache = readMarketCache() ?? createEmptyMarketCache();
  cache.candles = {
    ...(cache.candles ?? {}),
    [timeframe]: {
      candles: candles.slice(-240),
      source,
      savedAt: Date.now()
    }
  };
  writeMarketCache(cache);
}

function readCachedTicker(): CachedTicker | null {
  const ticker = readMarketCache()?.ticker;
  if (!ticker || !isFreshCacheEntry(ticker.savedAt)) return null;
  if (!Number.isFinite(ticker.price) || ticker.price <= 0) return null;
  return ticker;
}

function readCachedCandles(timeframe: DemoTradeTimeframe): CachedCandles | null {
  const candles = readMarketCache()?.candles?.[timeframe];
  if (!candles || !isFreshCacheEntry(candles.savedAt)) return null;
  const validCandles = candles.candles.filter(isValidCandle);
  if (!validCandles.length) return null;
  return { ...candles, candles: validCandles };
}

function readMarketCache(): DemoTradeCachedMarketData | null {
  if (typeof window === "undefined" || !window.localStorage) return null;

  try {
    const rawCache = window.localStorage.getItem(demoTradeMarketCacheKey);
    if (!rawCache) return null;
    const cache = JSON.parse(rawCache) as unknown;
    if (!isRecord(cache) || cache.version !== 1 || cache.symbol !== "BTCUSDT") return null;
    return cache as unknown as DemoTradeCachedMarketData;
  } catch {
    return null;
  }
}

function writeMarketCache(cache: DemoTradeCachedMarketData): void {
  if (typeof window === "undefined" || !window.localStorage) return;

  try {
    window.localStorage.setItem(demoTradeMarketCacheKey, JSON.stringify(cache));
  } catch {
    // Cache writes are best-effort; live market data should continue without storage.
  }
}

function createEmptyMarketCache(): DemoTradeCachedMarketData {
  return {
    version: 1,
    symbol: "BTCUSDT",
    candles: {}
  };
}

function isFreshCacheEntry(savedAt: number): boolean {
  return Number.isFinite(savedAt) && Date.now() - savedAt <= demoTradeMarketCacheMaxAgeMs;
}

function isValidCandle(candle: DemoTradeCandle): boolean {
  return [candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite);
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), fetchTimeoutMs) : null;

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller?.signal
    });
    if (!response.ok) throw new Error(`BTC market data request failed with ${response.status}.`);
    return response.json() as Promise<unknown>;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const demoTimeframeDurationMs: Record<Exclude<DemoTradeTimeframe, "1M" | "1w">, number> = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000
};
