import type { DemoTradeState } from "./demoTradeMath";
import { supabase } from "./supabase";

const DEMO_TRADE_SESSION_KEY = "aseke-demo-trade-state-v1";
const DEMO_TRADE_GUEST_ID_KEY = "aseke-demo-trade-guest-id";

export function getDemoTradeGuestSessionId(): string {
  if (typeof window === "undefined") return "guest-session";

  const existing = window.sessionStorage.getItem(DEMO_TRADE_GUEST_ID_KEY);
  if (existing) return existing;

  const nextId = `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(DEMO_TRADE_GUEST_ID_KEY, nextId);
  return nextId;
}

export function loadGuestDemoTradeState(): DemoTradeState | null {
  if (typeof window === "undefined") return null;

  try {
    const rawState = window.sessionStorage.getItem(DEMO_TRADE_SESSION_KEY);
    if (!rawState) return null;
    return normalizeStoredDemoState(JSON.parse(rawState));
  } catch {
    return null;
  }
}

export function saveGuestDemoTradeState(state: DemoTradeState): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(DEMO_TRADE_SESSION_KEY, JSON.stringify(state));
}

export async function loadRegisteredDemoTradeState(userId: string): Promise<DemoTradeState | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("demo_trade_states")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeStoredDemoState((data as { state?: unknown }).state);
}

export async function saveRegisteredDemoTradeState(userId: string, state: DemoTradeState): Promise<void> {
  if (!supabase) return;

  const payload = {
    ...state,
    userId,
    updatedAt: new Date().toISOString()
  };

  const { error } = await supabase.rpc("save_demo_trade_state", {
    next_state: payload
  });

  if (!error) return;

  await supabase.from("demo_trade_states").upsert({
    user_id: userId,
    state: payload,
    starting_balance: payload.startingBalance,
    current_balance: payload.currentBalance,
    available_balance: payload.availableBalance,
    realized_pnl: payload.realizedPnl,
    unrealized_pnl: payload.unrealizedPnl,
    open_position: payload.openPosition,
    trade_history: payload.tradeHistory,
    settings: payload.settings,
    reset_at: payload.resetAt,
    updated_at: payload.updatedAt
  });
}

function normalizeStoredDemoState(value: unknown): DemoTradeState | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1 || value.symbol !== "BTCUSDT") return null;
  if (!Number.isFinite(Number(value.startingBalance)) || Number(value.startingBalance) < 0) return null;
  if (!Number.isFinite(Number(value.currentBalance)) || Number(value.currentBalance) < 0) return null;
  if (!Number.isFinite(Number(value.availableBalance)) || Number(value.availableBalance) < 0) return null;

  return value as unknown as DemoTradeState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
