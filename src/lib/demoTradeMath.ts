export type DemoTradeSide = "long" | "short";
export type DemoTradeSizeMode = "margin" | "notional";
export type DemoTradeStatus =
  | "OPEN"
  | "PARTIALLY_CLOSED"
  | "CLOSED"
  | "STOP_LOSS_HIT"
  | "TAKE_PROFIT_HIT"
  | "LIQUIDATED"
  | "MANUALLY_CLOSED";
export type DemoTradeActionType =
  | "opened"
  | "SL updated"
  | "TP added"
  | "TP edited"
  | "TP removed"
  | "leverage updated"
  | "position increased"
  | "partial close"
  | "manual close"
  | "SL hit"
  | "TP hit"
  | "liquidated"
  | "reset"
  | "exported";

export interface DemoTakeProfit {
  id: string;
  price: number;
  closePercent: number;
  isHit: boolean;
  hitAt: string | null;
}

export interface DemoTradeAction {
  id: string;
  type: DemoTradeActionType;
  message: string;
  timestamp: string;
  price: number | null;
  realizedPnl: number | null;
}

export interface DemoOpenPosition {
  tradeId: string;
  userId: string | null;
  sessionId: string;
  symbol: string;
  side: DemoTradeSide;
  status: DemoTradeStatus;
  entryPrice: number;
  exitPrice: number | null;
  markPrice: number;
  initialMargin: number;
  remainingMargin: number;
  leverage: number;
  initialQuantity: number;
  remainingQuantity: number;
  stopLoss: number;
  takeProfits: DemoTakeProfit[];
  realizedPnl: number;
  unrealizedPnl: number;
  returnPercent: number;
  liquidationPrice: number | null;
  openedAt: string;
  updatedAt: string;
  closedAt: string | null;
  actionLog: DemoTradeAction[];
}

export interface DemoClosedTrade extends DemoOpenPosition {
  exitPrice: number;
  closedAt: string;
}

export interface DemoTradeSettings {
  feeRate: number;
  maintenanceMarginRate: number;
}

