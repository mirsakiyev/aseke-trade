import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.45.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const TRANSFER_TOPIC =
  "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TRON_USDT_CONTRACT_HEX = "a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const ETH_USDT_CONTRACT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const ETH_USDC_CONTRACT = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MIN_DEPOSIT_CENTS = 1000;
const PAYMENT_AMOUNT_NONCE_MAX = 4_999;
const CLAIM_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const CLAIM_RATE_LIMIT_MAX_ATTEMPTS = 20;
const ACTIVE_PAYMENT_STATUSES: PaymentStatus[] = ["pending", "submitted", "detected", "confirming", "verifying"];

export type SupportedAsset = "USDT" | "USDC";
export type SupportedNetwork = "TRC20" | "ERC20";
export type ProductType = "premium" | "course" | "guide" | "deposit";
export type PremiumPlanId = "premium_1_month" | "premium_1_year";
export type PaymentStatus =
  | "pending"
  | "submitted"
  | "detected"
  | "confirming"
  | "verifying"
  | "confirmed"
  | "credited"
  | "underpaid"
  | "overpaid"
  | "expired"
  | "failed"
  | "rejected"
  | "duplicate";

export interface PaymentMethodConfig {
  id: string;
  asset: SupportedAsset;
  network: SupportedNetwork;
  envName: string;
  minConfirmations: number;
  tokenContract: string;
  decimals: number;
}

export interface CryptoPaymentRow {
  id: string;
  user_id: string;
  course_id: string | null;
  guide_id: string | null;
  payment_type: "purchase" | "deposit";
  product_type: ProductType;
  product_label: string | null;
  plan_id: PremiumPlanId | null;
  plan_duration_months: number | null;
  fiat_amount_cents: number | null;
  fiat_currency: "USD";
  premium_starts_at: string | null;
  premium_expires_at: string | null;
  payment_method_id: string;
  expected_amount: string | number;
  received_amount: string | number | null;
  amount_nonce_units: number;
  asset: SupportedAsset;
  network: SupportedNetwork;
  receive_address: string;
  tx_hash: string | null;
  status: PaymentStatus;
  verification_event_index: number | null;
  verification_token_contract: string | null;
  verification_recipient_address: string | null;
  verification_confirmations: number | null;
  verification_checked_at: string | null;
  rejected_reason: string | null;
  expires_at: string;
  submitted_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CryptoPaymentMethodRow {
  id: string;
  asset: SupportedAsset;
  network: SupportedNetwork;
  receive_address: string;
  min_confirmations: number;
  is_active: boolean;
}

interface VerificationResult {
  status: "valid" | "underpaid" | "overpaid" | "failed" | "waiting";
  receivedAmount?: string;
  confirmations?: number;
  eventIndex?: number;
  tokenContract?: string;
  recipientAddress?: string;
  reason?: string;
}

interface CryptoTransferEvent {
  units: bigint;
  eventIndex: number;
  tokenContract: string;
  recipientAddress: string;
}

interface PremiumPlanConfig {
  id: PremiumPlanId;
  productLabel: "Trading Academy";
  durationMonths: number;
  durationLabel: string;
  priceCents: number;
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const paymentMethodConfigs: PaymentMethodConfig[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    asset: "USDT",
    network: "TRC20",
    envName: "TRON_USDT_RECEIVE_ADDRESS",
    minConfirmations: 19,
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    decimals: 6
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    asset: "USDT",
    network: "ERC20",
    envName: "ETH_USDT_RECEIVE_ADDRESS",
    minConfirmations: 12,
    tokenContract: ETH_USDT_CONTRACT,
    decimals: 6
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    asset: "USDC",
    network: "ERC20",
    envName: "ETH_USDC_RECEIVE_ADDRESS",
    minConfirmations: 12,
    tokenContract: ETH_USDC_CONTRACT,
    decimals: 6
  }
];

export const premiumPlanConfigs: PremiumPlanConfig[] = [
  {
    id: "premium_1_month",
    productLabel: "Trading Academy",
    durationMonths: 1,
    durationLabel: "1 month",
    priceCents: 1000
  },
  {
    id: "premium_1_year",
    productLabel: "Trading Academy",
    durationMonths: 12,
    durationLabel: "1 year",
    priceCents: 5000
  }
];

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

export function handleOptions(request: Request): Response | null {
  return request.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

export function handleError(error: unknown): Response {
  const requestId = crypto.randomUUID();

  if (error instanceof ApiError) {
    console.error("Crypto payment API error", {
      requestId,
      status: error.status,
      code: error.code,
      message: error.message
    });
    return jsonResponse({ error: error.message, code: error.code, request_id: requestId }, error.status);
  }

  const message = error instanceof Error ? error.message : "Unknown server error";
  console.error("Crypto payment internal error", {
    requestId,
    message,
    stack: error instanceof Error ? error.stack : undefined
  });

  return jsonResponse({ error: "Crypto payment request failed.", code: "internal_error", request_id: requestId }, 500);
}

function supabaseErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";

  const dbError = error as {
    code?: unknown;
    message?: unknown;
    hint?: unknown;
  };
  const parts = [dbError.code, dbError.message, dbError.hint]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);

