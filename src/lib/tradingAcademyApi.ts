import type {
  AmlCheckRequest,
  TradingAcademyLeaderboardRow,
  TradingSignal
} from "../types/content";
import { normalizePublicBadges } from "./badgesApi";
import { supabase } from "./supabase";
import { sanitizePlainText } from "./validation";

export const AML_CHECK_PRICE_CENTS = 200;

interface SubmitAmlCheckResponse {
  result: {
    request_id: string;
    transaction_id: string;
    balance_cents: number;
    status: AmlCheckRequest["status"];
  };
}

export async function fetchTradingAcademyLeaderboard(): Promise<TradingAcademyLeaderboardRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("get_trading_academy_leaderboard");
  if (error) return [];

  return ((data ?? []) as Array<TradingAcademyLeaderboardRow & { badges?: unknown; badge_count?: unknown }>).map((row) => {
    const badges = normalizePublicBadges(row.badges);
    return {
      ...row,
      badges,
      badge_count: Number.isFinite(Number(row.badge_count)) ? Number(row.badge_count) : badges.length
    };
  });
}

export async function fetchTradingSignals(options: { includeInactive?: boolean } = {}): Promise<TradingSignal[]> {
  if (!supabase) return [];

  let query = supabase.from("trading_signals").select("*").order("created_at", { ascending: false });
  if (!options.includeInactive) {
    query = query.in("status", ["active", "hit_tp", "hit_sl", "manually_closed"]);
  }

  const { data, error } = await query;
  if (error) throw new Error("Trading signals could not be loaded.");

  return (data ?? []) as TradingSignal[];
}

export async function fetchUserAmlCheckRequests(userId: string): Promise<AmlCheckRequest[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("aml_check_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error("AML check history could not be loaded.");
  return (data ?? []) as AmlCheckRequest[];
}

export async function fetchAdminAmlCheckRequests(): Promise<AmlCheckRequest[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("aml_check_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error("AML check requests could not be loaded.");
  return (data ?? []) as AmlCheckRequest[];
}

export async function submitAmlCheck(input: {
  address: string;
  network: string;
  notes: string;
  idempotencyKey: string;
}): Promise<SubmitAmlCheckResponse["result"]> {
  if (!supabase) throw new Error("Supabase is not connected.");

  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Sign in before submitting an AML check.");
  }

  const { data, error } = await supabase.functions.invoke("submit-aml-check", {
    body: {
      address: sanitizePlainText(input.address, 500),
      network: sanitizePlainText(input.network, 120),
      notes: sanitizePlainText(input.notes, 1000) || null,
      idempotency_key: input.idempotencyKey
    },
    headers: {
      Authorization: `Bearer ${session.access_token}`
    }
  });

  if (error) {
    const message = await functionErrorMessage(error);
    throw new Error(message);
  }

  const possibleError = data as { error?: unknown; message?: unknown };
  if (possibleError?.error) {
    throw new Error(String(possibleError.message ?? possibleError.error));
  }

  return (data as SubmitAmlCheckResponse).result;
}

async function functionErrorMessage(error: { message?: string; context?: unknown }): Promise<string> {
  const fallback = error.message || "We could not complete this request. Please try again.";
  const context = error.context;

  if (context instanceof Response) {
    try {
      const payload = (await context.clone().json()) as {
        error?: unknown;
        message?: unknown;
      };
      return typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : fallback;
    } catch {
      return fallback;
    }
  }

  return fallback;
}
