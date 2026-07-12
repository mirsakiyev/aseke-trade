import { AI_FUTURES_LIMITS } from "./aiFuturesConfig.ts";
import {
  decimalAbs,
  decimalAdd,
  decimalDivide,
  decimalMultiply,
  decimalQuantize,
  decimalSubtract,
  decimalToString,
  parseDecimal
} from "./aiFuturesDecimal.ts";
import { calculateAiFuturesRiskPlan } from "./aiFuturesRisk.ts";
import type {
  AiAnalysisStatus,
  AiCandidateSetup,
  AiMarketFeatures,
  AiPersonalizedPlan,
  AiRiskProfileInput,
  AiStructuredReview,
  AiSymbolFilters
} from "./aiFuturesTypes.ts";

export interface AiFinalValidationInput {
  candidate: AiCandidateSetup;
  features: AiMarketFeatures;
  review: AiStructuredReview | null;
  riskProfile: AiRiskProfileInput;
  filters: AiSymbolFilters;
  subscriptionAuthorized: boolean;
  intendedSnapshotCloseAt: string;
  currentSnapshotCloseAt: string;
  deterministicOnlyAllowed: boolean;
  currentMarketPrice: number;
  setupOutcomeStatus?: "awaiting_entry" | "entry_triggered" | "tp_partial" | "tp_hit" | "sl_hit" | "expired" | "invalidated" | null;
  policy?: Partial<AiFinalValidationPolicy>;
  now?: number;
}

export interface AiFinalValidationPolicy {
  minimumSetupScore: number;
  minimumRewardRisk: number;
  maximumRiskPercent: number;
  maximumLeverage: number;
  maximumMarginPercent: number;
}

export interface AiFinalValidationResult {
  status: AiAnalysisStatus;
  candidate: AiCandidateSetup;
  plan: AiPersonalizedPlan | null;
  errors: string[];
  deterministicOnly: boolean;
}

