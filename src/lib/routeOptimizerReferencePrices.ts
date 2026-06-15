import {
  createFallbackReferenceAssetPrices,
  getTradeRouteDateKey,
  tradeRouteAssets,
  type Asset,
  type ReferenceAssetPrices,
  type ReferencePriceSource
} from "./tradeRouteOptimizer";

export type RouteOptimizerReferencePriceStatus = "fresh" | "cached" | "last_known_good" | "fallback";

export interface RouteOptimizerReferencePriceBundle {
  dateKey: string;
  prices: ReferenceAssetPrices;
  source: string;
  fetchedAt: string;
  status: RouteOptimizerReferencePriceStatus;
  message?: string;
}

const serverReferencePricesEndpoint = "/api/route-optimizer-reference-prices";
const coinGeckoSimplePriceEndpoint = "https://api.coingecko.com/api/v3/simple/price";
const coinPaprikaTickerEndpoint = "https://api.coinpaprika.com/v1/tickers";
const coinCapAssetsEndpoint = "https://api.coincap.io/v2/assets";
const requestTimeoutMs = 8000;
const dailyCachePrefix = "route-optimizer-reference-prices";
const lastKnownGoodCacheKey = "route-optimizer-reference-prices-last-known-good";
const coinGeckoIds: Record<Asset, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana"
};
const coinPaprikaIds: Record<Asset, string> = {
  BTC: "btc-bitcoin",
  ETH: "eth-ethereum",
  SOL: "sol-solana"
};
const coinCapIds: Record<Asset, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana"
};

export async function getRouteOptimizerReferencePrices(date = new Date()): Promise<RouteOptimizerReferencePriceBundle> {
  const dateKey = getTradeRouteDateKey(date);
  const cached = readCachedBundle(dailyCacheKey(dateKey), dateKey);

  if (cached) {
    return {
      ...cached,
      status: "cached",
      message: cached.message ?? "Reference prices updated today."
    };
  }

  for (const fetcher of [fetchServerReferencePrices, fetchCoinGeckoReferencePrices, fetchCoinPaprikaReferencePrices, fetchCoinCapReferencePrices]) {
    try {
      const bundle = await fetcher(dateKey);
      writeCachedBundle(dailyCacheKey(dateKey), bundle);
      writeCachedBundle(lastKnownGoodCacheKey, bundle);
      return bundle;
    } catch (error) {
      console.warn("Route Optimizer reference price source failed", error);
    }
  }

  const lastKnownGood = readCachedBundle(lastKnownGoodCacheKey);

  if (lastKnownGood) {
    return {
      ...lastKnownGood,
      dateKey,
      status: "last_known_good",
      source: "Last-known-good reference prices",
      message: "Using last-known-good simulated reference prices."
    };
  }

  return createStaticFallbackBundle(dateKey);
}

async function fetchServerReferencePrices(dateKey: string): Promise<RouteOptimizerReferencePriceBundle> {
  const payload = await fetchJson(`${serverReferencePricesEndpoint}?date=${encodeURIComponent(dateKey)}`, {
    cache: "no-store"
  });
  const bundle = normalizeReferenceBundle(payload, dateKey, "fresh");

  if (!bundle) {
    throw new Error("Route Optimizer server reference prices were malformed.");
  }

  return bundle;
}

async function fetchCoinGeckoReferencePrices(dateKey: string): Promise<RouteOptimizerReferencePriceBundle> {
  const params = new URLSearchParams({
    ids: Object.values(coinGeckoIds).join(","),
    vs_currencies: "usd",
    include_last_updated_at: "true"
  });
  const payload = await fetchJson(`${coinGeckoSimplePriceEndpoint}?${params.toString()}`);

  if (!isRecord(payload)) {
    throw new Error("CoinGecko reference price response was malformed.");
  }

  const prices = tradeRouteAssets.reduce((nextPrices, asset) => {
    const row = payload[coinGeckoIds[asset]];
    if (!isRecord(row)) throw new Error(`CoinGecko ${asset} reference price was missing.`);

    const priceUSDT = parsePositiveNumber(row.usd);
    if (priceUSDT === null) throw new Error(`CoinGecko ${asset} reference price was invalid.`);

    nextPrices[asset] = {
      priceUSDT,
      source: "CoinGecko",
      lastUpdatedAt: toIsoTimestamp(row.last_updated_at)
    };
    return nextPrices;
  }, {} as ReferenceAssetPrices);

  return {
    dateKey,
    prices,
    source: "CoinGecko",
    fetchedAt: new Date().toISOString(),
    status: "fresh",
    message: "Reference prices updated today."
  };
}