export interface DemoTradeState {
  version: 1;
  sessionId: string;
  userId: string | null;
  symbol: "BTCUSDT";
  startingBalance: number;
  currentBalance: number;
  availableBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  openPosition: DemoOpenPosition | null;
  tradeHistory: DemoClosedTrade[];
  actionHistory: DemoTradeAction[];
  settings: DemoTradeSettings;
  resetAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpenDemoTradeInput {
  userId?: string | null;
  sessionId: string;
  symbol?: string;
  side: DemoTradeSide;
  sizeMode: DemoTradeSizeMode;
  amount: number;
  leverage: number;
  entryPrice: number;
  stopLoss: number;
  takeProfits: Array<Pick<DemoTakeProfit, "price" | "closePercent"> & { id?: string }>;
}

export interface IncreaseDemoPositionInput {
  sizeMode: DemoTradeSizeMode;
  amount: number;
  entryPrice: number;
}

export interface DemoTradeStats {
  startingBalance: number;
  currentBalance: number;
  availableBalance: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalReturnPercent: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  largestWin: number;
  largestLoss: number;
  liquidations: number;
}

export type DemoTradeResult =
  | { ok: true; state: DemoTradeState }
  | { ok: false; errors: string[]; state: DemoTradeState };

type DecimalInput = string | number | bigint;
type DecimalValue = bigint;

const DECIMAL_SCALE = 100000000n;
const DEFAULT_MAINTENANCE_MARGIN_RATE = 0.005;
const DEFAULT_FEE_RATE = 0;
const EPSILON = 0.00000001;

export function createInitialDemoTradeState(input: {
  startingBalance?: number;
  sessionId?: string;
  userId?: string | null;
  now?: string;
} = {}): DemoTradeState {
  const now = input.now ?? new Date().toISOString();
  const startingBalance = roundMoney(Math.max(input.startingBalance ?? 1000, 0));

  return {
    version: 1,
    sessionId: input.sessionId ?? createId("guest"),
    userId: input.userId ?? null,
    symbol: "BTCUSDT",
    startingBalance,
    currentBalance: startingBalance,
    availableBalance: startingBalance,
    realizedPnl: 0,
    unrealizedPnl: 0,
    openPosition: null,
    tradeHistory: [],
    actionHistory: [],
    settings: {
      feeRate: DEFAULT_FEE_RATE,
      maintenanceMarginRate: DEFAULT_MAINTENANCE_MARGIN_RATE
    },
    resetAt: null,
    createdAt: now,
    updatedAt: now
  };
}

export function validateDemoTradeInput(state: DemoTradeState, input: OpenDemoTradeInput): string[] {
  const errors: string[] = [];
  const symbol = normalizeSymbol(input.symbol ?? state.symbol);
  const amount = toDecimal(input.amount);
  const entryPrice = toDecimal(input.entryPrice);
  const stopLoss = toDecimal(input.stopLoss);
  const leverage = Math.trunc(Number(input.leverage));

  if (symbol !== "BTCUSDT") errors.push("BTC/USDT is the only supported demo pair for v1.");
  if (state.openPosition) errors.push("Close the current demo position before opening another one.");
  if (input.side !== "long" && input.side !== "short") errors.push("Choose Long or Short.");
  if (!isPositiveDecimal(amount)) errors.push("Trade size must be greater than zero.");
  if (!isPositiveDecimal(entryPrice)) errors.push("Entry price must be greater than zero.");
  if (input.sizeMode !== "margin" && input.sizeMode !== "notional") {
    errors.push("Choose whether the amount is margin or position size.");
  }
  if (!Number.isInteger(leverage) || leverage < 1) errors.push("Leverage must be at least 1x.");
  if (!Number.isInteger(leverage) || leverage > 100) errors.push("Leverage cannot be above 100x.");

  if (isPositiveDecimal(entryPrice) && isPositiveDecimal(stopLoss)) {
    errors.push(...validateStopLoss(input.side, toNumber(entryPrice), toNumber(stopLoss)));
  }

  if (!errors.length) {
    const requiredMargin = calculateInputMargin(input);
    if (gt(requiredMargin, toDecimal(state.availableBalance))) {
      errors.push("Trade is larger than your available demo balance allows.");
    }
  }

  errors.push(...validateTakeProfits(input.side, toNumber(entryPrice), normalizeTakeProfits(input.takeProfits)));
  return uniqueErrors(errors);
}

export function openDemoPosition(
  state: DemoTradeState,
  input: OpenDemoTradeInput,
  now = new Date().toISOString()
): DemoTradeResult {
  const normalizedInput = {
    ...input,
    symbol: normalizeSymbol(input.symbol ?? state.symbol),
    leverage: Math.trunc(Number(input.leverage)),
    takeProfits: normalizeTakeProfits(input.takeProfits)
  };
  const errors = validateDemoTradeInput(state, normalizedInput);
  if (errors.length) return { ok: false, errors, state };

  const nextState = cloneState(state);
  const requiredMargin = calculateInputMargin(normalizedInput);
  const notional = normalizedInput.sizeMode === "margin"
    ? mul(requiredMargin, toDecimal(normalizedInput.leverage))
    : toDecimal(normalizedInput.amount);
  const entryPrice = toDecimal(normalizedInput.entryPrice);
  const quantity = div(notional, entryPrice);
  const tradeId = createId("demo-trade");
  const action = createAction("opened", "Demo trade opened.", now, normalizedInput.entryPrice, null);
  const liquidationPrice = calculateLiquidationPrice({
    side: normalizedInput.side,
    avgEntryPrice: normalizedInput.entryPrice,
    quantityRemaining: toNumber(quantity),
    isolatedMarginRemaining: toNumber(requiredMargin),
    maintenanceMarginRate: nextState.settings.maintenanceMarginRate
  });

  nextState.availableBalance = roundMoney(toNumber(sub(toDecimal(nextState.availableBalance), requiredMargin)));
  nextState.openPosition = {
    tradeId,
    userId: normalizedInput.userId ?? nextState.userId,
    sessionId: normalizedInput.sessionId,
    symbol: "BTCUSDT",
    side: normalizedInput.side,
    status: "OPEN",
    entryPrice: roundPrice(normalizedInput.entryPrice),
    exitPrice: null,
    markPrice: roundPrice(normalizedInput.entryPrice),
    initialMargin: roundMoney(toNumber(requiredMargin)),
    remainingMargin: roundMoney(toNumber(requiredMargin)),
    leverage: normalizedInput.leverage,
    initialQuantity: roundQuantity(toNumber(quantity)),
    remainingQuantity: roundQuantity(toNumber(quantity)),
    stopLoss: isPositiveDecimal(toDecimal(normalizedInput.stopLoss)) ? roundPrice(normalizedInput.stopLoss) : 0,
    takeProfits: normalizedInput.takeProfits.map((takeProfit, index) => ({
      id: takeProfit.id ?? `tp-${index + 1}`,
      price: roundPrice(takeProfit.price),
      closePercent: roundPercent(takeProfit.closePercent),
      isHit: false,
      hitAt: null
    })),
    realizedPnl: 0,
    unrealizedPnl: 0,
    returnPercent: 0,
    liquidationPrice,
    openedAt: now,
    updatedAt: now,
    closedAt: null,
    actionLog: [action]
  };

  nextState.actionHistory.push(action);
  return { ok: true, state: refreshBalances(nextState, now) };
}

export function applyMarketPrice(
  state: DemoTradeState,
  markPrice: number,
  now = new Date().toISOString()
): DemoTradeState {
  if (!state.openPosition || !Number.isFinite(markPrice) || markPrice <= 0) {
    return state;
  }

  let nextState = markPosition(cloneState(state), markPrice, now);
  const position = nextState.openPosition;
  if (!position) return nextState;

  if (isLiquidationHit(position, markPrice)) {
    return liquidateOpenPosition(nextState, markPrice, now);
  }

  if (isStopLossHit(position, markPrice)) {
    return closeOpenPosition(nextState, markPrice, "STOP_LOSS_HIT", "SL hit", "Stop loss closed the remaining position.", now);
  }

  const sortedTakeProfits = [...position.takeProfits].sort((first, second) =>
    position.side === "long" ? first.price - second.price : second.price - first.price
  );

  for (const takeProfit of sortedTakeProfits) {
    const current = nextState.openPosition;
    if (!current || takeProfit.isHit) continue;
    const liveTakeProfit = current.takeProfits.find((item) => item.id === takeProfit.id);
    if (!liveTakeProfit || liveTakeProfit.isHit || !isTakeProfitHit(current.side, markPrice, liveTakeProfit.price)) {
      continue;
    }

    nextState = closePositionByPercent(
      nextState,
      markPrice,
      liveTakeProfit.closePercent,
      "TAKE_PROFIT_HIT",
      "TP hit",
      `Take profit ${liveTakeProfit.price.toLocaleString("en-US")} hit.`,
      now,
      liveTakeProfit.id
    );
  }

  return nextState;
}

export function updateDemoStopLoss(
  state: DemoTradeState,
  stopLoss: number,
  now = new Date().toISOString()
): DemoTradeResult {
  if (!state.openPosition) return { ok: false, errors: ["No open position to update."], state };

  const errors = validateStopLoss(state.openPosition.side, state.openPosition.entryPrice, stopLoss);
  if (errors.length) return { ok: false, errors, state };

  const nextState = cloneState(state);
  if (!nextState.openPosition) return { ok: false, errors: ["No open position to update."], state };
  const action = createAction("SL updated", "Stop loss updated.", now, stopLoss, null);
  nextState.openPosition.stopLoss = roundPrice(stopLoss);
  nextState.openPosition.updatedAt = now;
  nextState.openPosition.actionLog.push(action);
  nextState.actionHistory.push(action);
  return { ok: true, state: refreshBalances(nextState, now) };
}

export function updateDemoTakeProfits(
  state: DemoTradeState,
  takeProfits: DemoTakeProfit[],
  now = new Date().toISOString()
): DemoTradeResult {
  if (!state.openPosition) return { ok: false, errors: ["No open position to update."], state };

  const normalized = normalizeTakeProfits(takeProfits);
  const errors = validateTakeProfits(state.openPosition.side, state.openPosition.entryPrice, normalized);
  if (errors.length) return { ok: false, errors, state };

  const beforeIds = new Set(state.openPosition.takeProfits.map((takeProfit) => takeProfit.id));
  const afterIds = new Set(normalized.map((takeProfit) => takeProfit.id));
  const actionType: DemoTradeActionType = normalized.some((takeProfit) => !beforeIds.has(takeProfit.id))
    ? "TP added"
    : state.openPosition.takeProfits.some((takeProfit) => !afterIds.has(takeProfit.id))
      ? "TP removed"
      : "TP edited";
  const nextState = cloneState(state);
  if (!nextState.openPosition) return { ok: false, errors: ["No open position to update."], state };
  const action = createAction(actionType, "Take profit plan updated.", now, null, null);
  const previous = new Map(nextState.openPosition.takeProfits.map((takeProfit) => [takeProfit.id, takeProfit]));

  nextState.openPosition.takeProfits = normalized.map((takeProfit, index) => ({
    id: takeProfit.id || `tp-${index + 1}`,
    price: roundPrice(takeProfit.price),
    closePercent: roundPercent(takeProfit.closePercent),
    isHit: previous.get(takeProfit.id)?.isHit ?? false,
    hitAt: previous.get(takeProfit.id)?.hitAt ?? null
  }));
  nextState.openPosition.updatedAt = now;
  nextState.openPosition.actionLog.push(action);
  nextState.actionHistory.push(action);
  return { ok: true, state: refreshBalances(nextState, now) };
}

export function updateDemoLeverage(
  state: DemoTradeState,
  leverage: number,
  now = new Date().toISOString()
): DemoTradeResult {
  if (!state.openPosition) return { ok: false, errors: ["No open position to update."], state };

  const nextLeverage = Math.trunc(Number(leverage));
  if (!Number.isInteger(nextLeverage) || nextLeverage < 1) {
    return { ok: false, errors: ["Leverage must be at least 1x."], state };
  }
  if (nextLeverage > 100) {
    return { ok: false, errors: ["Leverage cannot be above 100x."], state };
  }

  const nextState = cloneState(state);
  const position = nextState.openPosition;
  if (!position) return { ok: false, errors: ["No open position to update."], state };

  const remainingNotional = mul(toDecimal(position.entryPrice), toDecimal(position.remainingQuantity));
  const nextMargin = div(remainingNotional, toDecimal(nextLeverage));
  const currentMargin = toDecimal(position.remainingMargin);
  const marginDelta = sub(nextMargin, currentMargin);

  if (gt(marginDelta, toDecimal(nextState.availableBalance))) {
    return {
      ok: false,
      errors: ["Reducing leverage requires more margin than your available demo balance."],
      state
    };
  }

  const action = createAction("leverage updated", `Leverage updated to ${nextLeverage}x.`, now, null, null);
  nextState.availableBalance = roundMoney(toNumber(sub(toDecimal(nextState.availableBalance), marginDelta)));
  position.leverage = nextLeverage;
  position.remainingMargin = roundMoney(toNumber(nextMargin));
  position.liquidationPrice = calculateLiquidationPrice({
    side: position.side,
    avgEntryPrice: position.entryPrice,
    quantityRemaining: position.remainingQuantity,
    isolatedMarginRemaining: position.remainingMargin,
    maintenanceMarginRate: nextState.settings.maintenanceMarginRate
  });
  position.updatedAt = now;
  position.actionLog.push(action);
  nextState.actionHistory.push(action);
  return { ok: true, state: refreshBalances(nextState, now) };
}

export function increaseDemoPosition(
  state: DemoTradeState,
  input: IncreaseDemoPositionInput,
  now = new Date().toISOString()
): DemoTradeResult {
  if (!state.openPosition) return { ok: false, errors: ["No open position to add to."], state };

  const amount = toDecimal(input.amount);
  const entryPrice = toDecimal(input.entryPrice);
  const errors: string[] = [];

  if (!isPositiveDecimal(amount)) errors.push("Add size must be greater than zero.");
  if (!isPositiveDecimal(entryPrice)) errors.push("Market price is unavailable.");
  if (input.sizeMode !== "margin" && input.sizeMode !== "notional") {
    errors.push("Choose whether the add amount is margin or position size.");
  }

  const position = state.openPosition;
  const requiredMargin = calculateInputMargin({
    sizeMode: input.sizeMode,
    amount: input.amount,
    leverage: position.leverage
  });

  if (!errors.length && gt(requiredMargin, toDecimal(state.availableBalance))) {
    errors.push("Add size is larger than your available demo balance allows.");
  }

  if (errors.length) return { ok: false, errors: uniqueErrors(errors), state };

  const nextState = cloneState(state);
  const nextPosition = nextState.openPosition;
  if (!nextPosition) return { ok: false, errors: ["No open position to add to."], state };

  const addedNotional = input.sizeMode === "margin"
    ? mul(requiredMargin, toDecimal(nextPosition.leverage))
    : toDecimal(input.amount);
  const addedQuantity = div(addedNotional, entryPrice);
  const previousQuantity = toDecimal(nextPosition.remainingQuantity);
  const nextQuantity = add(previousQuantity, addedQuantity);
  const previousNotional = mul(toDecimal(nextPosition.entryPrice), previousQuantity);
  const nextEntryPrice = div(add(previousNotional, addedNotional), nextQuantity);
  const action = createAction(
    "position increased",
    `Added ${roundMoney(toNumber(addedNotional)).toLocaleString("en-US")} USDT notional to the position.`,
    now,
    input.entryPrice,
    null
  );

  nextState.availableBalance = roundMoney(toNumber(sub(toDecimal(nextState.availableBalance), requiredMargin)));
  nextPosition.status = "OPEN";
  nextPosition.entryPrice = roundPrice(toNumber(nextEntryPrice));
  nextPosition.markPrice = roundPrice(input.entryPrice);
  nextPosition.initialMargin = roundMoney(toNumber(add(toDecimal(nextPosition.initialMargin), requiredMargin)));
  nextPosition.remainingMargin = roundMoney(toNumber(add(toDecimal(nextPosition.remainingMargin), requiredMargin)));
  nextPosition.initialQuantity = roundQuantity(toNumber(add(toDecimal(nextPosition.initialQuantity), addedQuantity)));
  nextPosition.remainingQuantity = roundQuantity(toNumber(nextQuantity));
  nextPosition.unrealizedPnl = calculateUnrealizedPnl({
    side: nextPosition.side,
    avgEntryPrice: nextPosition.entryPrice,
    markPrice: input.entryPrice,
    quantityRemaining: nextPosition.remainingQuantity
  });
  nextPosition.returnPercent = nextPosition.initialMargin > 0
    ? roundPercent(((nextPosition.realizedPnl + nextPosition.unrealizedPnl) / nextPosition.initialMargin) * 100)
    : 0;
  nextPosition.liquidationPrice = calculateLiquidationPrice({
    side: nextPosition.side,
    avgEntryPrice: nextPosition.entryPrice,
    quantityRemaining: nextPosition.remainingQuantity,
    isolatedMarginRemaining: nextPosition.remainingMargin,
    maintenanceMarginRate: nextState.settings.maintenanceMarginRate
  });
  nextPosition.updatedAt = now;
  nextPosition.actionLog.push(action);
  nextState.actionHistory.push(action);

  return { ok: true, state: refreshBalances(nextState, now) };
}

export function closeOpenPosition(
  state: DemoTradeState,
  exitPrice: number,
  status: DemoTradeStatus = "MANUALLY_CLOSED",
  actionType: DemoTradeActionType = "manual close",
  message = "Position closed manually.",
  now = new Date().toISOString()
): DemoTradeState {
  if (!state.openPosition) return state;

  return closePositionQuantity(
    state,
    exitPrice,
    state.openPosition.remainingQuantity,
    status,
    actionType,
    message,
    now
  );
}

export function closeOpenPositionByPercent(
  state: DemoTradeState,
  exitPrice: number,
  closePercent = 100,
  now = new Date().toISOString()
): DemoTradeResult {
  if (!state.openPosition) return { ok: false, errors: ["No open position to close."], state };
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    return { ok: false, errors: ["Market price is unavailable."], state };
  }
  if (!Number.isFinite(closePercent) || closePercent <= 0) {
    return { ok: false, errors: ["Close size must be greater than 0%."], state };
  }
  if (closePercent > 100 + EPSILON) {
    return { ok: false, errors: ["Close size cannot be above 100%."], state };
  }