export function validateFinalAiAnalysis(input: AiFinalValidationInput): AiFinalValidationResult {
  const now = input.now ?? Date.now();
  const policy = resolveValidationPolicy(input.policy);
  const errors: string[] = [];
  let candidate = clone(input.candidate);

  if (!input.subscriptionAuthorized) errors.push("Active Trading Academy access is required.");
  if (input.features.stale) errors.push(...input.features.staleReasons);
  if (input.intendedSnapshotCloseAt !== input.currentSnapshotCloseAt) errors.push("Analysis snapshot identity changed during generation.");
  if (!Number.isFinite(now) || Date.parse(candidate.expiresAt) <= now) errors.push("The setup has expired.");
  if (!positiveFinite(input.currentMarketPrice)) errors.push("The current market price is unavailable.");

  if (candidate.status !== "NO_TRADE") errors.push(...validateCandidateNumbers(candidate, policy));
  if (errors.length) {
    return { status: "DATA_UNAVAILABLE", candidate, plan: null, errors: unique(errors), deterministicOnly: input.review === null };
  }

  candidate.currentPrice = input.currentMarketPrice;
  if (candidate.status !== "NO_TRADE") {
    const lifecycleReason = staleSetupReason(candidate, input.currentMarketPrice, input.setupOutcomeStatus ?? null);
    if (lifecycleReason) {
      candidate = invalidateCandidate(candidate, lifecycleReason);
      return { status: "NO_TRADE", candidate, plan: null, errors: [], deterministicOnly: input.review === null };
    }
    if (
      (candidate.status === "LONG_SETUP" || candidate.status === "SHORT_SETUP") &&
      candidate.entryZone &&
      (input.currentMarketPrice < candidate.entryZone.low || input.currentMarketPrice > candidate.entryZone.high)
    ) {
      candidate.status = "WAIT_FOR_ENTRY";
      candidate.reasons = [...candidate.reasons, "The live mark price moved outside the approved entry zone; wait for a fresh qualifying entry."];
    }
  }

  const profileErrors = validateRiskProfile(input.riskProfile, policy);
  if (profileErrors.length) {
    return { status: "RISK_LIMIT_EXCEEDED", candidate, plan: null, errors: profileErrors, deterministicOnly: input.review === null };
  }

  if (candidate.status === "NO_TRADE") {
    return { status: "NO_TRADE", candidate, plan: null, errors: [], deterministicOnly: input.review === null };
  }

  if (!input.review && !input.deterministicOnlyAllowed) {
    return {
      status: "DATA_UNAVAILABLE",
      candidate,
      plan: null,
      errors: ["Independent AI review is unavailable and deterministic-only results are disabled."],
      deterministicOnly: false
    };
  }

  if (input.review) {
    if (reviewContainsNumericClaims(input.review)) {
      return {
        status: "DATA_UNAVAILABLE",
        candidate,
        plan: null,
        errors: ["AI review introduced unapproved numeric content."],
        deterministicOnly: false
      };
    }
    if (input.review.verdict === "REJECT") {
      candidate = {
        ...candidate,
        status: "NO_TRADE",
        direction: null,
        entryZone: null,
        stopLoss: null,
        invalidationLevel: null,
        takeProfits: [],
        suggestedLeverage: null,
        projectedRewardRisk: null,
        reasons: [...candidate.reasons, "Independent AI review rejected the deterministic candidate."]
      };
      return { status: "NO_TRADE", candidate, plan: null, errors: [], deterministicOnly: false };
    }
    if (input.review.verdict === "DOWNGRADE_TO_WAIT" && candidate.status !== "WAIT_FOR_ENTRY") {
      candidate.status = "WAIT_FOR_ENTRY";
      candidate.reasons = [...candidate.reasons, "Independent AI review requires additional confirmation before entry."];
    }
  }

  const direction = candidate.direction!;
  const entryPrice = String((candidate.entryZone!.low + candidate.entryZone!.high) / 2);
  const leverage = Math.min(
    candidate.suggestedLeverage ?? input.riskProfile.maxLeverage,
    input.riskProfile.maxLeverage,
    input.filters.maxLeverage,
    policy.maximumLeverage
  );
  const risk = calculateAiFuturesRiskPlan({
    direction,
    planningBalance: input.riskProfile.planningBalance,
    riskPercent: input.riskProfile.riskPercent,
    entryPrice,
    stopLossPrice: String(candidate.stopLoss),
    entryFeePercent: String(AI_FUTURES_LIMITS.estimatedEntryFeePercent),
    exitFeePercent: String(AI_FUTURES_LIMITS.estimatedExitFeePercent),
    slippageBufferPercent: String(AI_FUTURES_LIMITS.slippageBufferPercent),
    maximumMarginPercent: input.riskProfile.maxMarginPercent,
    leverage,
    maximumLeverage: Math.min(input.riskProfile.maxLeverage, input.filters.maxLeverage, policy.maximumLeverage),
    quantityStep: input.filters.stepSize,
    priceTickSize: input.filters.tickSize,
    minimumQuantity: input.filters.minQuantity,
    minimumNotional: input.filters.minNotional,
    maintenanceMarginPercent: String(AI_FUTURES_LIMITS.maintenanceMarginRatePercent)
  });

  if (risk.status !== "OK") {
    const riskErrors = risk.status === "INVALID_INPUT" ? risk.errors : [risk.message];
    return { status: "RISK_LIMIT_EXCEEDED", candidate, plan: null, errors: riskErrors, deterministicOnly: input.review === null };
  }

  const plan: AiPersonalizedPlan = {
    direction,
    planningBalance: risk.plan.planningBalance,
    riskPercent: risk.plan.riskPercent,
    riskBudget: risk.plan.riskBudget,
    leverage: risk.plan.leverage,
    quantity: risk.plan.quantity,
    notional: risk.plan.positionNotional,
    requiredMargin: risk.plan.requiredIsolatedMargin,
    marginPercent: percentOf(risk.plan.requiredIsolatedMargin, risk.plan.planningBalance),
    plannedMaximumLoss: risk.plan.maximumPlannedLoss,
    entryPrice: risk.plan.entryPrice,
    stopLoss: risk.plan.stopLossPrice,
    estimatedLiquidation: risk.plan.estimatedLiquidationPrice ?? "unavailable",
    estimatedEntryFee: risk.plan.estimatedEntryFee,
    estimatedExitFee: risk.plan.estimatedExitFee,
    slippageBuffer: risk.plan.estimatedSlippageLoss,
    rewardRisk: String(candidate.projectedRewardRisk),
    warnings: [
      "Estimated liquidation excludes exchange maintenance tiers, funding, liquidation fees and mark-price protections.",
      "Verify exact fees, leverage and liquidation information with your exchange."
    ]
  };

  return { status: candidate.status, candidate, plan, errors: [], deterministicOnly: input.review === null };
}

