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

export type DemoTradeTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "6h" | "12h" | "1d" | "1w" | "1M";

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

export async function fetchDemoTradeCandles(
  symbol = "BTCUSDT",
  timeframe: DemoTradeTimeframe = "1h",
  limit = 140
): Promise<DemoTradeCandle[]> {
  const safeSymbol = normalizeDemoSymbol(symbol);
  const url = `${binanceUsBaseUrl}/klines?symbol=${safeSymbol}&interval=${timeframe}&limit=${Math.min(Math.max(limit, 40), 240)}`;
  const payload = await fetchJson(url);

  if (!Array.isArray(payload)) throw new Error("BTC candle data was malformed.");

  const candles = payload.map(normalizeKline).filter((candle): candle is DemoTradeCandle => candle !== null);
  if (!candles.length) throw new Error("BTC candle data is unavailable.");
  return candles;
}

export async function fetchDemoTradeTicker(symbol = "BTCUSDT"): Promise<DemoTradeTicker> {
  const safeSymbol = normalizeDemoSymbol(symbol);
  const payload = await fetchJson(`${binanceUsBaseUrl}/ticker/price?symbol=${safeSymbol}`, { cache: "no-store" });

  if (!isRecord(payload)) throw new Error("BTC price data was malformed.");
  const price = Number(payload.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("BTC price data is unavailable.");

  return {
    symbol: "BTCUSDT",
    price,
    timestamp: new Date().toISOString(),
    source: "Binance.US public market data"
  };
}

function normalizeDemoSymbol(symbol: string): "BTCUSDT" {
  const normalized = symbol.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (normalized !== "BTCUSDT") throw new Error("BTC/USDT is the only supported demo pair for v1.");
  return "BTCUSDT";
}

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

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error("BTC market data could not be loaded.");
  return response.json() as Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