  const percentToClose = Math.min(closePercent, 100);
  const closeQuantity = percentToClose >= 100
    ? state.openPosition.remainingQuantity
    : toNumber(mul(toDecimal(state.openPosition.remainingQuantity), div(toDecimal(percentToClose), toDecimal(100))));
  const actionType: DemoTradeActionType = percentToClose >= 100 ? "manual close" : "partial close";
  const message = percentToClose >= 100
    ? "Position closed manually."
    : `Closed ${roundPercent(percentToClose)}% of the remaining position manually.`;

  return {
    ok: true,
    state: closePositionQuantity(
      state,
      exitPrice,
      closeQuantity,
      "MANUALLY_CLOSED",
      actionType,
      message,
      now
    )
  };
}

export function resetDemoTradeState(
  state: DemoTradeState,
  startingBalance: number,
  now = new Date().toISOString()
): DemoTradeState {
  const resetState = createInitialDemoTradeState({
    startingBalance,
    sessionId: state.sessionId,
    userId: state.userId,
    now
  });
  const action = createAction("reset", "Demo balance reset and progress cleared.", now, null, null);
  resetState.resetAt = now;
  resetState.actionHistory = [action];
  return resetState;
}

export function calculateUnrealizedPnl(input: {
  side: DemoTradeSide;
  avgEntryPrice: number;
  markPrice: number;
  quantityRemaining: number;
}): number {
  const entry = toDecimal(input.avgEntryPrice);
  const mark = toDecimal(input.markPrice);
  const quantity = toDecimal(input.quantityRemaining);
  const priceDelta = input.side === "long" ? sub(mark, entry) : sub(entry, mark);
  return roundMoney(toNumber(mul(priceDelta, quantity)));
}

