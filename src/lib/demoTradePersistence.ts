import type { DemoTradeState } from "./demoTradeMath";
import { supabase } from "./supabase";

const DEMO_TRADE_SESSION_KEY = "aseke-demo-trade-state-v1";
const DEMO_TRADE_STORAGE_KEY = "aseke-demo-trade-state-v1";
const DEMO_TRADE_GUEST_ID_KEY = "aseke-demo-trade-guest-id";
const DEMO_TRADE_REGISTERED_PREFIX = "aseke-demo-trade-state-v1:user:";

export function getDemoTradeGuestSessionId(): string {
  if (typeof window === "undefined") return "guest-session";

  const existing = readStorageItem(DEMO_TRADE_GUEST_ID_KEY, window.localStorage)
    ?? readStorageItem(DEMO_TRADE_GUEST_ID_KEY, window.sessionStorage);
  if (existing) return existing;

  const nextId = `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  writeStorageItem(DEMO_TRADE_GUEST_ID_KEY, nextId, window.localStorage);
  writeStorageItem(DEMO_TRADE_GUEST_ID_KEY, nextId, window.sessionStorage);
  return nextId;
}

export function loadGuestDemoTradeState(): DemoTradeState | null {
  if (typeof window === "undefined") return null;

  const storedState = readStoredState(DEMO_TRADE_STORAGE_KEY, window.localStorage)
    ?? readStoredState(DEMO_TRADE_SESSION_KEY, window.sessionStorage);
  if (storedState) {
    saveGuestDemoTradeState(storedState);
  }
  return storedState;
}

export function saveGuestDemoTradeState(state: DemoTradeState): void {
  if (typeof window === "undefined") return;
  writeStoredState(DEMO_TRADE_STORAGE_KEY, state, window.localStorage);
  writeStoredState(DEMO_TRADE_SESSION_KEY, state, window.sessionStorage);
}

export async function loadRegisteredDemoTradeState(userId: string): Promise<DemoTradeState | null> {
  const localState = typeof window === "undefined"
    ? null
    : readStoredState(registeredStateKey(userId), window.localStorage);

  if (!supabase) return localState;

  const { data, error } = await supabase
    .from("demo_trade_states")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return localState;

  const remoteState = normalizeStoredDemoState((data as { state?: unknown }).state);
  const latestState = chooseLatestState(localState, remoteState);
  if (latestState && typeof window !== "undefined") {
    writeStoredState(registeredStateKey(userId), latestState, window.localStorage);
  }
  return latestState;
}

export async function saveRegisteredDemoTradeState(userId: string, state: DemoTradeState): Promise<void> {
  const payload = {
    ...state,
    userId,
    updatedAt: new Date().toISOString()
  };

  if (typeof window !== "undefined") {
    writeStoredState(registeredStateKey(userId), payload, window.localStorage);
  }

  if (!supabase) return;

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

function registeredStateKey(userId: string): string {
  return `${DEMO_TRADE_REGISTERED_PREFIX}${userId}`;
}

function readStorageItem(key: string, storage: Storage): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageItem(key: string, value: string, storage: Storage): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Browser storage can be blocked or full; remote save still gets a chance.
  }
}

function readStoredState(key: string, storage: Storage): DemoTradeState | null {
  try {
    const rawState = readStorageItem(key, storage);
    if (!rawState) return null;
    return normalizeStoredDemoState(JSON.parse(rawState));
  } catch {
    return null;
  }
}

function writeStoredState(key: string, state: DemoTradeState, storage: Storage): void {
  writeStorageItem(key, JSON.stringify(state), storage);
}

function chooseLatestState(
  firstState: DemoTradeState | null,
  secondState: DemoTradeState | null
): DemoTradeState | null {
  if (!firstState) return secondState;
  if (!secondState) return firstState;

  const firstTime = Date.parse(firstState.updatedAt);
  const secondTime = Date.parse(secondState.updatedAt);
  if (!Number.isFinite(firstTime)) return secondState;
  if (!Number.isFinite(secondTime)) return firstState;
  return secondTime > firstTime ? secondState : firstState;
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