  return [...new Set(parts)].join(" ");
}

function logSupabaseError(context: string, error: unknown): void {
  console.error(context, {
    detail: supabaseErrorMessage(error),
    error
  });
}

function paymentMethodSyncError(action: "checked" | "prepared" | "activated", error: unknown): ApiError {
  const detail = supabaseErrorMessage(error);
  const suffix = detail ? ` Database detail: ${detail}` : "";
  return new ApiError(
    500,
    "payment_method_sync_failed",
    `Crypto payment methods could not be ${action}.${suffix}`
  );
}

export function getServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new ApiError(500, "missing_supabase_secrets", "Supabase server secrets are not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export async function getAuthenticatedUser(request: Request, supabase: SupabaseClient): Promise<User> {
  const token = getBearerToken(request);
  if (!token) {
    throw new ApiError(401, "auth_required", "Sign in before using crypto checkout.");
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new ApiError(401, "invalid_session", "Your session could not be verified.");
  }

  return data.user;
}

export function requireServiceRole(request: Request): void {
  const token = getBearerToken(request);
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")?.trim();

  if (!serviceRoleKey || token !== serviceRoleKey) {
    throw new ApiError(403, "server_only", "Payment verification is server-only.");
  }
}

export async function enforceCryptoClaimRateLimit(supabase: SupabaseClient, userId: string): Promise<void> {
  const windowStart = new Date(Date.now() - CLAIM_RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from("crypto_payment_claim_attempts")
    .select("id", { count: "exact", head: true })
    .eq("attempted_user_id", userId)
    .gte("created_at", windowStart);

  if (error) {
    throw new ApiError(500, "claim_rate_limit_failed", "Transaction claim rate limit could not be checked.");
  }

  if ((count ?? 0) >= CLAIM_RATE_LIMIT_MAX_ATTEMPTS) {
    throw new ApiError(429, "claim_rate_limited", "Too many transaction checks. Try again shortly.");
  }
}

export async function logCryptoClaimAttempt(
  supabase: SupabaseClient,
  input: {
    attemptedUserId: string | null;
    payment?: Pick<CryptoPaymentRow, "id" | "user_id" | "asset" | "network"> | null;
    txHash?: string | null;
    status: string;
    reason?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await supabase.from("crypto_payment_claim_attempts").insert({
    attempted_user_id: input.attemptedUserId,
    payment_id: input.payment?.id ?? null,
    payment_user_id: input.payment?.user_id ?? null,
    asset: input.payment?.asset ?? null,
    network: input.payment?.network ?? null,
    tx_hash: input.txHash ?? null,
    status: input.status,
    reason: input.reason ?? null,
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
    metadata: input.metadata ?? {}
  });

  if (error) {
    console.error("Crypto claim audit log insert failed", {
      detail: supabaseErrorMessage(error),
      error
    });
  }
}

export function normalizeAssetNetwork(asset: unknown, network: unknown): {
  asset: SupportedAsset;
  network: SupportedNetwork;
} {
  const normalizedAsset = String(asset ?? "").trim().toUpperCase();
  const normalizedNetwork = String(network ?? "").trim().toUpperCase();
  const config = paymentMethodConfigs.find(
    (method) => method.asset === normalizedAsset && method.network === normalizedNetwork
  );

  if (!config) {
    throw new ApiError(400, "unsupported_payment_method", "Select a supported crypto payment method.");
  }

  return { asset: config.asset, network: config.network };
}

export function normalizeTxHash(txHash: unknown, network: SupportedNetwork): string {
  const value = String(txHash ?? "").trim();
  if (network === "ERC20") {
    if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
      throw new ApiError(400, "invalid_tx_hash", "Enter a valid Ethereum transaction hash.");
    }
    return value.toLowerCase();
  }

  const tronHash = value.replace(/^0x/i, "");
  if (!/^[a-fA-F0-9]{64}$/.test(tronHash)) {
    throw new ApiError(400, "invalid_tx_hash", "Enter a valid TRON transaction ID.");
  }
  return tronHash.toLowerCase();
}

export async function syncConfiguredPaymentMethods(supabase: SupabaseClient): Promise<void> {
  for (const method of paymentMethodConfigs) {
    const address = Deno.env.get(method.envName)?.trim() ?? "";
    const { data: existing, error: lookupError } = await supabase
      .from("crypto_payment_methods")
      .select("id,receive_address")
      .eq("id", method.id)
      .maybeSingle();

    if (lookupError) {
      logSupabaseError("Crypto payment method lookup failed", lookupError);
      throw paymentMethodSyncError("checked", lookupError);
    }

    if (!existing) {
      const { error: insertError } = await supabase.from("crypto_payment_methods").insert({
        id: method.id,
        asset: method.asset,
        network: method.network,
        receive_address: address || `configure:${method.envName}`,
        min_confirmations: method.minConfirmations,
        is_active: Boolean(address)
      });

      if (insertError) {
        logSupabaseError("Crypto payment method insert failed", insertError);
        throw paymentMethodSyncError("prepared", insertError);
      }

      continue;
    }

    if (address && String(existing.receive_address).startsWith("configure:")) {
      const { error: updateError } = await supabase
        .from("crypto_payment_methods")
        .update({
          receive_address: address,
          min_confirmations: method.minConfirmations,
          is_active: true
        })
        .eq("id", method.id);

      if (updateError) {
        logSupabaseError("Crypto payment method activation failed", updateError);
        throw paymentMethodSyncError("activated", updateError);
      }
    }
  }
}

export async function getActivePaymentMethod(
  supabase: SupabaseClient,
  asset: SupportedAsset,
  network: SupportedNetwork
): Promise<{ config: PaymentMethodConfig; row: CryptoPaymentMethodRow }> {
  await syncConfiguredPaymentMethods(supabase);

  const config = paymentMethodConfigs.find((method) => method.asset === asset && method.network === network);
  if (!config) {
    throw new ApiError(400, "unsupported_payment_method", "Select a supported crypto payment method.");
  }

  const { data, error } = await supabase
    .from("crypto_payment_methods")
    .select("id,asset,network,receive_address,min_confirmations,is_active")
    .eq("asset", asset)
    .eq("network", network)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    throw new ApiError(400, "payment_method_unavailable", "This crypto payment method is not configured yet.");
  }

  return { config, row: data as CryptoPaymentMethodRow };
}