export function calculateLiquidationPrice(input: {
  side: DemoTradeSide;
  avgEntryPrice: number;
  quantityRemaining: number;
  isolatedMarginRemaining: number;
  maintenanceMarginRate?: number;
}): number | null {
  const quantity = toDecimal(input.quantityRemaining);
  const margin = toDecimal(input.isolatedMarginRemaining);
  const entry = toDecimal(input.avgEntryPrice);
  const maintenanceMarginRate = toDecimal(input.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE);

  if (!isPositiveDecimal(quantity) || !isPositiveDecimal(entry) || lt(margin, 0n)) return null;

  const entryValue = mul(entry, quantity);
  const maintenanceAdjustment = input.side === "long"
    ? sub(toDecimal(1), maintenanceMarginRate)
    : add(toDecimal(1), maintenanceMarginRate);
  const denominator = mul(quantity, maintenanceAdjustment);
  if (!isPositiveDecimal(denominator)) return null;

  // ASEKE TRADE demo isolated-margin model.
  // Real exchanges may include maintenance tiers, liquidation fees, funding,
  // insurance fund rules, and exchange-specific mark-price protections.
  const numerator = input.side === "long" ? sub(entryValue, margin) : add(entryValue, margin);
  const price = div(numerator, denominator);
  return Math.max(0, roundPrice(toNumber(price)));
}

