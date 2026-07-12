import type { AiScoreWeights } from "./aiFuturesTypes.ts";

export const AI_FUTURES_ENGINE_VERSION = "ai-futures-v1.0.0";
export const AI_FUTURES_FEATURE_VERSION = "ai-features-v1.0.0";
export const AI_FUTURES_PROMPT_VERSION = "ai-review-v1.0.0";

export const AI_FUTURES_SCORE_WEIGHTS: AiScoreWeights = Object.freeze({
  multiTimeframeTrend: 20,
  marketStructure: 20,
  momentum: 15,
  volumeVolatility: 10,
  futuresPositioning: 15,
  sentiment: 5,
  entryQuality: 15
});

export const AI_FUTURES_LIMITS = Object.freeze({
  minimumQualityScore: 75,
  minimumScoreDifference: 15,
  minimumRewardRisk: 1.8,
  minimumWaitQualityRatio: 0.8,
  minimumWaitSeparationRatio: 0.5,
  maximumEntryDistanceAtr: 1.25,
  abnormalAtrPercent15m: 2.5,
  setupLifetimeMinutes: 60,
  candleStaleAfterSeconds: {
    "15m": 20 * 60,
    "1h": 75 * 60,
    "4h": 5 * 60 * 60
  },
  liveMetricStaleAfterSeconds: 180,
  positioningStaleAfterSeconds: 20 * 60,
  sentimentStaleAfterSeconds: 36 * 60 * 60,
  minimumCandles: 220,
  maximumAnalysisRequestsPer15Minutes: 6,
  minimumRefreshSeconds: 60,
  generationLeaseSeconds: 90,
  maximumPlanningBalance: 10_000_000,
  maximumRiskPercent: 3,
  maximumLeverage: 10,
  maximumMarginPercent: 50,
  estimatedEntryFeePercent: 0.05,
  estimatedExitFeePercent: 0.05,
  slippageBufferPercent: 0.08,
  maintenanceMarginRatePercent: 0.5
});

export const AI_FUTURES_RISK_PRESETS = Object.freeze({
  conservative: { riskPercent: "0.5", maxLeverage: 3, maxMarginPercent: "20" },
  balanced: { riskPercent: "1", maxLeverage: 5, maxMarginPercent: "30" },
  aggressive: { riskPercent: "2", maxLeverage: 10, maxMarginPercent: "40" }
});

export function scoreWeightsTotal(weights: AiScoreWeights): number {
  return Object.values(weights).reduce((total, value) => total + value, 0);
}

if (scoreWeightsTotal(AI_FUTURES_SCORE_WEIGHTS) !== 100) {
  throw new Error("AI Futures score weights must total 100.");
}
