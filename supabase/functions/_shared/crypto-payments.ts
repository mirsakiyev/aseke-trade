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

export type SupportedAsset = "USDT" | "USDC";
export type SupportedNetwork = "TRC20" | "ERC20";
export type ProductType = "premium" | "course" | "guide" | "deposit";
export type PremiumPlanId = "premium_1_month" | "premium_1_year";
export type PaymentStatus =
  | "pending"
  | "submitted"
  | "verifying"
  | "confirmed"
  | "underpaid"
  | "overpaid"
  | "expired"
  | "failed"
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
  asset: SupportedAsset;
  network: SupportedNetwork;
  receive_address: string;
  tx_hash: string | null;
  status: PaymentStatus;
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
  status: "valid" | "underpaid" | "failed" | "waiting";
  receivedAmount?: string;
  confirmations?: number;
  reason?: string;
}

interface PremiumPlanConfig {
  id: PremiumPlanId;
  productLabel: "Premium";
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
    productLabel: "Premium",
    durationMonths: 1,
    durationLabel: "1 month",
    priceCents: 1000
  },
  {
    id: "premium_1_year",
    productLabel: "Premium",
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
    throw new ApiError(400, "invalid_premium_plan", "Choose a valid Premium plan.");
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

  const [wholePart, fractionPart = ""] = value.split(".");
  const whole = wholePart.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionPart.replace(/0+$/, "");

  return {
    expectedAmount: fraction ? `${whole}.${fraction}` : `${whole}.00`,
    amountCents
  };
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
    throw new ApiError(400, "invalid_checkout_item", "Choose exactly one premium course or guide.");
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
  paymentId: string
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
  if (payment.status === "confirmed") {
    await finalizeConfirmedPayment(supabase, payment);
    return payment;
  }

  if (!payment.tx_hash) {
    throw new ApiError(400, "tx_hash_required", "Submit a transaction hash before verification.");
  }

  const duplicate = await findDuplicateTxHash(supabase, payment);
  if (duplicate) {
    return updatePaymentStatus(supabase, payment.id, "duplicate");
  }

  const method = paymentMethodConfigs.find(
    (config) => config.asset === payment.asset && config.network === payment.network
  );
  if (!method) {
    return updatePaymentStatus(supabase, payment.id, "failed");
  }

  const verification =
    payment.network === "TRC20"
      ? await verifyTronPayment(payment, method)
      : await verifyEthereumPayment(payment, method);

  if (verification.status === "waiting") {
    return updatePaymentStatus(supabase, payment.id, "verifying", {
      received_amount: verification.receivedAmount ?? null
    });
  }

  if (verification.status === "underpaid") {
    return updatePaymentStatus(supabase, payment.id, "underpaid", {
      received_amount: verification.receivedAmount ?? null
    });
  }

  if (verification.status === "failed") {
    return updatePaymentStatus(supabase, payment.id, "failed");
  }

  const confirmed = await updatePaymentStatus(supabase, payment.id, "confirmed", {
    received_amount: verification.receivedAmount ?? payment.expected_amount,
    confirmed_at: new Date().toISOString()
  });
  await finalizeConfirmedPayment(supabase, confirmed);
  return confirmed;
}

async function finalizeConfirmedPayment(supabase: SupabaseClient, payment: CryptoPaymentRow): Promise<void> {
  if (payment.payment_type === "deposit") {
    const { error } = await supabase.rpc("credit_crypto_deposit", {
      target_payment_id: payment.id
    });

    if (error) {
      throw new ApiError(500, "deposit_credit_failed", "Account balance could not be credited.");
    }

    return;
  }

  if (payment.product_type === "premium") {
    const { error } = await supabase.rpc("activate_premium_subscription_from_payment", {
      target_payment_id: payment.id
    });

    if (error) {
      throw new ApiError(500, "premium_subscription_failed", "Premium subscription could not be activated.");
    }

    return;
  }

  await grantAccessFromPayment(supabase, payment);
}

async function findDuplicateTxHash(supabase: SupabaseClient, payment: CryptoPaymentRow): Promise<boolean> {
  if (!payment.tx_hash) return false;

  const { data, error } = await supabase
    .from("crypto_payments")
    .select("id")
    .eq("tx_hash", payment.tx_hash)
    .neq("id", payment.id)
    .limit(1);

  if (error) {
    throw new ApiError(500, "duplicate_check_failed", "Transaction reuse check failed.");
  }

  return Boolean(data?.length);
}