export function centsToStableAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function getPremiumPlan(planId: unknown): PremiumPlanConfig {
  const normalizedPlanId = String(planId ?? "").trim();
  const plan = premiumPlanConfigs.find((item) => item.id === normalizedPlanId);

  if (!plan) {
    throw new ApiError(400, "invalid_premium_plan", "Choose a valid Trading Academy plan.");
  }

  return plan;
}

export function normalizeDepositAmount(amount: unknown): {
  expectedAmount: string;
  amountCents: number;
} {
  const value = String(amount ?? "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(value)) {
    throw new ApiError(400, "invalid_deposit_amount", "Enter a valid deposit amount.");
  }

  const numericAmount = Number(value);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new ApiError(400, "invalid_deposit_amount", "Deposit amount must be greater than zero.");
  }

  const amountCents = Math.round(numericAmount * 100);
  if (amountCents < MIN_DEPOSIT_CENTS) {
    throw new ApiError(400, "deposit_too_small", "Minimum deposit is 10 USD.");
  }

  return {
    expectedAmount: centsToStableAmount(amountCents),
    amountCents
  };
}

export async function reserveUniqueExpectedAmount(
  supabase: SupabaseClient,
  method: CryptoPaymentMethodRow,
  config: PaymentMethodConfig,
  baseExpectedAmount: string | number
): Promise<{ expectedAmount: string; amountNonceUnits: number }> {
  // Shared receiving wallets cannot prove ownership from a tx hash alone.
  // A tiny server-selected amount nonce binds the on-chain transfer to this intent without changing cent-level billing.
  const baseUnits = decimalToUnits(baseExpectedAmount, config.decimals);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const amountNonceUnits = secureRandomInt(1, PAYMENT_AMOUNT_NONCE_MAX);
    const expectedAmount = unitsToDecimalString(baseUnits + BigInt(amountNonceUnits), config.decimals);
    const { data, error } = await supabase
      .from("crypto_payments")
      .select("id")
      .eq("payment_method_id", method.id)
      .eq("asset", method.asset)
      .eq("network", method.network)
      .eq("receive_address", method.receive_address)
      .eq("expected_amount", expectedAmount)
      .in("status", ACTIVE_PAYMENT_STATUSES)
      .limit(1);

    if (error) {
      throw new ApiError(500, "amount_reservation_failed", "Payment amount could not be reserved.");
    }

    if (!data?.length) {
      return { expectedAmount, amountNonceUnits };
    }
  }

  throw new ApiError(503, "amount_reservation_exhausted", "Payment amount could not be reserved. Try again.");
}

function secureRandomInt(min: number, max: number): number {
  const range = max - min + 1;
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return min + (random[0] % range);
}