export function validateStopLoss(side: DemoTradeSide, entryPrice: number, stopLoss: number): string[] {
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) return ["Stop loss must be greater than zero."];
  if (side === "long" && stopLoss >= entryPrice) return ["For a long trade, stop loss must be below entry."];
  if (side === "short" && stopLoss <= entryPrice) return ["For a short trade, stop loss must be above entry."];
  return [];
}

export function validateTakeProfits(
  side: DemoTradeSide,
  entryPrice: number,
  takeProfits: Array<Pick<DemoTakeProfit, "price" | "closePercent">>
): string[] {
  const errors: string[] = [];
  let totalPercent = 0;

  takeProfits.forEach((takeProfit, index) => {
    const label = `TP${index + 1}`;
    if (!Number.isFinite(takeProfit.price) || takeProfit.price <= 0) {
      errors.push(`${label} price must be greater than zero.`);
    } else if (side === "long" && takeProfit.price <= entryPrice) {
      errors.push(`${label} must be above entry for a long trade.`);
    } else if (side === "short" && takeProfit.price >= entryPrice) {
      errors.push(`${label} must be below entry for a short trade.`);
    }

    if (!Number.isFinite(takeProfit.closePercent) || takeProfit.closePercent <= 0) {
      errors.push(`${label} close size must be greater than 0%.`);
    }
    totalPercent += Number.isFinite(takeProfit.closePercent) ? takeProfit.closePercent : 0;
  });

  if (totalPercent > 100 + EPSILON) {
    errors.push("Take-profit close sizes cannot total more than 100%.");
  }

  return uniqueErrors(errors);
}

