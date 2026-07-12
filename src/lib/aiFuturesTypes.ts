export const AI_FUTURES_SYMBOL = "BTCUSDT" as const;
export const AI_FUTURES_TIMEFRAMES = ["15m", "1h", "4h"] as const;

export type AiFuturesSymbol = typeof AI_FUTURES_SYMBOL;
export type AiFuturesTimeframe = (typeof AI_FUTURES_TIMEFRAMES)[number];
export type AiMarketRegime = "trending" | "ranging" | "high_volatility";
export type AiTrendDirection = "bullish" | "bearish" | "neutral";
export type AiStructureDirection = "uptrend" | "downtrend" | "mixed";
export type AiSetupDirection = "long" | "short";
export type AiAnalysisStatus =
  | "NO_TRADE"
  | "WAIT_FOR_ENTRY"
  | "LONG_SETUP"
  | "SHORT_SETUP"
  | "DATA_UNAVAILABLE"
  | "RISK_LIMIT_EXCEEDED";

export interface AiFuturesCandle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  takerBuyBaseVolume: number;
  takerBuyQuoteVolume: number;
}

export interface AiSourceTimestamp {
  category: string;
  source: string;
  observedAt: string;
  sourceAt: string;
  ageSeconds: number;
  stale: boolean;
}

export interface AiFuturesMetrics {
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  nextFundingAt: string | null;
  openInterest: number;
  openInterestChangePercent: number;
  globalLongShortRatio: number;
  topTraderLongShortRatio: number;
  takerBuySellRatio: number;
  basisPercent: number;
}

export interface AiSentimentMetrics {
  fearGreedValue: number;
  fearGreedClassification: string;
  source: "Alternative.me";
  sourceUrl: string;
  timestamp: string;
}

export interface AiSymbolFilters {
  tickSize: string;
  stepSize: string;
  minQuantity: string;
  minNotional: string;
  maxLeverage: number;
}

export interface AiNormalizedMarketSnapshot {
  symbol: AiFuturesSymbol;
  analysisTimeframe: "15m";
  candleCloseAt: string;
  capturedAt: string;
  currentPrice: number;
  candles: Record<AiFuturesTimeframe, AiFuturesCandle[]>;
  futures: AiFuturesMetrics;
  sentiment: AiSentimentMetrics;
  filters: AiSymbolFilters;
  sourceTimestamps: AiSourceTimestamp[];
  source: "Binance USD-M Futures";
}

export interface AiPriceZone {
  low: number;
  high: number;
  strength: number;
  touches: number;
}

export interface AiSwingPoint {
  index: number;
  timestamp: number;
  price: number;
  kind: "high" | "low";
}

export interface AiTimeframeFeatures {
  timeframe: AiFuturesTimeframe;
  candleCount: number;
  lastClosedAt: string;
  close: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  atr14: number;
  atrPercent: number;
  adx14: number;
  vwap: number;
  volumeAverage20: number;
  volumeZScore: number;
  realizedVolatility: number;
  averageBodyPercent: number;
  averageUpperWickPercent: number;
  averageLowerWickPercent: number;
  trend: AiTrendDirection;
  structure: AiStructureDirection;
  swingHighs: AiSwingPoint[];
  swingLows: AiSwingPoint[];
  supports: AiPriceZone[];
  resistances: AiPriceZone[];
}

export interface AiMarketFeatures {
  calculatedAt: string;
  candleCloseAt: string;
  timeframes: Record<AiFuturesTimeframe, AiTimeframeFeatures>;
  multiTimeframeTrend: AiTrendDirection;
  trendAlignmentScore: number;
  regime: AiMarketRegime;
  currentDistanceFromEma20Atr: number;
  markIndexBasisPercent: number;
  fundingInterpretation: "longs_pay" | "shorts_pay" | "neutral";
  positioningCrowding: "long_crowded" | "short_crowded" | "balanced";
  openInterestDirection: "rising" | "falling" | "flat";
  takerFlow: "buying" | "selling" | "balanced";
  sourceTimestamps: AiSourceTimestamp[];
  stale: boolean;
  staleReasons: string[];
}

