import { sampleCourses, sampleGuides } from "../data/sampleContent";
import type {
  AccountBalance,
  AccountBalanceTransaction,
  Course,
  CryptoAsset,
  CryptoNetwork,
  CryptoPayment,
  CryptoPaymentStatus,
  Guide
} from "../types/content";
import { getPremiumPlan, PREMIUM_PRODUCT_LABEL, type PremiumPlanId } from "./premiumPlans";
import { supabase } from "./supabase";

export interface PaymentMethodChoice {
  asset: CryptoAsset;
  network: CryptoNetwork;
  label: string;
  warning: string;
}

export interface CheckoutItem {
  id: string;
  itemType: "course" | "guide" | "premium";
  title: string;
  description: string;
  price_cents: number;
  is_premium: boolean;
  course_id?: string | null;
  product_label?: string;
  plan_id?: PremiumPlanId;
  plan_duration_months?: number;
  duration_label?: string;
}

interface CreatePaymentResponse {
  payment: CryptoPayment;
  item: {
    title: string;
    amount_cents: number;
    product_type?: string;
    product_label?: string;
    plan_id?: PremiumPlanId | null;
    plan_duration_months?: number | null;
  };
  method: {
    asset: CryptoAsset;
    network: CryptoNetwork;
    receive_address: string;
    min_confirmations: number;
  };
}

interface SubmitPaymentResponse {
  payment: CryptoPayment;
}

interface SpendAccountBalanceResponse {
  result: {
    transaction_id: string;
    balance_cents: number;
    purchase_id: string | null;
    subscription_id?: string | null;
    premium_expires_at?: string | null;
  };
}

type MaybeArray<T> = T | T[] | null | undefined;

export const cryptoPaymentMethods: PaymentMethodChoice[] = [
  {
    asset: "USDT",
    network: "TRC20",
    label: "USDT TRC20",
    warning: "Send only USDT on TRON TRC20."
  },
  {
    asset: "USDT",
    network: "ERC20",
    label: "USDT ERC20",
    warning: "Send only USDT on Ethereum ERC20."
  },
  {
    asset: "USDC",
    network: "ERC20",
    label: "USDC ERC20",
    warning: "Send only USDC on Ethereum ERC20."
  }
];

export const cryptoStatusMessages: Record<CryptoPaymentStatus, string> = {
  pending: "Waiting for payment",
  submitted: "Transaction submitted",
  verifying: "Verifying on-chain",
  confirmed: "Payment confirmed.",
  underpaid: "Payment received but amount is lower than required.",
  overpaid: "Payment received above the expected amount.",
  expired: "Payment window expired. Create a new payment.",
  failed: "Transaction failed or could not be verified.",
  duplicate: "This transaction was already used."
};

export function formatStableAmount(amount: string | number, asset: CryptoAsset): string {
  const numericAmount = Number(amount);
  const formatted = Number.isFinite(numericAmount)
    ? numericAmount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6
      })
    : String(amount);

  return `${formatted} ${asset}`;
}

export function statusTone(status: CryptoPaymentStatus): "premium" | "free" | "danger" {
  if (status === "confirmed") return "free";
  if (["failed", "expired", "underpaid", "duplicate"].includes(status)) return "danger";
  return "premium";
}

export function paymentQrUrl(payment: CryptoPayment): string {
  const qrValue = `${payment.receive_address}?amount=${payment.expected_amount}&asset=${payment.asset}&network=${payment.network}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=12&data=${encodeURIComponent(qrValue)}`;
}

export async function fetchCheckoutItem(itemType: string | undefined, itemId: string | undefined): Promise<CheckoutItem | null> {
  if (!itemId || (itemType !== "course" && itemType !== "guide" && itemType !== "premium")) return null;

  if (itemType === "premium") {
    const plan = getPremiumPlan(itemId);
    if (!plan) return null;

    return {
      id: plan.id,
      itemType,
      title: PREMIUM_PRODUCT_LABEL,
      description: `${plan.durationLabel} ASEKE TRADE Premium subscription.`,
      price_cents: plan.priceCents,
      is_premium: true,
      product_label: PREMIUM_PRODUCT_LABEL,
      plan_id: plan.id,
      plan_duration_months: plan.durationMonths,
      duration_label: plan.durationLabel
    };
  }

  if (!supabase) {
    return sampleCheckoutItem(itemType, itemId);
  }

  if (itemType === "course") {
    const { data, error } = await supabase
      .from("courses")
      .select("id,title,description,price_cents,is_premium,is_archived")
      .eq("id", itemId)
      .maybeSingle();

    if (error || !data || data.is_archived) return sampleCheckoutItem(itemType, itemId);

    return {
      id: data.id,
      itemType,
      title: data.title,
      description: data.description,
      price_cents: data.price_cents,
      is_premium: data.is_premium
    };
  }

  const { data, error } = await supabase
    .from("guides")
    .select("id,course_id,title,description,price_cents,is_premium,is_archived,course:courses(id,title,price_cents,is_premium,is_archived)")
    .eq("id", itemId)
    .maybeSingle();

  if (error || !data || data.is_archived) return sampleCheckoutItem(itemType, itemId);

  const course = firstRelation(data.course as MaybeArray<Pick<Course, "id" | "title" | "price_cents" | "is_premium" | "is_archived">>);
  const priceCents = data.price_cents > 0 ? data.price_cents : course?.price_cents ?? 0;

  return {
    id: data.id,
    itemType,
    title: data.title,
    description: data.description,
    price_cents: priceCents,
    is_premium: data.is_premium || Boolean(course?.is_premium),
    course_id: data.course_id
  };
}