function validateCandidateNumbers(candidate: AiCandidateSetup, policy: AiFinalValidationPolicy): string[] {
  const errors: string[] = [];
  if (!candidate.direction || !candidate.entryZone || !candidate.stopLoss || !candidate.takeProfits.length) {
    return ["Setup levels are incomplete."];
  }
  const entry = (candidate.entryZone.low + candidate.entryZone.high) / 2;
  if (![entry, candidate.entryZone.low, candidate.entryZone.high, candidate.stopLoss].every(positiveFinite)) {
    errors.push("Entry and stop levels must be finite positive values.");
  }
  if (candidate.entryZone.low > candidate.entryZone.high) errors.push("Entry zone is inverted.");
  if (candidate.direction === "long" && candidate.stopLoss >= candidate.entryZone.low) errors.push("Long stop must be below entry zone.");
  if (candidate.direction === "short" && candidate.stopLoss <= candidate.entryZone.high) errors.push("Short stop must be above entry zone.");
  let previousPrice: number | null = null;
  let previousRMultiple: number | null = null;
  const labels = new Set<string>();
  for (const target of candidate.takeProfits) {
    if (typeof target.label !== "string" || !target.label.trim() || labels.has(target.label)) errors.push("Take-profit labels must be non-empty and unique.");
    labels.add(target.label);
    if (!positiveFinite(target.price) || !positiveFinite(target.positionSizePercent) || !positiveFinite(target.rMultiple)) errors.push(`${target.label} is invalid.`);
    if (candidate.direction === "long" && target.price <= candidate.entryZone.high) errors.push(`${target.label} must be above long entry.`);
    if (candidate.direction === "short" && target.price >= candidate.entryZone.low) errors.push(`${target.label} must be below short entry.`);
    if (previousPrice !== null && candidate.direction === "long" && target.price <= previousPrice) errors.push("Long take-profit prices must increase strictly.");
    if (previousPrice !== null && candidate.direction === "short" && target.price >= previousPrice) errors.push("Short take-profit prices must decrease strictly.");
    if (previousRMultiple !== null && target.rMultiple <= previousRMultiple) errors.push("Take-profit R multiples must increase strictly.");
    previousPrice = target.price;
    previousRMultiple = target.rMultiple;
  }
  const allocation = candidate.takeProfits.reduce((total, target) => total + target.positionSizePercent, 0);
  if (Math.abs(allocation - 100) > 0.000001) errors.push("Take-profit allocations must total exactly 100%.");
  const derived = deriveActualRewardRisk(candidate);
  if (!derived) {
    errors.push("Reward-to-risk could not be derived from the final setup prices.");
  } else {
    for (let index = 0; index < candidate.takeProfits.length; index += 1) {
      if (Math.abs(candidate.takeProfits[index].rMultiple - derived.targetMultiples[index]) > 0.000000001) {
        errors.push(`${candidate.takeProfits[index].label} R multiple does not match its final price.`);
      }
      candidate.takeProfits[index].rMultiple = derived.targetMultiples[index];
    }
    if (!positiveFinite(candidate.projectedRewardRisk ?? Number.NaN) || Math.abs((candidate.projectedRewardRisk ?? 0) - derived.weightedRewardRisk) > 0.000000001) {
      errors.push("Projected reward-to-risk does not match the final setup prices.");
    }
    candidate.projectedRewardRisk = derived.weightedRewardRisk;
    const configuredMinimum = parseDecimal(policy.minimumRewardRisk);
    if (configuredMinimum === null || derived.weightedScaled < configuredMinimum) errors.push("Reward-to-risk is below the configured minimum.");
  }
  if (candidate.qualityScore < policy.minimumSetupScore && candidate.status !== "WAIT_FOR_ENTRY") {
    errors.push("Setup Quality Score is below the configured minimum.");
  }
  return errors;
}

function deriveActualRewardRisk(candidate: AiCandidateSetup): {
  targetMultiples: number[];
  weightedRewardRisk: number;
  weightedScaled: bigint;
} | null {
  if (!candidate.entryZone || candidate.stopLoss === null) return null;
  const low = parseDecimal(candidate.entryZone.low);
  const high = parseDecimal(candidate.entryZone.high);
  const stop = parseDecimal(candidate.stopLoss);
  const two = parseDecimal("2");
  const hundred = parseDecimal("100");
  const quantum = parseDecimal("0.000001");
  if (low === null || high === null || stop === null || two === null || hundred === null || quantum === null) return null;
  const entry = decimalDivide(decimalAdd(low, high), two);
  if (entry === null) return null;
  const riskDistance = decimalAbs(decimalSubtract(entry, stop));
  if (riskDistance <= 0n) return null;

  const targetMultiples: number[] = [];
  let weightedScaled = 0n;
  for (const target of candidate.takeProfits) {
    const price = parseDecimal(target.price);
    const allocation = parseDecimal(target.positionSizePercent);
    if (price === null || allocation === null || allocation <= 0n) return null;
    const targetMultiple = decimalDivide(decimalAbs(decimalSubtract(price, entry)), riskDistance);
    if (targetMultiple === null || targetMultiple <= 0n) return null;
    const normalizedMultiple = decimalQuantize(targetMultiple, quantum, "floor");
    const weighted = decimalDivide(decimalMultiply(targetMultiple, allocation, "floor"), hundred, "floor");
    const normalizedWeighted = weighted === null ? null : decimalQuantize(weighted, quantum, "floor");
    if (normalizedMultiple === null || normalizedWeighted === null) return null;
    targetMultiples.push(Number(decimalToString(normalizedMultiple)));
    weightedScaled = decimalAdd(weightedScaled, normalizedWeighted);
  }
  return {
    targetMultiples,
    weightedRewardRisk: Number(decimalToString(weightedScaled)),
    weightedScaled
  };
}