export interface AiScoreWeights {
  multiTimeframeTrend: number;
  marketStructure: number;
  momentum: number;
  volumeVolatility: number;
  futuresPositioning: number;
  sentiment: number;
  entryQuality: number;
}

export interface AiScoreBreakdown {
  multiTimeframeTrend: number;
  marketStructure: number;
  momentum: number;
  volumeVolatility: number;
  futuresPositioning: number;
  sentiment: number;
  entryQuality: number;
  total: number;
}

export interface AiTakeProfitTarget {
  label: string;
  price: number;
  positionSizePercent: number;
  rMultiple: number;
}

export interface AiCandidateSetup {
  status: Exclude<AiAnalysisStatus, "DATA_UNAVAILABLE" | "RISK_LIMIT_EXCEEDED">;
  direction: AiSetupDirection | null;
  currentPrice: number;
  entryZone: AiPriceZone | null;
  stopLoss: number | null;
  invalidationLevel: number | null;
  takeProfits: AiTakeProfitTarget[];
  suggestedLeverage: number | null;
  projectedRewardRisk: number | null;
  qualityScore: number;
  longScore: AiScoreBreakdown;
  shortScore: AiScoreBreakdown;
  scoreBreakdown: AiScoreBreakdown;
  marketRegime: AiMarketRegime;
  supportingEvidence: string[];
  conflictingEvidence: string[];
  invalidationConditions: string[];
  activationConditions: string[];
  reasons: string[];
  createdAt: string;
  expiresAt: string;
  engineVersion: string;
}

export interface AiStructuredReview {
  verdict: "APPROVE" | "DOWNGRADE_TO_WAIT" | "REJECT";
  market_summary: string;
  primary_thesis: string;
  supporting_factors: string[];
  conflicting_factors: string[];
  invalidation_explanation: string;
  risk_notes: string[];
  educational_explanation: string;
}

export interface AiRiskProfileInput {
  preset: "conservative" | "balanced" | "aggressive" | "custom";
  planningBalance: string;
  riskPercent: string;
  maxLeverage: number;
  maxMarginPercent: string;
  saveProfile: boolean;
}

export interface AiPersonalizedPlan {
  id?: string;
  setupId?: string;
  direction: AiSetupDirection;
  planningBalance: string;
  riskPercent: string;
  riskBudget: string;
  leverage: number;
  quantity: string;
  notional: string;
  requiredMargin: string;
  marginPercent: string;
  plannedMaximumLoss: string;
  entryPrice: string;
  stopLoss: string;
  estimatedLiquidation: string;
  estimatedEntryFee: string;
  estimatedExitFee: string;
  slippageBuffer: string;
  rewardRisk: string;
  warnings: string[];
}

export interface AiAnalysisResponse {
  requestId: string;
  snapshotId: string | null;
  setupId: string | null;
  status: AiAnalysisStatus;
  candidate: AiCandidateSetup | null;
  review: AiStructuredReview | null;
  plan: AiPersonalizedPlan | null;
  currentPrice: number | null;
  candles: Record<AiFuturesTimeframe, AiFuturesCandle[]> | null;
  analysisTimestamp: string;
  dataTimestamp: string | null;
  setupExpiration: string | null;
  freshness: AiSourceTimestamp[];
  deterministicOnly: boolean;
  scoreWeights: AiScoreWeights;
  shadowMode: boolean;
  source: "Binance USD-M Futures";
  sentimentAttribution: {
    label: "Alternative.me Crypto Fear & Greed Index";
    url: string;
  };
  message: string;
  errorCode?: string;
}

export interface AiOutcomeState {
  status: "waiting_entry" | "active" | "tp_hit" | "stopped" | "expired" | "invalidated";
  enteredAt: string | null;
  completedAt: string | null;
  highestPrice: number | null;
  lowestPrice: number | null;
  mfeR: number;
  maeR: number;
  realizedR: number;
  estimatedResultAfterCostsR: number;
  hitTakeProfits: string[];
}
