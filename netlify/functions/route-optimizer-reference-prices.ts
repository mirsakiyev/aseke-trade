const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

type Asset = "BTC" | "ETH" | "SOL";
type ReferencePriceSource = "CoinGecko" | "CoinPaprika" | "CoinCap" | "fallback";
type ReferenceAssetPrices = Record<
  Asset,
  {
    priceUSDT: number;
    source: ReferencePriceSource;
    lastUpdatedAt?: string;
  }
>;

interface NetlifyEventLike {
  httpMethod?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
}

declare const process: { env?: Record<string, string | undefined> } | undefined;

const requestTimeoutMs = 8000;
const coinGeckoSimplePriceEndpoint = "https://api.coingecko.com/api/v3/simple/price";
const coinPaprikaTickerEndpoint = "https://api.coinpaprika.com/v1/tickers";
const coinCapAssetsEndpoint = "https://api.coincap.io/v2/assets";
const assets: Asset[] = ["BTC", "ETH", "SOL"];
const fallbackReferencePrices: Record<Asset, number> = {
  BTC: 64000,
  ETH: 3200,
  SOL: 140
};
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

export async function handler(event: NetlifyEventLike = {}) {
  const method = event.httpMethod ?? "GET";

  if (method === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "ok"
    };
  }

  if (method !== "POST" && method !== "GET") {
    return jsonResponse({ error: "Method not allowed.", code: "method_not_allowed" }, 405);
  }

  const dateKey = normalizeDateKey(event.queryStringParameters?.date);

  for (const fetcher of [fetchCoinGeckoReferencePrices, fetchCoinPaprikaReferencePrices, fetchCoinCapReferencePrices]) {
    try {
      const response = await fetcher(dateKey);
      return jsonResponse(response, 200, {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"
      });
    } catch (error) {
      console.warn("Route Optimizer reference price provider failed", error);
    }
  }

  return jsonResponse({
    dateKey,
    prices: createFallbackReferenceAssetPrices(),
    source: "Static fallback reference prices",
    fetchedAt: new Date().toISOString(),
    message: "Using fallback simulated reference prices."
  });
}

async function fetchCoinGeckoReferencePrices(dateKey: string) {
  const params = new URLSearchParams({
    ids: Object.values(coinGeckoIds).join(","),
    vs_currencies: "usd",
    include_last_updated_at: "true"
  });
  const headers: Record<string, string> = {
    accept: "application/json"
  };
  const demoKey = typeof process === "undefined" ? "" : process.env?.COINGECKO_DEMO_API_KEY?.trim() ?? "";

  if (demoKey) {
    headers["x-cg-demo-api-key"] = demoKey;
  }

  const payload = await fetchJson(`${coinGeckoSimplePriceEndpoint}?${params.toString()}`, { headers });
  if (!isRecord(payload)) throw new Error("CoinGecko response was malformed.");

  const prices = assets.reduce((nextPrices, asset) => {
    const row = payload[coinGeckoIds[asset]];
    if (!isRecord(row)) throw new Error(`CoinGecko ${asset} price was missing.`);

    const priceUSDT = parsePositiveNumber(row.usd);
    if (priceUSDT === null) throw new Error(`CoinGecko ${asset} price was invalid.`);

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
    message: "Reference prices updated today."
  };
}

async function fetchCoinPaprikaReferencePrices(dateKey: string) {
  const rows = await Promise.all(
    assets.map(async (asset) => {
      const payload = await fetchJson(`${coinPaprikaTickerEndpoint}/${coinPaprikaIds[asset]}`);
      if (!isRecord(payload) || !isRecord(payload.quotes) || !isRecord(payload.quotes.USD)) {
        throw new Error(`CoinPaprika ${asset} price was missing.`);
      }

      const priceUSDT = parsePositiveNumber(payload.quotes.USD.price);
      if (priceUSDT === null) throw new Error(`CoinPaprika ${asset} price was invalid.`);

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
    message: "Reference prices updated today."
  };
}

async function fetchCoinCapReferencePrices(dateKey: string) {
  const rows = await Promise.all(
    assets.map(async (asset) => {
      const payload = await fetchJson(`${coinCapAssetsEndpoint}/${coinCapIds[asset]}`);
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const priceUSDT = data ? parsePositiveNumber(data.priceUsd) : null;
      if (priceUSDT === null) throw new Error(`CoinCap ${asset} price was invalid.`);

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
    message: "Reference prices updated today."
  };
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
      throw new Error("Reference price request failed.");
    }

    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function createFallbackReferenceAssetPrices(): ReferenceAssetPrices {
  const lastUpdatedAt = new Date().toISOString();

  return assets.reduce((prices, asset) => {
    prices[asset] = {
      priceUSDT: fallbackReferencePrices[asset],
      source: "fallback",
      lastUpdatedAt
    };
    return prices;
  }, {} as ReferenceAssetPrices);
}

function jsonResponse(body: unknown, statusCode = 200, headers: Record<string, string> = {}) {
  return {
    statusCode,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  };
}

function normalizeDateKey(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
