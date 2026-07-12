import { AI_FUTURES_PROMPT_VERSION } from "../../../src/lib/aiFuturesConfig.ts";
import type { AiCandidateSetup, AiMarketFeatures, AiStructuredReview } from "../../../src/lib/aiFuturesTypes.ts";

const openAiResponsesEndpoint = "https://api.openai.com/v1/responses";
const requestTimeoutMs = 22_000;
const maximumAttempts = 2;
const defaultModel = "gpt-5.6";

export interface AiReviewResult {
  review: AiStructuredReview;
  model: string;
  responseId: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export async function requestStructuredAiReview(input: {
  candidate: AiCandidateSetup;
  features: AiMarketFeatures;
  apiKey?: string;
  model?: string;
  promptVersion?: string;
  fetchImpl?: typeof fetch;
}): Promise<AiReviewResult> {
  const apiKey = input.apiKey?.trim() || Deno.env.get("OPENAI_API_KEY")?.trim();
  if (!apiKey) throw new AiReviewError("missing_openai_key", "AI review is unavailable because OPENAI_API_KEY is not configured.", 503);
  const model = input.model?.trim() || Deno.env.get("AI_ANALYSIS_MODEL")?.trim() || defaultModel;
  const promptVersion = input.promptVersion?.trim() || AI_FUTURES_PROMPT_VERSION;
  const fetchImpl = input.fetchImpl ?? fetch;
  const startedAt = Date.now();
  const body = {
    model,
    store: false,
    max_output_tokens: 1_200,
    reasoning: { effort: "low" },
    input: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: JSON.stringify({
          deterministic_candidate: input.candidate,
          deterministic_features: compactFeatures(input.features),
          prompt_version: promptVersion
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ai_futures_review",
        strict: true,
        schema: reviewSchema
      }
    }
  };

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(openAiResponsesEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < maximumAttempts) continue;
        throw new AiReviewError("openai_http_error", `OpenAI review returned HTTP ${response.status}.`, 503);
      }
      const outputText = extractOutputText(payload);
      let parsed: unknown;
      try {
        parsed = JSON.parse(outputText);
      } catch {
        throw new AiReviewError("invalid_ai_json", "OpenAI returned invalid structured JSON.", 503);
      }
      const review = validateStructuredReview(parsed);
      if (reviewHasUnapprovedNumbers(review)) {
        throw new AiReviewError("ai_introduced_numbers", "AI review introduced unapproved numeric claims.", 503);
      }
      const record = isRecord(payload) ? payload : {};
      const usage = isRecord(record.usage) ? record.usage : {};
      return {
        review,
        model,
        responseId: typeof record.id === "string" ? record.id : "unknown",
        promptVersion,
        inputTokens: safeInteger(usage.input_tokens),
        outputTokens: safeInteger(usage.output_tokens),
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      lastError = error;
      if (error instanceof AiReviewError || attempt === maximumAttempts) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastError instanceof AiReviewError) throw lastError;
  throw new AiReviewError("openai_unavailable", "OpenAI review timed out or was unavailable.", 503);
}

export function validateStructuredReview(value: unknown): AiStructuredReview {
  if (!isRecord(value)) throw new AiReviewError("invalid_ai_schema", "AI response was not an object.", 503);
  const verdicts = ["APPROVE", "DOWNGRADE_TO_WAIT", "REJECT"];
  if (!verdicts.includes(String(value.verdict))) throw new AiReviewError("invalid_ai_schema", "AI verdict was invalid.", 503);
  const review: AiStructuredReview = {
    verdict: value.verdict as AiStructuredReview["verdict"],
    market_summary: requiredText(value.market_summary, "market_summary", 1_200),
    primary_thesis: requiredText(value.primary_thesis, "primary_thesis", 1_200),
    supporting_factors: stringArray(value.supporting_factors, "supporting_factors"),
    conflicting_factors: stringArray(value.conflicting_factors, "conflicting_factors"),
    invalidation_explanation: requiredText(value.invalidation_explanation, "invalidation_explanation", 1_200),
    risk_notes: stringArray(value.risk_notes, "risk_notes"),
    educational_explanation: requiredText(value.educational_explanation, "educational_explanation", 1_500)
  };
  return review;
}

function extractOutputText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new AiReviewError("invalid_ai_response", "OpenAI response did not contain output.", 503);
  }
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      if (content.type === "refusal") throw new AiReviewError("ai_refusal", "OpenAI declined to review this candidate.", 503);
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new AiReviewError("missing_ai_output", "OpenAI response contained no structured text.", 503);
}

function compactFeatures(features: AiMarketFeatures) {
  return {
    candle_close_at: features.candleCloseAt,
    multi_timeframe_trend: features.multiTimeframeTrend,
    trend_alignment_score: features.trendAlignmentScore,
    regime: features.regime,
    current_distance_from_ema_atr: features.currentDistanceFromEma20Atr,
    funding_interpretation: features.fundingInterpretation,
    positioning_crowding: features.positioningCrowding,
    open_interest_direction: features.openInterestDirection,
    taker_flow: features.takerFlow,
    timeframes: Object.fromEntries(Object.entries(features.timeframes).map(([key, value]) => [key, {
      trend: value.trend,
      structure: value.structure,
      rsi: value.rsi14,
      macd_histogram: value.macdHistogram,
      atr_percent: value.atrPercent,
      adx: value.adx14,
      volume_z_score: value.volumeZScore
    }]))
  };
}

function reviewHasUnapprovedNumbers(review: AiStructuredReview): boolean {
  const text = [
    review.market_summary,
    review.primary_thesis,
    review.invalidation_explanation,
    review.educational_explanation,
    ...review.supporting_factors,
    ...review.conflicting_factors,
    ...review.risk_notes
  ].join(" ");
  return /\b\d+(?:[.,]\d+)?(?:%|x|\b)/i.test(text);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new AiReviewError("invalid_ai_schema", `${field} must be text.`, 503);
  const text = value.trim();
  if (!text || text.length > maxLength) throw new AiReviewError("invalid_ai_schema", `${field} length is invalid.`, 503);
  return text;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 10) throw new AiReviewError("invalid_ai_schema", `${field} must be a bounded array.`, 503);
  return value.map((item) => requiredText(item, field, 500));
}

function safeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function safeJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const systemPrompt = `You are a conservative educational reviewer for a deterministic BTCUSDT futures-analysis engine.
You receive finalized market features and a candidate whose prices, direction, score and risk rules were calculated by code.
You may approve the candidate, downgrade it to waiting, or reject it. Never upgrade a rejected or no-trade candidate.
Do not fetch data, calculate indicators, invent prices, change levels, size positions, claim certainty, or promise returns.
Do not include digits or numeric claims in any prose field; the application renders approved numbers separately.
Prefer rejection when evidence is contradictory. Explain uncertainty and educational risk plainly.`;

const stringListSchema = {
  type: "array",
  items: { type: "string" },
  maxItems: 10
};

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["APPROVE", "DOWNGRADE_TO_WAIT", "REJECT"] },
    market_summary: { type: "string" },
    primary_thesis: { type: "string" },
    supporting_factors: stringListSchema,
    conflicting_factors: stringListSchema,
    invalidation_explanation: { type: "string" },
    risk_notes: stringListSchema,
    educational_explanation: { type: "string" }
  },
  required: [
    "verdict",
    "market_summary",
    "primary_thesis",
    "supporting_factors",
    "conflicting_factors",
    "invalidation_explanation",
    "risk_notes",
    "educational_explanation"
  ]
};

export class AiReviewError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "AiReviewError";
  }
}