export function calculateDemoTradeStats(state: DemoTradeState): DemoTradeStats {
  const equity = calculateEquity(state);
  const wins = state.tradeHistory.filter((trade) => trade.realizedPnl > 0).length;
  const losses = state.tradeHistory.filter((trade) => trade.realizedPnl < 0).length;
  const largestWin = state.tradeHistory.reduce((max, trade) => Math.max(max, trade.realizedPnl), 0);
  const largestLoss = state.tradeHistory.reduce((min, trade) => Math.min(min, trade.realizedPnl), 0);
  const trades = state.tradeHistory.length + (state.openPosition ? 1 : 0);

  return {
    startingBalance: state.startingBalance,
    currentBalance: state.currentBalance,
    availableBalance: state.availableBalance,
    equity,
    realizedPnl: state.realizedPnl,
    unrealizedPnl: state.unrealizedPnl,
    totalReturnPercent: state.startingBalance > 0 ? roundPercent(((equity - state.startingBalance) / state.startingBalance) * 100) : 0,
    trades,
    wins,
    losses,
    winRate: state.tradeHistory.length ? roundPercent((wins / state.tradeHistory.length) * 100) : 0,
    largestWin: roundMoney(largestWin),
    largestLoss: roundMoney(largestLoss),
    liquidations: state.tradeHistory.filter((trade) => trade.status === "LIQUIDATED").length
  };
}