async function updatePaymentStatus(
  supabase: SupabaseClient,
  paymentId: string,
  status: PaymentStatus,
  extras: Partial<Pick<CryptoPaymentRow, "received_amount" | "confirmed_at" | "submitted_at" | "tx_hash">> = {}
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
    throw new ApiError(500, "access_lookup_failed", "Premium access could not be checked.");
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
      throw new ApiError(500, "access_insert_failed", "Premium access could not be granted.");
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
  const receivedUnits = getEthereumReceivedUnits(receipt.logs ?? [], method, payment.receive_address);

  if (receivedUnits === null) {
    return { status: "failed", reason: "No matching ERC20 transfer to ASEKE TRADE address." };
  }

  const receivedAmount = unitsToDecimalString(receivedUnits, method.decimals);

  if (confirmations < method.minConfirmations) {
    return { status: "waiting", receivedAmount, confirmations };
  }

  const expectedUnits = decimalToUnits(payment.expected_amount, method.decimals);
  if (receivedUnits < expectedUnits) {
    return { status: "underpaid", receivedAmount, confirmations };
  }

  return { status: "valid", receivedAmount, confirmations };
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

  const receivedUnits = await getTronReceivedUnits(txInfo.log ?? [], payment.receive_address);
  if (receivedUnits === null) {
    return { status: "failed", reason: "No matching TRC20 transfer to ASEKE TRADE address." };
  }

  const nowBlock = await tronPost("wallet/getnowblock", {});
  const currentBlock = Number(nowBlock?.block_header?.raw_data?.number ?? 0);
  const transactionBlock = Number(txInfo.blockNumber ?? 0);
  const confirmations =
    currentBlock > 0 && transactionBlock > 0 ? currentBlock - transactionBlock + 1 : method.minConfirmations;
  const receivedAmount = unitsToDecimalString(receivedUnits, method.decimals);

  if (confirmations < method.minConfirmations) {
    return { status: "waiting", receivedAmount, confirmations };
  }

  const expectedUnits = decimalToUnits(payment.expected_amount, method.decimals);
  if (receivedUnits < expectedUnits) {
    return { status: "underpaid", receivedAmount, confirmations };
  }

  return { status: "valid", receivedAmount, confirmations };
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

function getEthereumReceivedUnits(
  logs: Array<Record<string, any>>,
  method: PaymentMethodConfig,
  receiveAddress: string
): bigint | null {
  const tokenAddress = method.tokenContract.toLowerCase();
  const recipientTopic = `0x${"0".repeat(24)}${receiveAddress.toLowerCase().replace(/^0x/, "")}`;
  let received = 0n;

  for (const log of logs) {
    const topics = Array.isArray(log.topics) ? log.topics.map((topic: unknown) => String(topic).toLowerCase()) : [];
    if (String(log.address ?? "").toLowerCase() !== tokenAddress) continue;
    if (topics[0] !== `0x${TRANSFER_TOPIC}`) continue;
    if (topics[2] !== recipientTopic) continue;
    if (log.removed === true) continue;

    received += hexToBigInt(String(log.data ?? "0x0"));
  }

  return received > 0n ? received : null;
}

async function getTronReceivedUnits(logs: Array<Record<string, any>>, receiveAddress: string): Promise<bigint | null> {
  const recipientHex = (await tronBase58ToHexAddress(receiveAddress)).slice(2).toLowerCase();
  const recipientTopic = `${"0".repeat(24)}${recipientHex}`;
  let received = 0n;

  for (const log of logs) {
    const topics = Array.isArray(log.topics) ? log.topics.map((topic: unknown) => String(topic).toLowerCase()) : [];
    const logAddress = String(log.address ?? "").replace(/^0x/i, "").toLowerCase();

    if (logAddress !== TRON_USDT_CONTRACT_HEX) continue;
    if (topics[0]?.replace(/^0x/i, "") !== TRANSFER_TOPIC) continue;
    if (topics[2]?.replace(/^0x/i, "") !== recipientTopic) continue;

    received += hexToBigInt(String(log.data ?? "0"));
  }

  return received > 0n ? received : null;
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