export async function resolveCheckoutItem(
  supabase: SupabaseClient,
  body: Record<string, unknown>
): Promise<{
  courseId: string | null;
  guideId: string | null;
  productType: ProductType;
  productLabel: string;
  planId: PremiumPlanId | null;
  planDurationMonths: number | null;
  title: string;
  expectedAmount: string;
  amountCents: number;
}> {
  const productType = String(body.product_type ?? "").trim().toLowerCase();
  if (productType === "premium") {
    const plan = getPremiumPlan(body.plan_id);

    return {
      courseId: null,
      guideId: null,
      productType: "premium",
      productLabel: plan.productLabel,
      planId: plan.id,
      planDurationMonths: plan.durationMonths,
      title: plan.productLabel,
      expectedAmount: centsToStableAmount(plan.priceCents),
      amountCents: plan.priceCents
    };
  }

  const courseId = typeof body.course_id === "string" ? body.course_id.trim() : "";
  const guideId = typeof body.guide_id === "string" ? body.guide_id.trim() : "";

  if ((courseId && guideId) || (!courseId && !guideId)) {
    throw new ApiError(400, "invalid_checkout_item", "Choose exactly one paid course or guide.");
  }

  if (courseId) {
    const { data, error } = await supabase
      .from("courses")
      .select("id,title,price_cents,is_premium,is_archived")
      .eq("id", courseId)
      .maybeSingle();

    if (error || !data) {
      throw new ApiError(404, "course_not_found", "This course is not available.");
    }

    const course = data as { id: string; title: string; price_cents: number; is_premium: boolean; is_archived: boolean };
    if (course.is_archived || !course.is_premium || course.price_cents <= 0) {
      throw new ApiError(400, "course_not_purchasable", "This course is not configured for paid crypto checkout.");
    }

    return {
      courseId: course.id,
      guideId: null,
      productType: "course",
      productLabel: course.title,
      planId: null,
      planDurationMonths: null,
      title: course.title,
      expectedAmount: centsToStableAmount(course.price_cents),
      amountCents: course.price_cents
    };
  }

  const { data, error } = await supabase
    .from("guides")
    .select("id,title,price_cents,is_premium,is_archived,course:courses(id,title,price_cents,is_premium,is_archived)")
    .eq("id", guideId)
    .maybeSingle();

  if (error || !data) {
    throw new ApiError(404, "guide_not_found", "This guide is not available.");
  }

  const guide = data as {
    id: string;
    title: string;
    price_cents: number;
    is_premium: boolean;
    is_archived: boolean;
    course?: { price_cents: number; is_premium: boolean; is_archived: boolean } | null;
  };
  const course = Array.isArray(guide.course) ? guide.course[0] : guide.course;
  const isPremium = guide.is_premium || Boolean(course?.is_premium);
  const priceCents = guide.price_cents > 0 ? guide.price_cents : course?.price_cents ?? 0;

  if (guide.is_archived || course?.is_archived || !isPremium || priceCents <= 0) {
    throw new ApiError(400, "guide_not_purchasable", "This guide is not configured for paid crypto checkout.");
  }

  return {
    courseId: null,
    guideId: guide.id,
    productType: "guide",
    productLabel: guide.title,
    planId: null,
    planDurationMonths: null,
    title: guide.title,
    expectedAmount: centsToStableAmount(priceCents),
    amountCents: priceCents
  };
}