function staleSetupReason(
  candidate: AiCandidateSetup,
  currentPrice: number,
  outcomeStatus: AiFinalValidationInput["setupOutcomeStatus"]
): string | null {
  if (outcomeStatus && outcomeStatus !== "awaiting_entry") {
    return `The shared setup is already ${outcomeStatus.replace(/_/g, " ")} and is no longer a fresh entry.`;
  }
  if (!candidate.direction || candidate.stopLoss === null || !candidate.takeProfits.length) return null;
  const invalidation = candidate.invalidationLevel ?? candidate.stopLoss;
  const finalTarget = candidate.takeProfits[candidate.takeProfits.length - 1].price;
  if (candidate.direction === "long" && currentPrice <= invalidation) return "The live mark price crossed the long setup invalidation level.";
  if (candidate.direction === "short" && currentPrice >= invalidation) return "The live mark price crossed the short setup invalidation level.";
  if (candidate.direction === "long" && currentPrice >= finalTarget) return "The live mark price already reached the final long target.";
  if (candidate.direction === "short" && currentPrice <= finalTarget) return "The live mark price already reached the final short target.";
  return null;
}

function invalidateCandidate(candidate: AiCandidateSetup, reason: string): AiCandidateSetup {
  return {
    ...candidate,
    status: "NO_TRADE",
    direction: null,
    entryZone: null,
    stopLoss: null,
    invalidationLevel: null,
    takeProfits: [],
    suggestedLeverage: null,
    projectedRewardRisk: null,
    activationConditions: [],
    reasons: [...candidate.reasons, reason]
  };
}

function validateRiskProfile(profile: AiRiskProfileInput, policy: AiFinalValidationPolicy): string[] {
  const balance = Number(profile.planningBalance);
  const risk = Number(profile.riskPercent);
  const margin = Number(profile.maxMarginPercent);
  const errors: string[] = [];
  if (!positiveFinite(balance) || balance > AI_FUTURES_LIMITS.maximumPlanningBalance) errors.push("Planning Balance is outside server safety bounds.");
  if (!positiveFinite(risk) || risk > policy.maximumRiskPercent) errors.push("Risk per trade is outside server safety bounds.");
  if (!Number.isInteger(profile.maxLeverage) || profile.maxLeverage < 1 || profile.maxLeverage > policy.maximumLeverage) errors.push("Maximum leverage is outside server safety bounds.");
  if (!positiveFinite(margin) || margin > policy.maximumMarginPercent) errors.push("Maximum margin allocation is outside server safety bounds.");
  return errors;
}

function resolveValidationPolicy(input: Partial<AiFinalValidationPolicy> | undefined): AiFinalValidationPolicy {
  return {
    minimumSetupScore: finiteOr(input?.minimumSetupScore, AI_FUTURES_LIMITS.minimumQualityScore),
    minimumRewardRisk: finiteOr(input?.minimumRewardRisk, AI_FUTURES_LIMITS.minimumRewardRisk),
    maximumRiskPercent: Math.min(
      finiteOr(input?.maximumRiskPercent, AI_FUTURES_LIMITS.maximumRiskPercent),
      AI_FUTURES_LIMITS.maximumRiskPercent
    ),
    maximumLeverage: Math.min(
      finiteOr(input?.maximumLeverage, AI_FUTURES_LIMITS.maximumLeverage),
      AI_FUTURES_LIMITS.maximumLeverage
    ),
    maximumMarginPercent: Math.min(
      finiteOr(input?.maximumMarginPercent, AI_FUTURES_LIMITS.maximumMarginPercent),
      AI_FUTURES_LIMITS.maximumMarginPercent
    )
  };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function reviewContainsNumericClaims(review: AiStructuredReview): boolean {
  return /\b\d+(?:[.,]\d+)?(?:%|x|\b)/i.test([
    review.market_summary,
    review.primary_thesis,
    review.invalidation_explanation,
    review.educational_explanation,
    ...review.supporting_factors,
    ...review.conflicting_factors,
    ...review.risk_notes
  ].join(" "));
}

function percentOf(value: string, total: string): string {
  const parsedValue = Number(value);
  const parsedTotal = Number(total);
  if (!Number.isFinite(parsedValue) || !positiveFinite(parsedTotal)) return "0";
  return ((parsedValue / parsedTotal) * 100).toFixed(4).replace(/\.?0+$/, "");
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