export function exportDemoTradesToCsv(state: DemoTradeState): string {
  const headers = [
    "Trade ID",
    "User ID",
    "Session ID",
    "Symbol",
    "Side",
    "Entry Price",
    "Exit Price",
    "Current Mark Price",
    "Initial Margin",
    "Remaining Margin",
    "Leverage",
    "Initial Quantity",
    "Remaining Quantity",
    "SL Level",
    "TP Levels",
    "Realized PnL",
    "Unrealized PnL",
    "Return %",
    "Status",
    "Opened Timestamp",
    "Updated Timestamp",
    "Closed Timestamp",
    "Action Log"
  ];
  const trades = [...state.tradeHistory, ...(state.openPosition ? [state.openPosition] : [])];
  const rows = trades.map((trade) => [
    trade.tradeId,
    trade.userId ?? "",
    trade.sessionId,
    trade.symbol,
    trade.side.toUpperCase(),
    trade.entryPrice,
    trade.exitPrice ?? "",
    trade.markPrice,
    trade.initialMargin,
    trade.remainingMargin,
    trade.leverage,
    trade.initialQuantity,
    trade.remainingQuantity,
    trade.stopLoss,
    trade.takeProfits.map((tp) => `${tp.price}:${tp.closePercent}%:${tp.isHit ? "hit" : "pending"}`).join(" | "),
    trade.realizedPnl,
    trade.unrealizedPnl,
    trade.returnPercent,
    trade.status,
    trade.openedAt,
    trade.updatedAt,
    trade.closedAt ?? "",
    trade.actionLog.map((action) => `${action.timestamp} ${action.type} ${action.message}`).join(" | ")
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function demoTradeCsvFilename(symbol = "BTCUSDT", date = new Date()): string {
  return `aseke-demo-trades-${symbol}-${date.toISOString().slice(0, 10)}.csv`;
}

function closePositionByPercent(
  state: DemoTradeState,
  exitPrice: number,
  closePercent: number,
  finalStatus: DemoTradeStatus,
  actionType: DemoTradeActionType,
  message: string,
  now: string,
  takeProfitId?: string
): DemoTradeState {
  const position = state.openPosition;
  if (!position) return state;

  const requestedQuantity = mul(toDecimal(position.initialQuantity), div(toDecimal(closePercent), toDecimal(100)));
  const closeQuantity = Math.min(position.remainingQuantity, toNumber(requestedQuantity));
  const nextState = closePositionQuantity(state, exitPrice, closeQuantity, finalStatus, actionType, message, now);

  if (takeProfitId && nextState.openPosition) {
    const takeProfit = nextState.openPosition.takeProfits.find((item) => item.id === takeProfitId);
    if (takeProfit) {
      takeProfit.isHit = true;
      takeProfit.hitAt = now;
    }
  }

  return nextState;
}

function closePositionQuantity(
  state: DemoTradeState,
  exitPrice: number,
  quantityToClose: number,
  finalStatus: DemoTradeStatus,
  actionType: DemoTradeActionType,
  message: string,
  now: string
): DemoTradeState {
  if (!state.openPosition || quantityToClose <= 0) return state;

  const nextState = cloneState(state);
  const position = nextState.openPosition;
  if (!position) return state;

  const closeQuantity = toDecimal(Math.min(quantityToClose, position.remainingQuantity));
  const previousQuantity = toDecimal(position.remainingQuantity);
  const previousMargin = toDecimal(position.remainingMargin);
  const releaseMargin = div(mul(previousMargin, closeQuantity), previousQuantity);
  const grossPnl = toDecimal(calculateUnrealizedPnl({
    side: position.side,
    avgEntryPrice: position.entryPrice,
    markPrice: exitPrice,
    quantityRemaining: toNumber(closeQuantity)
  }));
  const notionalClosed = mul(toDecimal(exitPrice), closeQuantity);
  const fee = mul(notionalClosed, toDecimal(nextState.settings.feeRate));
  const realizedPnl = sub(grossPnl, fee);
  const action = createAction(actionType, message, now, exitPrice, toNumber(realizedPnl));
  const remainingQuantity = sub(previousQuantity, closeQuantity);
  const remainingMargin = sub(previousMargin, releaseMargin);

  nextState.availableBalance = Math.max(
    0,
    roundMoney(toNumber(add(add(toDecimal(nextState.availableBalance), releaseMargin), realizedPnl)))
  );
  nextState.realizedPnl = roundMoney(toNumber(add(toDecimal(nextState.realizedPnl), realizedPnl)));
  position.realizedPnl = roundMoney(toNumber(add(toDecimal(position.realizedPnl), realizedPnl)));
  position.remainingQuantity = roundQuantity(Math.max(0, toNumber(remainingQuantity)));
  position.remainingMargin = roundMoney(Math.max(0, toNumber(remainingMargin)));
  position.exitPrice = roundPrice(exitPrice);
  position.markPrice = roundPrice(exitPrice);
  position.status = position.remainingQuantity <= EPSILON ? finalStatus : "PARTIALLY_CLOSED";
  position.unrealizedPnl = position.remainingQuantity > EPSILON
    ? calculateUnrealizedPnl({
        side: position.side,
        avgEntryPrice: position.entryPrice,
        markPrice: exitPrice,
        quantityRemaining: position.remainingQuantity
      })
    : 0;
  position.returnPercent = position.initialMargin > 0 ? roundPercent((position.realizedPnl / position.initialMargin) * 100) : 0;
  position.updatedAt = now;
  position.actionLog.push(action);
  nextState.actionHistory.push(action);

  if (position.remainingQuantity <= EPSILON) {
    position.remainingQuantity = 0;
    position.remainingMargin = 0;
    position.unrealizedPnl = 0;
    position.closedAt = now;
    nextState.tradeHistory.unshift({ ...position, exitPrice: roundPrice(exitPrice), closedAt: now });
    nextState.openPosition = null;
  } else {
    position.liquidationPrice = calculateLiquidationPrice({
      side: position.side,
      avgEntryPrice: position.entryPrice,
      quantityRemaining: position.remainingQuantity,
      isolatedMarginRemaining: position.remainingMargin,
      maintenanceMarginRate: nextState.settings.maintenanceMarginRate
    });
  }

  return refreshBalances(nextState, now);
}

function liquidateOpenPosition(state: DemoTradeState, markPrice: number, now: string): DemoTradeState {
  if (!state.openPosition) return state;

  const nextState = cloneState(state);
  const position = nextState.openPosition;
  if (!position) return state;

  const marginLoss = toDecimal(position.remainingMargin);
  const action = createAction("liquidated", "Liquidation closed the remaining position.", now, markPrice, -toNumber(marginLoss));
  nextState.realizedPnl = roundMoney(toNumber(sub(toDecimal(nextState.realizedPnl), marginLoss)));
  position.realizedPnl = roundMoney(toNumber(sub(toDecimal(position.realizedPnl), marginLoss)));
  position.unrealizedPnl = 0;
  position.returnPercent = position.initialMargin > 0 ? roundPercent((position.realizedPnl / position.initialMargin) * 100) : -100;
  position.remainingQuantity = 0;
  position.remainingMargin = 0;
  position.markPrice = roundPrice(markPrice);
  position.exitPrice = roundPrice(markPrice);
  position.status = "LIQUIDATED";
  position.updatedAt = now;
  position.closedAt = now;
  position.actionLog.push(action);
  nextState.actionHistory.push(action);
  nextState.tradeHistory.unshift({ ...position, exitPrice: roundPrice(markPrice), closedAt: now });
  nextState.openPosition = null;
  return refreshBalances(nextState, now);
}

function markPosition(state: DemoTradeState, markPrice: number, now: string): DemoTradeState {
  if (!state.openPosition) return state;

  state.openPosition.markPrice = roundPrice(markPrice);
  state.openPosition.unrealizedPnl = calculateUnrealizedPnl({
    side: state.openPosition.side,
    avgEntryPrice: state.openPosition.entryPrice,
    markPrice,
    quantityRemaining: state.openPosition.remainingQuantity
  });
  state.openPosition.returnPercent = state.openPosition.initialMargin > 0
    ? roundPercent(((state.openPosition.realizedPnl + state.openPosition.unrealizedPnl) / state.openPosition.initialMargin) * 100)
    : 0;
  state.openPosition.liquidationPrice = calculateLiquidationPrice({
    side: state.openPosition.side,
    avgEntryPrice: state.openPosition.entryPrice,
    quantityRemaining: state.openPosition.remainingQuantity,
    isolatedMarginRemaining: state.openPosition.remainingMargin,
    maintenanceMarginRate: state.settings.maintenanceMarginRate
  });
  state.openPosition.updatedAt = now;
  return refreshBalances(state, now);
}

function refreshBalances(state: DemoTradeState, now: string): DemoTradeState {
  state.unrealizedPnl = state.openPosition?.unrealizedPnl ?? 0;
  state.currentBalance = roundMoney(state.availableBalance + (state.openPosition?.remainingMargin ?? 0));
  state.updatedAt = now;
  return state;
}

function calculateInputMargin(input: Pick<OpenDemoTradeInput, "sizeMode" | "amount" | "leverage">): DecimalValue {
  const amount = toDecimal(input.amount);
  return input.sizeMode === "margin" ? amount : div(amount, toDecimal(input.leverage));
}

function calculateEquity(state: DemoTradeState): number {
  return roundMoney(state.availableBalance + (state.openPosition?.remainingMargin ?? 0) + state.unrealizedPnl);
}

function isStopLossHit(position: DemoOpenPosition, markPrice: number): boolean {
  if (!Number.isFinite(position.stopLoss) || position.stopLoss <= 0) return false;
  return position.side === "long" ? markPrice <= position.stopLoss : markPrice >= position.stopLoss;
}

function isTakeProfitHit(side: DemoTradeSide, markPrice: number, takeProfitPrice: number): boolean {
  return side === "long" ? markPrice >= takeProfitPrice : markPrice <= takeProfitPrice;
}

function isLiquidationHit(position: DemoOpenPosition, markPrice: number): boolean {
  if (position.liquidationPrice === null) return false;
  return position.side === "long" ? markPrice <= position.liquidationPrice : markPrice >= position.liquidationPrice;
}

function normalizeTakeProfits(
  takeProfits: Array<Pick<DemoTakeProfit, "price" | "closePercent"> & { id?: string }>
): DemoTakeProfit[] {
  return takeProfits
    .filter((takeProfit) => Number.isFinite(Number(takeProfit.price)) || Number.isFinite(Number(takeProfit.closePercent)))
    .map((takeProfit, index) => ({
      id: takeProfit.id || `tp-${index + 1}`,
      price: Number(takeProfit.price),
      closePercent: Number(takeProfit.closePercent),
      isHit: "isHit" in takeProfit ? Boolean((takeProfit as DemoTakeProfit).isHit) : false,
      hitAt: "hitAt" in takeProfit ? (takeProfit as DemoTakeProfit).hitAt : null
    }));
}

function normalizeSymbol(symbol: string): "BTCUSDT" | string {
  return symbol.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function createAction(
  type: DemoTradeActionType,
  message: string,
  timestamp: string,
  price: number | null,
  realizedPnl: number | null
): DemoTradeAction {
  return {
    id: createId("demo-action"),
    type,
    message,
    timestamp,
    price,
    realizedPnl
  };
}

function cloneState(state: DemoTradeState): DemoTradeState {
  return JSON.parse(JSON.stringify(state)) as DemoTradeState;
}

function uniqueErrors(errors: string[]): string[] {
  return [...new Set(errors)];
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toDecimal(value: DecimalInput): DecimalValue {
  if (typeof value === "bigint") return value * DECIMAL_SCALE;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0n;
    return toDecimal(value.toFixed(8));
  }

  const text = value.trim();
  if (!text) return 0n;
  const sign = text.startsWith("-") ? -1n : 1n;
  const unsigned = text.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const normalizedFraction = `${fraction}00000000`.slice(0, 8);
  const wholePart = BigInt(whole || "0") * DECIMAL_SCALE;
  const fractionPart = BigInt(normalizedFraction || "0");
  return sign * (wholePart + fractionPart);
}

function toNumber(value: DecimalValue): number {
  return Number(value) / Number(DECIMAL_SCALE);
}

function add(first: DecimalValue, second: DecimalValue): DecimalValue {
  return first + second;
}

function sub(first: DecimalValue, second: DecimalValue): DecimalValue {
  return first - second;
}

function mul(first: DecimalValue, second: DecimalValue): DecimalValue {
  return (first * second) / DECIMAL_SCALE;
}

function div(first: DecimalValue, second: DecimalValue): DecimalValue {
  if (second === 0n) return 0n;
  return (first * DECIMAL_SCALE) / second;
}

function gt(first: DecimalValue, second: DecimalValue): boolean {
  return first > second;
}

function lt(first: DecimalValue, second: DecimalValue): boolean {
  return first < second;
}

function isPositiveDecimal(value: DecimalValue): boolean {
  return value > 0n;
}

function roundMoney(value: number): number {
  return round(value, 2);
}

function roundPrice(value: number): number {
  return round(value, 2);
}

function roundQuantity(value: number): number {
  return round(value, 8);
}

function roundPercent(value: number): number {
  return round(value, 4);
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