export async function verifyPaymentById(
  supabase: SupabaseClient,
  paymentId: string,
  attemptedUserId: string | null = null
): Promise<CryptoPaymentRow> {
  const { data, error } = await supabase
    .from("crypto_payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();

  if (error || !data) {
    throw new ApiError(404, "payment_not_found", "Payment could not be found.");
  }

  const payment = data as CryptoPaymentRow;
  if (payment.status === "credited") {
    return payment;
  }

  if (payment.status === "confirmed") {
    return finalizeConfirmedPayment(supabase, payment);
  }

  if (!payment.tx_hash) {
    throw new ApiError(400, "tx_hash_required", "Submit a transaction hash before verification.");
  }

  const method = paymentMethodConfigs.find(
    (config) => config.asset === payment.asset && config.network === payment.network
  );
  if (!method) {
    await logCryptoClaimAttempt(supabase, {
      attemptedUserId,
      payment,
      txHash: payment.tx_hash,
      status: "failed",
      reason: "Unsupported payment method during verification."
    });
    return updatePaymentStatus(supabase, payment.id, "failed", {
      rejected_reason: "Unsupported payment method."
    });
  }

  const verification =
    payment.network === "TRC20"
      ? await verifyTronPayment(payment, method)
      : await verifyEthereumPayment(payment, method);

  if (verification.status === "waiting") {
    return updatePaymentStatus(supabase, payment.id, verification.receivedAmount ? "confirming" : "verifying", {
      received_amount: verification.receivedAmount ?? null,
      verification_confirmations: verification.confirmations ?? null,
      verification_checked_at: new Date().toISOString(),
      rejected_reason: verification.reason ?? null
    });
  }

  if (verification.status === "underpaid") {
    await logCryptoClaimAttempt(supabase, {
      attemptedUserId,
      payment,
      txHash: payment.tx_hash,
      status: "underpaid",
      reason: verification.reason ?? "On-chain transfer amount is lower than the exact payment intent amount.",
      metadata: { receivedAmount: verification.receivedAmount }
    });
    return updatePaymentStatus(supabase, payment.id, "underpaid", {
      received_amount: verification.receivedAmount ?? null,
      verification_confirmations: verification.confirmations ?? null,
      verification_checked_at: new Date().toISOString(),
      rejected_reason: verification.reason ?? "Payment amount is too low."
    });
  }

  if (verification.status === "overpaid") {
    await logCryptoClaimAttempt(supabase, {
      attemptedUserId,
      payment,
      txHash: payment.tx_hash,
      status: "overpaid",
      reason: verification.reason ?? "On-chain transfer amount is higher than the exact payment intent amount.",
      metadata: { receivedAmount: verification.receivedAmount }
    });
    return updatePaymentStatus(supabase, payment.id, "overpaid", {
      received_amount: verification.receivedAmount ?? null,
      verification_confirmations: verification.confirmations ?? null,
      verification_checked_at: new Date().toISOString(),
      rejected_reason: verification.reason ?? "Payment amount is too high."
    });
  }

  if (verification.status === "failed") {
    await logCryptoClaimAttempt(supabase, {
      attemptedUserId,
      payment,
      txHash: payment.tx_hash,
      status: "rejected",
      reason: verification.reason ?? "Transaction does not match this payment intent."
    });
    return updatePaymentStatus(supabase, payment.id, "rejected", {
      verification_checked_at: new Date().toISOString(),
      rejected_reason: verification.reason ?? "Transaction does not match this payment intent."
    });
  }

  const processed = await recordProcessedTransaction(supabase, payment, verification);
  if (!processed) {
    await logCryptoClaimAttempt(supabase, {
      attemptedUserId,
      payment,
      txHash: payment.tx_hash,
      status: "duplicate",
      reason: "Verified blockchain event was already processed for another payment."
    });
    return updatePaymentStatus(supabase, payment.id, "duplicate", {
      verification_event_index: verification.eventIndex ?? null,
      verification_token_contract: verification.tokenContract ?? null,
      verification_recipient_address: verification.recipientAddress ?? null,
      verification_confirmations: verification.confirmations ?? null,
      verification_checked_at: new Date().toISOString(),
      rejected_reason: "This blockchain transfer event was already credited."
    });
  }

  const confirmed = await updatePaymentStatus(supabase, payment.id, "confirmed", {
    received_amount: verification.receivedAmount ?? payment.expected_amount,
    confirmed_at: new Date().toISOString(),
    verification_event_index: verification.eventIndex ?? null,
    verification_token_contract: verification.tokenContract ?? null,
    verification_recipient_address: verification.recipientAddress ?? null,
    verification_confirmations: verification.confirmations ?? null,
    verification_checked_at: new Date().toISOString(),
    rejected_reason: null
  });

  await logCryptoClaimAttempt(supabase, {
    attemptedUserId,
    payment: confirmed,
    txHash: confirmed.tx_hash,
    status: "confirmed",
    reason: "Transaction matched the authenticated user's payment intent.",
    metadata: {
      eventIndex: verification.eventIndex,
      confirmations: verification.confirmations,
      tokenContract: verification.tokenContract
    }
  });

  return finalizeConfirmedPayment(supabase, confirmed);
}

async function finalizeConfirmedPayment(supabase: SupabaseClient, payment: CryptoPaymentRow): Promise<CryptoPaymentRow> {
  if (payment.payment_type === "deposit") {
    const { error } = await supabase.rpc("credit_crypto_deposit", {
      target_payment_id: payment.id
    });

    if (error) {
      throw new ApiError(500, "deposit_credit_failed", "Account balance could not be credited.");
    }

    return fetchPaymentById(supabase, payment.id);
  }

  if (payment.product_type === "premium") {
    const { error } = await supabase.rpc("activate_premium_subscription_from_payment", {
      target_payment_id: payment.id
    });

    if (error) {
      throw new ApiError(500, "premium_subscription_failed", "Trading Academy access could not be activated.");
    }

    return fetchPaymentById(supabase, payment.id);
  }

  await grantAccessFromPayment(supabase, payment);
  return fetchPaymentById(supabase, payment.id);
}

async function fetchPaymentById(supabase: SupabaseClient, paymentId: string): Promise<CryptoPaymentRow> {
  const { data, error } = await supabase
    .from("crypto_payments")
    .select("*")
    .eq("id", paymentId)
    .single();

  if (error || !data) {
    throw new ApiError(500, "payment_reload_failed", "Payment could not be reloaded.");
  }

  return data as CryptoPaymentRow;
}

async function recordProcessedTransaction(
  supabase: SupabaseClient,
  payment: CryptoPaymentRow,
  verification: VerificationResult
): Promise<boolean> {
  if (!payment.tx_hash || verification.eventIndex === undefined || !verification.tokenContract || !verification.recipientAddress) {
    throw new ApiError(500, "verified_event_missing", "Verified blockchain event details are incomplete.");
  }

  const { error } = await supabase.from("crypto_processed_transactions").insert({
    payment_id: payment.id,
    user_id: payment.user_id,
    asset: payment.asset,
    network: payment.network,
    tx_hash: payment.tx_hash,
    event_index: verification.eventIndex,
    token_contract: verification.tokenContract,
    receive_address: verification.recipientAddress,
    amount: verification.receivedAmount ?? payment.expected_amount,
    confirmations: verification.confirmations ?? 0
  });

  if (!error) return true;
  if (error.code === "23505") return false;

  throw new ApiError(500, "processed_transaction_insert_failed", "Verified transaction could not be recorded.");
}

async function updatePaymentStatus(
  supabase: SupabaseClient,
  paymentId: string,
  status: PaymentStatus,
  extras: Partial<
    Pick<
      CryptoPaymentRow,
      | "received_amount"
      | "confirmed_at"
      | "submitted_at"
      | "tx_hash"
      | "verification_event_index"
      | "verification_token_contract"
      | "verification_recipient_address"
      | "verification_confirmations"
      | "verification_checked_at"
      | "rejected_reason"
    >
  > = {}
): Promise<CryptoPaymentRow> {
  const { data, error } = await supabase
    .from("crypto_payments")
    .update({ status, ...extras })
    .eq("id", paymentId)
    .select("*")
    .single();

  if (error || !data) {
    throw new ApiError(500, "payment_update_failed", "Payment status could not be updated.");
  }

  return data as CryptoPaymentRow;
}

async function grantAccessFromPayment(supabase: SupabaseClient, payment: CryptoPaymentRow): Promise<void> {
  const accessColumn = payment.course_id ? "course_id" : "guide_id";
  const accessId = payment.course_id ?? payment.guide_id;
  if (!accessId) return;

  const existingAccessQuery = supabase
    .from("premium_access")
    .select("id")
    .eq("user_id", payment.user_id)
    .eq(accessColumn, accessId)
    .limit(1);
  const { data: existingAccess, error: accessLookupError } = await existingAccessQuery;

  if (accessLookupError) {
      throw new ApiError(500, "access_lookup_failed", "Trading Academy access could not be checked.");
  }

  if (!existingAccess?.length) {
    const { error: accessInsertError } = await supabase.from("premium_access").insert({
      user_id: payment.user_id,
      course_id: payment.course_id,
      guide_id: payment.guide_id,
      payment_id: payment.id,
      access_type: "verified_purchase"
    });

    if (accessInsertError && accessInsertError.code !== "23505") {
      throw new ApiError(500, "access_insert_failed", "Trading Academy access could not be granted.");
    }
  }

  const purchaseQuery = supabase
    .from("purchases")
    .select("id")
    .eq("user_id", payment.user_id)
    .eq(accessColumn, accessId)
    .in("status", ["paid", "active", "granted"])
    .limit(1);
  const { data: existingPurchase, error: purchaseLookupError } = await purchaseQuery;

  if (purchaseLookupError) {
    throw new ApiError(500, "purchase_lookup_failed", "Purchase access could not be checked.");
  }

  if (!existingPurchase?.length) {
    const { error: purchaseInsertError } = await supabase.from("purchases").insert({
      user_id: payment.user_id,
      course_id: payment.course_id,
      guide_id: payment.guide_id,
      status: "paid",
      payment_provider: "crypto",
      payment_reference: payment.id,
      amount_cents: Math.round(Number(payment.expected_amount) * 100)
    });

    if (purchaseInsertError && purchaseInsertError.code !== "23505") {
      throw new ApiError(500, "purchase_insert_failed", "Purchase record could not be created.");
    }
  }
}

async function verifyEthereumPayment(
  payment: CryptoPaymentRow,
  method: PaymentMethodConfig
): Promise<VerificationResult> {
  const receipt = await etherscanProxy("eth_getTransactionReceipt", payment.tx_hash ?? "");

  if (!receipt) {
    return { status: "waiting", reason: "Transaction receipt is not indexed yet." };
  }

  if (String(receipt.status).toLowerCase() !== "0x1") {
    return { status: "failed", reason: "Ethereum transaction failed." };
  }

  const blockNumber = hexToNumber(receipt.blockNumber);
  const currentBlockHex = await etherscanProxy("eth_blockNumber");
  const currentBlock = typeof currentBlockHex === "string" ? hexToNumber(currentBlockHex) : null;
  const confirmations = blockNumber && currentBlock ? currentBlock - blockNumber + 1 : 0;
  const expectedUnits = decimalToUnits(payment.expected_amount, method.decimals);
  const transferEvents = getEthereumTransferEvents(receipt.logs ?? [], method, payment.receive_address);

  if (!transferEvents.length) {
    return { status: "failed", reason: "No matching ERC20 transfer to ASEKE TRADE address." };
  }

  // Exact amount matching is required while wallets are shared; accepting >= would let a copied tx hash satisfy
  // another user's intent if the amount was close enough.
  const exactTransfer = transferEvents.find((event) => event.units === expectedUnits);
  if (!exactTransfer) {
    const largestTransfer = transferEvents.reduce((largest, event) => (event.units > largest.units ? event : largest));
    const receivedAmount = unitsToDecimalString(largestTransfer.units, method.decimals);
    return {
      status: largestTransfer.units < expectedUnits ? "underpaid" : "overpaid",
      receivedAmount,
      confirmations,
      reason: "Transfer amount does not exactly match this payment intent."
    };
  }

  const receivedAmount = unitsToDecimalString(exactTransfer.units, method.decimals);

  if (confirmations < method.minConfirmations) {
    return { status: "waiting", receivedAmount, confirmations };
  }

  return {
    status: "valid",
    receivedAmount,
    confirmations,
    eventIndex: exactTransfer.eventIndex,
    tokenContract: exactTransfer.tokenContract,
    recipientAddress: exactTransfer.recipientAddress
  };
}

async function verifyTronPayment(
  payment: CryptoPaymentRow,
  method: PaymentMethodConfig
): Promise<VerificationResult> {
  const txInfo = await tronPost("walletsolidity/gettransactioninfobyid", {
    value: payment.tx_hash
  });

  if (!txInfo?.id) {
    return { status: "waiting", reason: "TRON transaction is not confirmed yet." };
  }

  if (String(txInfo.receipt?.result ?? "").toUpperCase() !== "SUCCESS") {
    return { status: "failed", reason: "TRON transaction failed." };
  }

  const expectedUnits = decimalToUnits(payment.expected_amount, method.decimals);
  const transferEvents = await getTronTransferEvents(txInfo.log ?? [], method, payment.receive_address);
  if (!transferEvents.length) {
    return { status: "failed", reason: "No matching TRC20 transfer to ASEKE TRADE address." };
  }

  const nowBlock = await tronPost("wallet/getnowblock", {});
  const currentBlock = Number(nowBlock?.block_header?.raw_data?.number ?? 0);
  const transactionBlock = Number(txInfo.blockNumber ?? 0);
  const confirmations =
    currentBlock > 0 && transactionBlock > 0 ? currentBlock - transactionBlock + 1 : method.minConfirmations;
  // Exact amount matching is required while wallets are shared; accepting >= would let a copied tx hash satisfy
  // another user's intent if the amount was close enough.
  const exactTransfer = transferEvents.find((event) => event.units === expectedUnits);
  if (!exactTransfer) {
    const largestTransfer = transferEvents.reduce((largest, event) => (event.units > largest.units ? event : largest));
    const receivedAmount = unitsToDecimalString(largestTransfer.units, method.decimals);
    return {
      status: largestTransfer.units < expectedUnits ? "underpaid" : "overpaid",
      receivedAmount,
      confirmations,
      reason: "Transfer amount does not exactly match this payment intent."
    };
  }

  const receivedAmount = unitsToDecimalString(exactTransfer.units, method.decimals);

  if (confirmations < method.minConfirmations) {
    return { status: "waiting", receivedAmount, confirmations };
  }

  return {
    status: "valid",
    receivedAmount,
    confirmations,
    eventIndex: exactTransfer.eventIndex,
    tokenContract: exactTransfer.tokenContract,
    recipientAddress: exactTransfer.recipientAddress
  };
}

async function etherscanProxy(action: string, txHash?: string): Promise<Record<string, unknown> | string | null> {
  const apiKey = Deno.env.get("ETHERSCAN_API_KEY")?.trim();
  if (!apiKey) {
    throw new ApiError(500, "missing_etherscan_key", "Etherscan API key is not configured.");
  }

  const params = new URLSearchParams({
    chainid: "1",
    module: "proxy",
    action,
    apikey: apiKey
  });
  if (txHash) params.set("txhash", txHash);

  const response = await fetch(`https://api.etherscan.io/v2/api?${params.toString()}`);
  if (response.status === 429) {
    throw new ApiError(429, "etherscan_rate_limited", "Blockchain explorer is rate limited. Try again shortly.");
  }

  if (!response.ok) {
    throw new ApiError(502, "etherscan_request_failed", "Etherscan verification request failed.");
  }

  const body = await response.json();
  if ("error" in body) {
    throw new ApiError(502, "etherscan_error", "Etherscan returned an error.");
  }

  return body.result ?? null;
}

async function tronPost(path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const apiKey = Deno.env.get("TRONGRID_API_KEY")?.trim();
  if (!apiKey) {
    throw new ApiError(500, "missing_trongrid_key", "TronGrid API key is not configured.");
  }

  const response = await fetch(`https://api.trongrid.io/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "TRON-PRO-API-KEY": apiKey
    },
    body: JSON.stringify(body)
  });

  if (response.status === 429) {
    throw new ApiError(429, "trongrid_rate_limited", "Blockchain explorer is rate limited. Try again shortly.");
  }

  if (!response.ok) {
    throw new ApiError(502, "trongrid_request_failed", "TronGrid verification request failed.");
  }

  return response.json();
}

function getEthereumTransferEvents(
  logs: Array<Record<string, any>>,
  method: PaymentMethodConfig,
  receiveAddress: string
): CryptoTransferEvent[] {
  const tokenAddress = method.tokenContract.toLowerCase();
  const recipientTopic = `0x${"0".repeat(24)}${receiveAddress.toLowerCase().replace(/^0x/, "")}`;
  const transfers: CryptoTransferEvent[] = [];

  for (const [index, log] of logs.entries()) {
    const topics = Array.isArray(log.topics) ? log.topics.map((topic: unknown) => String(topic).toLowerCase()) : [];
    if (String(log.address ?? "").toLowerCase() !== tokenAddress) continue;
    if (topics[0] !== `0x${TRANSFER_TOPIC}`) continue;
    if (topics[2] !== recipientTopic) continue;
    if (log.removed === true) continue;

    transfers.push({
      units: hexToBigInt(String(log.data ?? "0x0")),
      eventIndex: eventIndexFromLog(log, index),
      tokenContract: tokenAddress,
      recipientAddress: receiveAddress.toLowerCase()
    });
  }

  return transfers.filter((event) => event.units > 0n);
}

async function getTronTransferEvents(
  logs: Array<Record<string, any>>,
  method: PaymentMethodConfig,
  receiveAddress: string
): Promise<CryptoTransferEvent[]> {
  const recipientHex = (await tronBase58ToHexAddress(receiveAddress)).slice(2).toLowerCase();
  const recipientTopic = `${"0".repeat(24)}${recipientHex}`;
  const transfers: CryptoTransferEvent[] = [];

  for (const [index, log] of logs.entries()) {
    const topics = Array.isArray(log.topics) ? log.topics.map((topic: unknown) => String(topic).toLowerCase()) : [];
    const logAddress = String(log.address ?? "").replace(/^0x/i, "").toLowerCase();

    if (logAddress !== TRON_USDT_CONTRACT_HEX) continue;
    if (topics[0]?.replace(/^0x/i, "") !== TRANSFER_TOPIC) continue;
    if (topics[2]?.replace(/^0x/i, "") !== recipientTopic) continue;

    transfers.push({
      units: hexToBigInt(String(log.data ?? "0")),
      eventIndex: eventIndexFromLog(log, index),
      tokenContract: method.tokenContract,
      recipientAddress: receiveAddress
    });
  }

  return transfers.filter((event) => event.units > 0n);
}

function eventIndexFromLog(log: Record<string, any>, fallbackIndex: number): number {
  const candidates = [log.logIndex, log.transactionLogIndex, log.event_index, log.eventIndex];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0) return candidate;
    if (typeof candidate === "string") {
      const parsed = candidate.startsWith("0x") ? Number.parseInt(candidate, 16) : Number.parseInt(candidate, 10);
      if (Number.isInteger(parsed) && parsed >= 0) return parsed;
    }
  }

  return fallbackIndex;
}

function decimalToUnits(value: string | number, decimals: number): bigint {
  const normalized = String(value).trim();
  const [wholePart, fractionPart = ""] = normalized.split(".");
  const whole = BigInt(wholePart || "0");
  const fraction = BigInt((fractionPart + "0".repeat(decimals)).slice(0, decimals) || "0");
  return whole * 10n ** BigInt(decimals) + fraction;
}

function unitsToDecimalString(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : `${whole}.00`;
}

function hexToBigInt(hex: string): bigint {
  const normalized = hex.trim().replace(/^0x/i, "") || "0";
  return BigInt(`0x${normalized}`);
}

function hexToNumber(hex: unknown): number | null {
  if (typeof hex !== "string") return null;
  return Number.parseInt(hex, 16);
}

async function tronBase58ToHexAddress(address: string): Promise<string> {
  const decoded = decodeBase58(address);
  if (decoded.length !== 25) {
    throw new ApiError(400, "invalid_tron_address", "Configured TRON address is invalid.");
  }

  const payload = decoded.slice(0, 21);
  const checksum = decoded.slice(21);
  const digest = await sha256(await sha256(payload));
  const expectedChecksum = digest.slice(0, 4);

  if (!bytesEqual(checksum, expectedChecksum) || payload[0] !== 0x41) {
    throw new ApiError(400, "invalid_tron_address", "Configured TRON address checksum is invalid.");
  }

  return bytesToHex(payload);
}

function decodeBase58(value: string): Uint8Array {
  let number = 0n;
  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new ApiError(400, "invalid_tron_address", "Configured TRON address has invalid characters.");
    }
    number = number * 58n + BigInt(index);
  }

  const bytes: number[] = [];
  while (number > 0n) {
    bytes.unshift(Number(number % 256n));
    number /= 256n;
  }

  for (const char of value) {
    if (char !== "1") break;
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
