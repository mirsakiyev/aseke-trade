export type MarketIndexStatus = "ready" | "unavailable";
export type LongShortExchangeName =
  | "Binance"
  | "OKX"
  | "Bybit"
  | "Bitget"
  | "Gate"
  | "KuCoin"
  | "MEXC"
  | "HTX"
  | "Kraken"
  | "Deribit";
export type LongShortExchangeSelection = "major-average" | LongShortExchangeName;
export type LongShortMode = "major-average" | "single-exchange" | "binance-fallback" | "unavailable";
export type LongShortSource = "CoinGlass" | "Binance" | null;
export type VolatilityBasis = "BTC/ETH DVOL average" | "BTC DVOL" | "ETH DVOL" | "unavailable";

export interface FearGreedIndex {
  status: MarketIndexStatus;
  value: number | null;
  classification: string;
  timestamp: string | null;
  timeUntilUpdate: number | null;
  source: "Alternative.me";
  error?: string;
}

export interface LongShortIndex {
  status: MarketIndexStatus;
  longPct: number | null;
  shortPct: number | null;
  selectedExchange: LongShortExchangeSelection;
  mode: LongShortMode;
  includedExchanges: string[];
  failedExchanges: string[];
  availableExchanges: LongShortExchangeName[];
  requestedExchanges: string[];
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

export interface LongShortExchangeInput {
  exchange: LongShortExchangeName;
  longPct?: number | null;
  shortPct?: number | null;
  longShortRatio?: number | null;
  timestamp?: string | null;
}

export interface BinanceFallbackLongShortOptions {
  availableExchanges?: LongShortExchangeName[];
  failedExchanges?: string[];
  error?: string;
}

export interface AggregatedLongShort extends LongShortPercent {
  includedExchanges: LongShortExchangeName[];
  timestamp: string | null;
}

export interface NormalizedLongShortExchange extends LongShortPercent {
  exchange: LongShortExchangeName;
  timestamp: string | null;
}

export interface VolatilityRiskBand {
  label: string;
  className: string;
}

export const majorLongShortSelection = "major-average" as const;

export const defaultLongShortExchanges: LongShortExchangeName[] = [
  "Binance",
  "OKX",
  "Bybit",
  "Bitget",
  "Gate",
  "KuCoin",
  "MEXC",
  "HTX",
  "Kraken",
  "Deribit"
];

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

export function isLongShortExchangeName(value: unknown): value is LongShortExchangeName {
  return typeof value === "string" && defaultLongShortExchanges.includes(value as LongShortExchangeName);
}

export function normalizeLongShortExchangeSelection(value: unknown): LongShortExchangeSelection {
  return value === majorLongShortSelection || isLongShortExchangeName(value) ? value : majorLongShortSelection;
}

export function normalizeLongShortExchangeInput(
  input: LongShortExchangeInput
): NormalizedLongShortExchange | null {
  const direct = normalizeLongShortPercentPair(input.longPct, input.shortPct);
  const fromRatio = direct ?? ratioToLongShortPercent(input.longShortRatio);

  return fromRatio
    ? {
        ...fromRatio,
        exchange: input.exchange,
        timestamp: input.timestamp ?? null
      }
    : null;
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

export function averageLongShortExchanges(inputs: LongShortExchangeInput[]): AggregatedLongShort | null {
  const validRows = inputs.map(normalizeLongShortExchangeInput).filter((row): row is NormalizedLongShortExchange =>
    Boolean(row)
  );

  if (!validRows.length) return null;

  const longPct = validRows.reduce((total, row) => total + row.longPct, 0) / validRows.length;
  const shortPct = validRows.reduce((total, row) => total + row.shortPct, 0) / validRows.length;
  const normalized = normalizeLongShortPercentPair(longPct, shortPct);
  if (!normalized) return null;

  return {
    ...normalized,
    includedExchanges: validRows.map((row) => row.exchange),
    timestamp: newestTimestamp(validRows.map((row) => row.timestamp))
  };
}

export function buildMajorLongShortIndex(
  inputs: LongShortExchangeInput[],
  requestedExchanges = defaultLongShortExchanges
): LongShortIndex | null {
  const aggregate = averageLongShortExchanges(inputs);
  if (!aggregate || aggregate.includedExchanges.length < 2) return null;

  return {
    status: "ready",
    longPct: roundTo(aggregate.longPct, 2),
    shortPct: roundTo(aggregate.shortPct, 2),
    selectedExchange: majorLongShortSelection,
    mode: "major-average",
    includedExchanges: aggregate.includedExchanges,
    failedExchanges: requestedExchanges.filter((exchange) => !aggregate.includedExchanges.includes(exchange)),
    availableExchanges: requestedExchanges,
    requestedExchanges,
    timestamp: aggregate.timestamp,
    source: "CoinGlass"
  };
}

export function buildSingleExchangeLongShortIndex(
  input: LongShortExchangeInput,
  requestedExchanges = defaultLongShortExchanges
): LongShortIndex | null {
  const row = normalizeLongShortExchangeInput(input);
  if (!row) return null;

  return {
    status: "ready",
    longPct: roundTo(row.longPct, 2),
    shortPct: roundTo(row.shortPct, 2),
    selectedExchange: row.exchange,
    mode: "single-exchange",
    includedExchanges: [row.exchange],
    failedExchanges: [],
    availableExchanges: requestedExchanges,
    requestedExchanges,
    timestamp: row.timestamp,
    source: "CoinGlass"
  };
}

export function buildBinanceFallbackLongShortIndex(
  input: LongShortExchangeInput,
  requestedExchanges = defaultLongShortExchanges,
  options: BinanceFallbackLongShortOptions = {}
): LongShortIndex | null {
  const row = normalizeLongShortExchangeInput({ ...input, exchange: "Binance" });
  if (!row) return null;

  const availableExchanges = options.availableExchanges ?? ["Binance"];

  return {
    status: "ready",
    longPct: roundTo(row.longPct, 2),
    shortPct: roundTo(row.shortPct, 2),
    selectedExchange: "Binance",
    mode: "binance-fallback",
    includedExchanges: ["Binance"],
    failedExchanges:
      options.failedExchanges ?? requestedExchanges.filter((exchange) => !availableExchanges.includes(exchange)),
    availableExchanges,
    requestedExchanges,
    timestamp: row.timestamp,
    source: "Binance",
    error: options.error
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

export function createUnavailableMarketIndices(
  message = "Market index data unavailable.",
  selectedExchange: LongShortExchangeSelection = majorLongShortSelection
): MarketIndicesResponse {
  const generatedAt = new Date().toISOString();

  return {
    generatedAt,
    fearGreed: {
      status: "unavailable",
      value: null,
      classification: "Unavailable",
      timestamp: null,
      timeUntilUpdate: null,
      source: "Alternative.me",
      error: message
    },
    longShort: {
      status: "unavailable",
      longPct: null,
      shortPct: null,
      selectedExchange,
      mode: "unavailable",
      includedExchanges: [],
      failedExchanges: [],
      availableExchanges: [],
      requestedExchanges: defaultLongShortExchanges,
      timestamp: null,
      source: null,
      error: `${message} CoinGlass API key may be required.`
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

function newestTimestamp(values: Array<string | null>): string | null {
  return values.reduce<string | null>((newest, value) => {
    const nextDate = timestampToDate(value);
    if (!nextDate) return newest;

    const newestDate = timestampToDate(newest);
    return !newestDate || nextDate > newestDate ? nextDate.toISOString() : newest;
  }, null);
}