async function fetchCoinPaprikaReferencePrices(dateKey: string): Promise<RouteOptimizerReferencePriceBundle> {
  const rows = await Promise.all(
    tradeRouteAssets.map(async (asset) => {
      const payload = await fetchJson(`${coinPaprikaTickerEndpoint}/${coinPaprikaIds[asset]}`);
      if (!isRecord(payload) || !isRecord(payload.quotes) || !isRecord(payload.quotes.USD)) {
        throw new Error(`CoinPaprika ${asset} reference price was missing.`);
      }

      const priceUSDT = parsePositiveNumber(payload.quotes.USD.price);
      if (priceUSDT === null) throw new Error(`CoinPaprika ${asset} reference price was invalid.`);

      return [
        asset,
        {
          priceUSDT,
          source: "CoinPaprika" as ReferencePriceSource,
          lastUpdatedAt: toIsoTimestamp(payload.last_updated) ?? toIsoTimestamp(payload.last_updated_timestamp)
        }
      ] as const;
    })
  );

  return {
    dateKey,
    prices: Object.fromEntries(rows) as ReferenceAssetPrices,
    source: "CoinPaprika",
    fetchedAt: new Date().toISOString(),
    status: "fresh",
    message: "Reference prices updated today."
  };
}

async function fetchCoinCapReferencePrices(dateKey: string): Promise<RouteOptimizerReferencePriceBundle> {
  const rows = await Promise.all(
    tradeRouteAssets.map(async (asset) => {
      const payload = await fetchJson(`${coinCapAssetsEndpoint}/${coinCapIds[asset]}`);
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const priceUSDT = data ? parsePositiveNumber(data.priceUsd) : null;
      if (priceUSDT === null) throw new Error(`CoinCap ${asset} reference price was invalid.`);

      return [
        asset,
        {
          priceUSDT,
          source: "CoinCap" as ReferencePriceSource,
          lastUpdatedAt: new Date().toISOString()
        }
      ] as const;
    })
  );

  return {
    dateKey,
    prices: Object.fromEntries(rows) as ReferenceAssetPrices,
    source: "CoinCap",
    fetchedAt: new Date().toISOString(),
    status: "fresh",
    message: "Reference prices updated today."
  };
}

function normalizeReferenceBundle(
  payload: unknown,
  fallbackDateKey: string,
  status: RouteOptimizerReferencePriceStatus
): RouteOptimizerReferencePriceBundle | null {
  if (!isRecord(payload) || !isRecord(payload.prices)) return null;

  const prices = normalizeReferencePrices(payload.prices);
  if (!prices) return null;

  return {
    dateKey: typeof payload.dateKey === "string" ? payload.dateKey : fallbackDateKey,
    prices,
    source: typeof payload.source === "string" ? payload.source : "Reference price API",
    fetchedAt: typeof payload.fetchedAt === "string" ? payload.fetchedAt : new Date().toISOString(),
    status,
    message: typeof payload.message === "string" ? payload.message : undefined
  };
}

function normalizeReferencePrices(payload: Record<string, unknown>): ReferenceAssetPrices | null {
  const entries = tradeRouteAssets.map((asset) => {
    const candidate = payload[asset];
    if (!isRecord(candidate)) return null;

    const priceUSDT = parsePositiveNumber(candidate.priceUSDT);
    const source = normalizeSource(candidate.source);
    if (priceUSDT === null || !source) return null;

    return [
      asset,
      {
        priceUSDT,
        source,
        lastUpdatedAt: toIsoTimestamp(candidate.lastUpdatedAt)
      }
    ] as const;
  });

  if (entries.some((entry) => entry === null)) return null;

  return Object.fromEntries(entries as Array<readonly [Asset, ReferenceAssetPrices[Asset]]>) as ReferenceAssetPrices;
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), requestTimeoutMs);

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
      throw new Error("Reference price request failed.");
    }

    return response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function createStaticFallbackBundle(dateKey: string): RouteOptimizerReferencePriceBundle {
  return {
    dateKey,
    prices: createFallbackReferenceAssetPrices(),
    source: "Static fallback reference prices",
    fetchedAt: new Date().toISOString(),
    status: "fallback",
    message: "Using fallback simulated reference prices."
  };
}

function readCachedBundle(storageKey: string, expectedDateKey?: string): RouteOptimizerReferencePriceBundle | null {
  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (!storedValue) return null;

    const parsed = JSON.parse(storedValue) as unknown;
    const bundle = normalizeReferenceBundle(parsed, expectedDateKey ?? getTradeRouteDateKey(), "cached");
    if (!bundle) return null;
    if (expectedDateKey && bundle.dateKey !== expectedDateKey) return null;

    return bundle;
  } catch {
    return null;
  }
}

function writeCachedBundle(storageKey: string, bundle: RouteOptimizerReferencePriceBundle): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(bundle));
  } catch {
    // The puzzle remains playable without local cache persistence.
  }
}

function dailyCacheKey(dateKey: string): string {
  return `${dailyCachePrefix}-${dateKey}`;
}

function normalizeSource(value: unknown): ReferencePriceSource | null {
  if (
    value === "CoinGecko" ||
    value === "CoinPaprika" ||
    value === "CoinCap" ||
    value === "fallback" ||
    value === "last_known_good"
  ) {
    return value;
  }

  return null;
}

function parsePositiveNumber(value: unknown): number | null {
  const numericValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value);
    const date = Number.isFinite(numericValue)
      ? new Date(numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue)
      : new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
