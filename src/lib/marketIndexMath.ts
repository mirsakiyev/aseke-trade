export type MarketIndexStatus = "ready" | "unavailable";
export type LongShortExchangeName = "Binance";
export type LongShortMode = "binance-only" | "unavailable";
export type LongShortSource = "Binance" | null;
export type VolatilityBasis = "BTC/ETH DVOL average" | "BTC DVOL" | "ETH DVOL" | "unavailable";

export interface FearGreedIndex {
  status: MarketIndexStatus;
  value: number | null;
  classification: string;
  timestamp: string | null;
  timeUntilUpdate: number | null;
  source: "CoinMarketCap";
  error?: string;
}

export interface LongShortIndex {
  status: MarketIndexStatus;
  longPct: number | null;
  shortPct: number | null;
  selectedExchange: LongShortExchangeName;
  mode: LongShortMode;
  includedExchanges: LongShortExchangeName[];
  failedExchanges: string[];
  availableExchanges: LongShortExchangeName[];
  requestedExchanges: LongShortExchangeName[];
  timestamp: string | null;
  source: LongShortSource;
  error?: string;
}

export interface VolatilityIndex {
  status: MarketIndexStatus;
  value: number | null;
  btc: number | null;
  eth: number | null;
  basis: VolatilityBasis;
  changePct: number | null;
  timestamp: string | null;
  source: "Deribit";
  error?: string;
}

export interface MarketIndicesResponse {
  fearGreed: FearGreedIndex;
  longShort: LongShortIndex;
  volatility: VolatilityIndex;
  generatedAt: string;
}

export interface FearGreedBand {
  label: string;
  className: string;
  min: number;
  max: number;
  color: string;
}

export interface LongShortPercent {
  longPct: number;
  shortPct: number;
}

export interface BinanceLongShortInput {
  longAccount?: number | null;
  shortAccount?: number | null;
  longShortRatio?: number | null;
  timestamp?: string | null;
}

export interface VolatilityRiskBand {
  label: string;
  className: string;
}

export const binanceLongShortExchange = "Binance" as const;
export const binanceLongShortUnavailableMessage = "Binance long/short data temporarily unavailable.";

export const fearGreedBands: FearGreedBand[] = [
  { min: 0, max: 24, label: "Extreme Fear", className: "extreme-fear", color: "#ff6b6b" },
  { min: 25, max: 44, label: "Fear", className: "fear", color: "#f59f56" },
  { min: 45, max: 55, label: "Neutral", className: "neutral", color: "#d8c96c" },
  { min: 56, max: 74, label: "Greed", className: "greed", color: "#9fdda2" },
  { min: 75, max: 100, label: "Extreme Greed", className: "extreme-greed", color: "#62d48c" }
];

export function getFearGreedBand(value: number | null | undefined): FearGreedBand {
  const normalizedValue = clampNumber(value, 0, 100);
  if (normalizedValue === null) {
    return { min: 0, max: 0, label: "Unavailable", className: "unavailable", color: "#8e98a3" };
  }

  return fearGreedBands.find((band) => normalizedValue >= band.min && normalizedValue <= band.max) ?? fearGreedBands[2];
}

export function ratioToLongShortPercent(ratio: number | null | undefined): LongShortPercent | null {
  const normalizedRatio = finitePositiveNumber(ratio);
  if (normalizedRatio === null) return null;

  const longPct = (normalizedRatio / (1 + normalizedRatio)) * 100;
  const shortPct = (1 / (1 + normalizedRatio)) * 100;

  return normalizeLongShortPercentPair(longPct, shortPct);
}

export function normalizeLongShortPercentPair(
  longPct: number | null | undefined,
  shortPct: number | null | undefined
): LongShortPercent | null {
  const normalizedLong = normalizePercentInput(longPct);
  const normalizedShort = normalizePercentInput(shortPct);
  if (normalizedLong === null || normalizedShort === null) return null;

  const total = normalizedLong + normalizedShort;
  if (total <= 0) return null;

  return {
    longPct: (normalizedLong / total) * 100,
    shortPct: (normalizedShort / total) * 100
  };
}

export function buildBinanceLongShortIndex(input: BinanceLongShortInput): LongShortIndex | null {
  const direct = normalizeLongShortPercentPair(input.longAccount, input.shortAccount);
  if (!direct) return null;

  return {
    status: "ready",
    longPct: roundTo(direct.longPct, 2),
    shortPct: roundTo(direct.shortPct, 2),
    selectedExchange: binanceLongShortExchange,
    mode: "binance-only",
    includedExchanges: [binanceLongShortExchange],
    failedExchanges: [],
    availableExchanges: [binanceLongShortExchange],
    requestedExchanges: [binanceLongShortExchange],
    timestamp: input.timestamp ?? null,
    source: "Binance"
  };
}

export function classifyVolatilityRisk(value: number | null | undefined): VolatilityRiskBand {
  const normalizedValue = finiteNumber(value);
  if (normalizedValue === null) {
    return { label: "Unavailable", className: "unavailable" };
  }

  if (normalizedValue < 40) return { label: "Low volatility", className: "low" };
  if (normalizedValue <= 70) return { label: "Moderate volatility", className: "moderate" };
  if (normalizedValue <= 100) return { label: "High volatility", className: "high" };
  return { label: "Extreme volatility", className: "extreme" };
}

export function formatIndexTimestamp(value: string | number | null | undefined): string {
  const date = timestampToDate(value);
  if (!date) return "Unavailable";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function createUnavailableMarketIndices(message = "Market index data unavailable."): MarketIndicesResponse {
  const generatedAt = new Date().toISOString();

  return {
    generatedAt,
    fearGreed: {
      status: "unavailable",
      value: null,
      classification: "Unavailable",
      timestamp: null,
      timeUntilUpdate: null,
      source: "CoinMarketCap",
      error: message
    },
    longShort: {
      status: "unavailable",
      longPct: null,
      shortPct: null,
      selectedExchange: binanceLongShortExchange,
      mode: "unavailable",
      includedExchanges: [],
      failedExchanges: [binanceLongShortExchange],
      availableExchanges: [binanceLongShortExchange],
      requestedExchanges: [binanceLongShortExchange],
      timestamp: null,
      source: null,
      error: binanceLongShortUnavailableMessage
    },
    volatility: {
      status: "unavailable",
      value: null,
      btc: null,
      eth: null,
      basis: "unavailable",
      changePct: null,
      timestamp: null,
      source: "Deribit",
      error: message
    }
  };
}

export function roundTo(value: number, digits = 1): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function normalizePercentInput(value: number | null | undefined): number | null {
  const numericValue = finiteNumber(value);
  if (numericValue === null || numericValue < 0) return null;

  return numericValue <= 1 ? numericValue * 100 : numericValue;
}

function finitePositiveNumber(value: number | null | undefined): number | null {
  const numericValue = finiteNumber(value);
  return numericValue !== null && numericValue > 0 ? numericValue : null;
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampNumber(value: number | null | undefined, min: number, max: number): number | null {
  const numericValue = finiteNumber(value);
  if (numericValue === null) return null;

  return Math.min(max, Math.max(min, numericValue));
}

function timestampToDate(value: string | number | null | undefined): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value);
    const date = Number.isFinite(numericValue)
      ? new Date(numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue)
      : new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}
