export interface CryptoMarketCoin {
  id: string;
  rank: number;
  name: string;
  symbol: string;
  image: string | null;
}

export interface ChartAsset {
  id: string;
  title: string;
  ticker: string;
  symbol: string;
  rank?: number;
}

interface CoinGeckoMarketRow {
  id: string;
  market_cap_rank: number | null;
  name: string;
  symbol: string;
  image?: string | null;
}

const coinGeckoMarketsUrl =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=200&page=1&sparkline=false";
const coinCacheKey = "aseke-top-crypto-coins-v1";
const coinCacheMs = 30 * 60 * 1000;

export const coreChartAssets: ChartAsset[] = [
  { id: "bitcoin", title: "Bitcoin", ticker: "BTC/USDT", symbol: "BINANCE:BTCUSDT", rank: 1 },
  { id: "ethereum", title: "Ethereum", ticker: "ETH/USDT", symbol: "BINANCE:ETHUSDT", rank: 2 }
];

export async function fetchTopCryptoCoins(): Promise<CryptoMarketCoin[]> {
  const cached = readCoinCache();
  if (cached) return cached;

  const response = await fetch(coinGeckoMarketsUrl, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Top crypto list could not be loaded.");
  }

  const rows = (await response.json()) as CoinGeckoMarketRow[];
  const coins = normalizeMarketRows(rows);
  writeCoinCache(coins);

  return coins;
}

export function normalizeMarketRows(rows: CoinGeckoMarketRow[]): CryptoMarketCoin[] {
  return rows
    .filter((row) => row.id && row.name && row.symbol && row.market_cap_rank)
    .map((row) => ({
      id: row.id,
      rank: Number(row.market_cap_rank),
      name: row.name,
      symbol: row.symbol.toUpperCase(),
      image: row.image ?? null
    }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 200);
}

export function filterCryptoCoins(coins: CryptoMarketCoin[], query: string): CryptoMarketCoin[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return coins;

  return coins.filter(
    (coin) =>
      coin.name.toLowerCase().includes(normalizedQuery) ||
      coin.symbol.toLowerCase().includes(normalizedQuery) ||
      String(coin.rank) === normalizedQuery.replace(/^#/, "")
  );
}

export function chartAssetFromCoin(coin: CryptoMarketCoin): ChartAsset {
  const coreAsset = coreChartAssets.find((asset) => asset.id === coin.id);
  if (coreAsset) return coreAsset;

  return {
    id: coin.id,
    title: coin.name,
    ticker: `${coin.symbol}/USDT`,
    symbol: `BINANCE:${coin.symbol}USDT`,
    rank: coin.rank
  };
}

function readCoinCache(): CryptoMarketCoin[] | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(coinCacheKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { cachedAt?: number; coins?: CryptoMarketCoin[] };
    if (!parsed.cachedAt || Date.now() - parsed.cachedAt > coinCacheMs || !Array.isArray(parsed.coins)) {
      return null;
    }

    return parsed.coins;
  } catch {
    return null;
  }
}

function writeCoinCache(coins: CryptoMarketCoin[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      coinCacheKey,
      JSON.stringify({
        cachedAt: Date.now(),
        coins
      })
    );
  } catch {
    // Cache failure should not block charts.
  }
}