export async function createCryptoPayment(input: {
  itemType: "course" | "guide" | "premium";
  itemId?: string;
  planId?: PremiumPlanId;
  asset: CryptoAsset;
  network: CryptoNetwork;
}): Promise<CreatePaymentResponse> {
  const body =
    input.itemType === "premium"
      ? {
          payment_type: "purchase",
          product_type: "premium",
          product_label: PREMIUM_PRODUCT_LABEL,
          plan_id: input.planId,
          asset: input.asset,
          network: input.network
        }
      : input.itemType === "course"
        ? { course_id: input.itemId, asset: input.asset, network: input.network }
        : { guide_id: input.itemId, asset: input.asset, network: input.network };

  return invokeCryptoFunction<CreatePaymentResponse>("create-crypto-payment", body);
}

export async function createCryptoDeposit(input: {
  amount: string;
  asset: CryptoAsset;
  network: CryptoNetwork;
}): Promise<CreatePaymentResponse> {
  return invokeCryptoFunction<CreatePaymentResponse>("create-crypto-payment", {
    payment_type: "deposit",
    amount: input.amount,
    asset: input.asset,
    network: input.network
  });
}

export async function spendAccountBalance(input: {
  itemType: "course" | "guide" | "premium";
  itemId?: string;
  planId?: PremiumPlanId;
}): Promise<SpendAccountBalanceResponse["result"]> {
  const body =
    input.itemType === "premium"
      ? {
          item_type: "premium",
          product_type: "premium",
          product_label: PREMIUM_PRODUCT_LABEL,
          plan_id: input.planId
        }
      : {
          item_type: input.itemType,
          item_id: input.itemId
        };

  const response = await invokeCryptoFunction<SpendAccountBalanceResponse>("spend-account-balance", body);
  return response.result;
}

export async function submitCryptoTx(paymentId: string, txHash: string): Promise<CryptoPayment> {
  const response = await invokeCryptoFunction<SubmitPaymentResponse>("submit-crypto-tx", {
    payment_id: paymentId,
    tx_hash: txHash
  });
  return response.payment;
}

export async function fetchCryptoPayment(paymentId: string): Promise<CryptoPayment | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.from("crypto_payments").select("*").eq("id", paymentId).maybeSingle();
  if (error) return null;
  return data as CryptoPayment | null;
}

export async function fetchUserCryptoPayments(userId: string): Promise<CryptoPayment[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("crypto_payments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return (data ?? []) as CryptoPayment[];
}

export async function fetchAccountBalance(userId: string): Promise<AccountBalance | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.from("account_balances").select("*").eq("user_id", userId).maybeSingle();
  if (error) return null;
  return data as AccountBalance | null;
}

export async function fetchAccountBalanceTransactions(userId: string): Promise<AccountBalanceTransaction[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("account_balance_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return (data ?? []) as AccountBalanceTransaction[];
}

async function invokeCryptoFunction<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) {
    throw new Error("Supabase is not connected.");
  }

  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Sign in before using crypto checkout.");
  }

  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
    headers: {
      Authorization: `Bearer ${session.access_token}`
    }
  });

  if (error) {
    const message = await functionErrorMessage(error);
    throw new Error(message);
  }

  const possibleError = data as { error?: unknown };
  if (possibleError?.error) {
    throw new Error(String(possibleError.error));
  }

  return data as T;
}

async function functionErrorMessage(error: { message?: string; context?: unknown }): Promise<string> {
  const fallback = error.message || "Edge Function request failed.";
  const context = error.context;

  if (context instanceof Response) {
    try {
      const payload = (await context.clone().json()) as { error?: unknown; message?: unknown; code?: unknown };
      const message = typeof payload.error === "string" ? payload.error : typeof payload.message === "string" ? payload.message : "";
      const code = typeof payload.code === "string" ? payload.code : "";
      return message ? `${message}${code ? ` (${code})` : ""}` : fallback;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function sampleCheckoutItem(itemType: "course" | "guide", itemId: string): CheckoutItem | null {
  if (itemType === "course") {
    const course = sampleCourses.find((item) => item.id === itemId);
    return course
      ? {
          id: course.id,
          itemType,
          title: course.title,
          description: course.description,
          price_cents: course.price_cents,
          is_premium: course.is_premium
        }
      : null;
  }

  const guide = sampleGuides.find((item) => item.id === itemId);
  if (!guide) return null;

  const course = sampleCourses.find((item) => item.id === guide.course_id);
  return {
    id: guide.id,
    itemType,
    title: guide.title,
    description: guide.description,
    price_cents: guide.price_cents > 0 ? guide.price_cents : course?.price_cents ?? 0,
    is_premium: guide.is_premium || Boolean(course?.is_premium),
    course_id: guide.course_id
  };
}

function firstRelation<T>(relation: MaybeArray<T>): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}
