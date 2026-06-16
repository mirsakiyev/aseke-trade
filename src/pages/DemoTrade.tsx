import {
  AlertTriangle,
  Download,
  LineChart,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  applyMarketPrice,
  calculateLiquidationPrice,
  calculateDemoTradeStats,
  closeOpenPositionByPercent,
  createInitialDemoTradeState,
  demoTradeCsvFilename,
  exportDemoTradesToCsv,
  increaseDemoPosition,
  openDemoPosition,
  resetDemoTradeState,
  updateDemoLeverage,
  updateDemoStopLoss,
  updateDemoTakeProfits,
  type DemoOpenPosition,
  type DemoMarginMode,
  type DemoTradeSide,
  type DemoTradeState
} from "../lib/demoTradeMath";
import {
  demoTradeSymbols,
  demoTradeTimeframes,
  fetchDemoTradeCandles,
  fetchDemoTradeTicker,
  subscribeDemoTradePriceStream,
  type DemoTradeCandle,
  type DemoTradeTicker,
  type DemoTradeTimeframe
} from "../lib/demoTradeMarketData";
import {
  getDemoTradeGuestSessionId,
  loadGuestDemoTradeState,
  loadRegisteredDemoTradeState,
  saveGuestDemoTradeState,
  saveRegisteredDemoTradeState
} from "../lib/demoTradePersistence";

interface TakeProfitDraft {
  id: string;
  price: string;
  closePercent: string;
}

type DemoOrderType = "market" | "limit";

interface PendingLimitOrder {
  side: DemoTradeSide;
  marginMode: DemoMarginMode;
  amount: string;
  leverage: string;
  stopLoss: string;
  takeProfits: TakeProfitDraft[];
  limitPrice: string;
}

const emptyTakeProfits: TakeProfitDraft[] = [
  { id: "tp-1", price: "", closePercent: "100" }
];

const DEMO_TRADE_LIVE_REFRESH_MS = 1000;
const DEMO_TRADE_CANDLE_SYNC_MS = 10000;

export function DemoTrade() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [demoState, setDemoState] = useState<DemoTradeState>(() =>
    createInitialDemoTradeState({ sessionId: "guest-session" })
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const [candles, setCandles] = useState<DemoTradeCandle[]>([]);
  const [timeframe, setTimeframe] = useState<DemoTradeTimeframe>("1h");
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [marketSource, setMarketSource] = useState("Binance.US public market data");
  const [marketError, setMarketError] = useState<string | null>(null);
  const [isMarketLoading, setIsMarketLoading] = useState(true);
  const [orderType, setOrderType] = useState<DemoOrderType>("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [pendingLimitOrder, setPendingLimitOrder] = useState<PendingLimitOrder | null>(null);
  const [marginMode, setMarginMode] = useState<DemoMarginMode>("isolated");
  const [amount, setAmount] = useState("");
  const [leverage, setLeverage] = useState("5");
  const [isBracketEnabled, setIsBracketEnabled] = useState(false);
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfits, setTakeProfits] = useState<TakeProfitDraft[]>(emptyTakeProfits);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [nextStartingBalance, setNextStartingBalance] = useState("1000");
  const [showResetModal, setShowResetModal] = useState(false);
  const [positionStopLoss, setPositionStopLoss] = useState("");
  const [positionLeverage, setPositionLeverage] = useState("5");
  const [positionTakeProfits, setPositionTakeProfits] = useState<TakeProfitDraft[]>([]);
  const [manualClosePercent, setManualClosePercent] = useState("100");
  const [positionAddAmount, setPositionAddAmount] = useState("");
  const [positionErrors, setPositionErrors] = useState<string[]>([]);

  const stats = useMemo(() => calculateDemoTradeStats(demoState), [demoState]);
  const equityTone = stats.equity >= demoState.startingBalance ? "positive" : "negative";
  const activeSymbol = demoTradeSymbols[0];

  const persistDemoState = useCallback((nextState: DemoTradeState) => {
    if (!isHydrated) return;

    const save = user
      ? saveRegisteredDemoTradeState(user.id, nextState)
      : Promise.resolve(saveGuestDemoTradeState(nextState));

    void save.catch(() => undefined);
  }, [isHydrated, user]);

  const commitDemoState = useCallback((nextState: DemoTradeState) => {
    setDemoState(nextState);
    persistDemoState(nextState);
  }, [persistDemoState]);

  const applyLiveTicker = useCallback((ticker: DemoTradeTicker, updateSource = true) => {
    setCurrentPrice(ticker.price);
    if (updateSource) setMarketSource(ticker.source);
    setCandles((items) => applyLivePriceToCandles(items, ticker.price, timeframe, Date.parse(ticker.timestamp)));
    setDemoState((state) => applyMarketPrice(state, ticker.price));
    setMarketError(null);
  }, [timeframe]);

  useEffect(() => {
    if (isAuthLoading) return;

    let isMounted = true;
    async function hydrateState() {
      const sessionId = getDemoTradeGuestSessionId();
      const storedState = user ? await loadRegisteredDemoTradeState(user.id) : loadGuestDemoTradeState();
      const nextState = storedState
        ? {
            ...storedState,
            userId: user?.id ?? null,
            sessionId: storedState.sessionId || sessionId
          }
        : createInitialDemoTradeState({
            sessionId,
            userId: user?.id ?? null,
            startingBalance: 1000
          });

      if (!isMounted) return;
      setDemoState(nextState);
      setNextStartingBalance(String(nextState.startingBalance));
      setIsHydrated(true);
    }

    void hydrateState();
    return () => {
      isMounted = false;
    };
  }, [isAuthLoading, user]);

  useEffect(() => {
    if (!isHydrated) return;

    const saveTimer = window.setTimeout(() => {
      const save = user
        ? saveRegisteredDemoTradeState(user.id, demoState)
        : Promise.resolve(saveGuestDemoTradeState(demoState));

      void save.catch(() => undefined);
    }, 450);

    return () => window.clearTimeout(saveTimer);
  }, [demoState, isHydrated, user]);

  useEffect(() => {
    if (user) return;
    setOrderType("market");
    setPendingLimitOrder(null);
  }, [user]);

  const loadMarketData = useCallback(async () => {
    setMarketError(null);
    try {
      const [nextCandles, ticker] = await Promise.all([
        fetchDemoTradeCandles(activeSymbol.symbol, timeframe),
        fetchDemoTradeTicker(activeSymbol.symbol)
      ]);
      setCandles(applyLivePriceToCandles(nextCandles, ticker.price, timeframe, Date.parse(ticker.timestamp)));
      setCurrentPrice(ticker.price);
      setMarketSource(ticker.source);
      setDemoState((state) => applyMarketPrice(state, ticker.price));
    } catch (error) {
      setMarketError(error instanceof Error ? error.message : "BTC data could not be loaded.");
    } finally {
      setIsMarketLoading(false);
    }
  }, [activeSymbol.symbol, timeframe]);

  useEffect(() => {
    void loadMarketData();
    const liveStream = subscribeDemoTradePriceStream(
      activeSymbol.symbol,
      (ticker) => applyLiveTicker(ticker),
      () => undefined
    );
    const priceTimer = window.setInterval(() => {
      fetchDemoTradeTicker(activeSymbol.symbol)
        .then((ticker) => applyLiveTicker(ticker, false))
        .catch(() => setMarketError("Live BTC price update failed. Retrying..."));
    }, DEMO_TRADE_LIVE_REFRESH_MS);
    const candleTimer = window.setInterval(() => {
      fetchDemoTradeCandles(activeSymbol.symbol, timeframe)
        .then(setCandles)
        .catch(() => setMarketError("BTC candles could not be refreshed."));
    }, DEMO_TRADE_CANDLE_SYNC_MS);

    return () => {
      liveStream?.close();
      window.clearInterval(priceTimer);
      window.clearInterval(candleTimer);
    };
  }, [activeSymbol.symbol, applyLiveTicker, loadMarketData, timeframe]);

  useEffect(() => {
    const position = demoState.openPosition;
    if (!position) {
      setPositionTakeProfits([]);
      setPositionStopLoss("");
      setManualClosePercent("100");
      setPositionAddAmount("");
      return;
    }

    setPositionStopLoss(position.stopLoss > 0 ? String(position.stopLoss) : "");
    setPositionLeverage(String(position.leverage));
    setManualClosePercent("100");
    setPositionTakeProfits(
      position.takeProfits.map((takeProfit) => ({
        id: takeProfit.id,
        price: String(takeProfit.price),
        closePercent: String(takeProfit.closePercent)
      }))
    );
  }, [demoState.openPosition?.tradeId]);

  const openTrade = (requestedSide: DemoTradeSide) => {
    const entryPrice = currentPrice ?? candles[candles.length - 1]?.close ?? 0;
    const submittedBracket = buildSubmittedBracket(isBracketEnabled, stopLoss, takeProfits);

    if (orderType === "limit") {
      const nextLimitPrice = parseNumber(limitPrice);
      const nextErrors: string[] = [];
      if (!user) nextErrors.push("Limit orders are available for registered users only.");
      if (!Number.isFinite(nextLimitPrice) || nextLimitPrice <= 0) nextErrors.push("Enter a valid limit price.");
      if (parseNumber(amount) <= 0) nextErrors.push("Enter a position quantity.");

      if (nextErrors.length) {
        setFormErrors(nextErrors);
        return;
      }

      setPendingLimitOrder({
        side: requestedSide,
        marginMode,
        amount,
        leverage,
        stopLoss: String(submittedBracket.stopLoss),
        takeProfits: submittedBracket.takeProfits.map((takeProfit) => ({
          id: takeProfit.id,
          price: String(takeProfit.price),
          closePercent: String(takeProfit.closePercent)
        })),
        limitPrice: formatInputPrice(nextLimitPrice)
      });
      setFormErrors([]);
      return;
    }

    const result = openDemoPosition(demoState, {
      userId: user?.id ?? null,
      sessionId: demoState.sessionId,
      symbol: activeSymbol.symbol,
      side: requestedSide,
      marginMode,
      sizeMode: "notional",
      amount: parseNumber(amount),
      leverage: parseNumber(leverage),
      entryPrice,
      stopLoss: submittedBracket.stopLoss,
      takeProfits: submittedBracket.takeProfits
    });

    if (!result.ok) {
      setFormErrors(result.errors);
      return;
    }

    setFormErrors([]);
    commitDemoState(result.state);
  };

  useEffect(() => {
    if (!pendingLimitOrder || !currentPrice || demoState.openPosition) return;
    const pendingLimitPrice = parseNumber(pendingLimitOrder.limitPrice);
    if (!Number.isFinite(pendingLimitPrice) || pendingLimitPrice <= 0 || currentPrice > pendingLimitPrice) return;

    const result = openDemoPosition(demoState, {
      userId: user?.id ?? null,
      sessionId: demoState.sessionId,
      symbol: activeSymbol.symbol,
      side: pendingLimitOrder.side,
      marginMode: pendingLimitOrder.marginMode,
      sizeMode: "notional",
      amount: parseNumber(pendingLimitOrder.amount),
      leverage: parseNumber(pendingLimitOrder.leverage),
      entryPrice: pendingLimitPrice,
      stopLoss: parseNumber(pendingLimitOrder.stopLoss),
      takeProfits: pendingLimitOrder.takeProfits.map((takeProfit) => ({
        id: takeProfit.id,
        price: parseNumber(takeProfit.price),
        closePercent: parseNumber(takeProfit.closePercent)
      }))
    });

    setPendingLimitOrder(null);
    if (!result.ok) {
      setFormErrors(result.errors);
      return;
    }
    setOrderType("market");
    setFormErrors([]);
    commitDemoState(result.state);
  }, [activeSymbol.symbol, commitDemoState, currentPrice, demoState, pendingLimitOrder, user]);

  const updateStop = () => {
    const result = updateDemoStopLoss(demoState, parseNumber(positionStopLoss));
    if (!result.ok) {
      setPositionErrors(result.errors);
      return;
    }
    setPositionErrors([]);
    commitDemoState(result.state);
  };

  const updateLeverage = () => {
    const result = updateDemoLeverage(demoState, parseNumber(positionLeverage));
    if (!result.ok) {
      setPositionErrors(result.errors);
      return;
    }
    setPositionErrors([]);
    commitDemoState(result.state);
  };

  const updateTps = () => {
    const result = updateDemoTakeProfits(
      demoState,
      positionTakeProfits.map((takeProfit) => ({
        id: takeProfit.id,
        price: parseNumber(takeProfit.price),
        closePercent: parseNumber(takeProfit.closePercent),
        isHit: demoState.openPosition?.takeProfits.find((item) => item.id === takeProfit.id)?.isHit ?? false,
        hitAt: demoState.openPosition?.takeProfits.find((item) => item.id === takeProfit.id)?.hitAt ?? null
      }))
    );
    if (!result.ok) {
      setPositionErrors(result.errors);
      return;
    }
    setPositionErrors([]);
    commitDemoState(result.state);
  };

  const addToPosition = () => {
    if (!demoState.openPosition) return;
    const entryPrice = currentPrice ?? demoState.openPosition.markPrice;
    const result = increaseDemoPosition(demoState, {
      sizeMode: "notional",
      amount: parseNumber(positionAddAmount),
      entryPrice
    });
    if (!result.ok) {
      setPositionErrors(result.errors);
      return;
    }
    setPositionErrors([]);
    setPositionAddAmount("");
    commitDemoState(result.state);
  };

  const closePosition = () => {
    if (!demoState.openPosition) return;
    const exitPrice = currentPrice ?? demoState.openPosition.markPrice;
    const result = closeOpenPositionByPercent(demoState, exitPrice, parseNumber(manualClosePercent));
    if (!result.ok) {
      setPositionErrors(result.errors);
      return;
    }
    setPositionErrors([]);
    setManualClosePercent("100");
    commitDemoState(result.state);
  };

  const requestBalanceReset = () => {
    const hasProgress = Boolean(demoState.openPosition) || demoState.tradeHistory.length > 0 || demoState.currentBalance !== demoState.startingBalance;
    if (hasProgress) {
      setShowResetModal(true);
      return;
    }
    commitDemoState(resetDemoTradeState(demoState, parseNumber(nextStartingBalance)));
  };

  const confirmBalanceReset = () => {
    commitDemoState(resetDemoTradeState(demoState, parseNumber(nextStartingBalance)));
    setShowResetModal(false);
  };

  const exportCsv = () => {
    const csv = exportDemoTradesToCsv(demoState);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = demoTradeCsvFilename(activeSymbol.symbol);
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="page page-stack demo-trade-page">
      <section className="page-title-row demo-trade-title-row">
        <div>
          <p className="eyebrow">Demo Trade</p>
          <h1>Practice BTC trades with virtual funds</h1>
          <p>
            Demo Trade uses virtual funds for education and practice. It does not place real trades.
          </p>
        </div>
      </section>

      {!user && (
        <section className="notice-box demo-save-note">
          Create an account to save your demo trading progress permanently. Guest progress is kept in this browser.
          <Link to="/register">Register</Link>
        </section>
      )}

      <section className="demo-market-strip">
        <label>
          <span>Symbol</span>
          <select value={activeSymbol.symbol} disabled>
            {demoTradeSymbols.map((symbol) => (
              <option value={symbol.symbol} key={symbol.symbol}>
                {symbol.label}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span>Current BTC Price</span>
          <strong>{currentPrice ? formatCurrency(currentPrice) : isMarketLoading ? "Loading..." : "Unavailable"}</strong>
        </div>
        <div>
          <span>Equity</span>
          <strong className={equityTone}>{formatCurrency(stats.equity)}</strong>
        </div>
        <div>
          <span>Data source</span>
          <strong>{marketSource}</strong>
        </div>
      </section>

      {marketError && <p className="warning-box">{marketError}</p>}

      <section className="demo-trade-grid">
        <article className="section-panel demo-chart-panel">
          <p className="eyebrow compact-panel-label">Custom chart</p>
          <DemoTradeChart
            candles={candles}
            currentPrice={currentPrice}
            position={demoState.openPosition}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
          />
          {demoState.openPosition && <CurrentTradeRow position={demoState.openPosition} />}
        </article>

        <aside className="section-panel demo-ticket-panel">
          <p className="eyebrow compact-panel-label">{demoState.openPosition ? "Manage position" : "Trade ticket"}</p>

          {demoState.openPosition ? (
            <PositionManager
              position={demoState.openPosition}
              stopLoss={positionStopLoss}
              leverage={positionLeverage}
              takeProfits={positionTakeProfits}
              closePercent={manualClosePercent}
              addAmount={positionAddAmount}
              availableBalance={demoState.availableBalance}
              currentPrice={currentPrice ?? demoState.openPosition.markPrice}
              errors={positionErrors}
              onStopLossChange={setPositionStopLoss}
              onLeverageChange={setPositionLeverage}
              onTakeProfitsChange={setPositionTakeProfits}
              onClosePercentChange={setManualClosePercent}
              onAddAmountChange={setPositionAddAmount}
              onAddToPosition={addToPosition}
              onUpdateStop={updateStop}
              onUpdateLeverage={updateLeverage}
              onUpdateTakeProfits={updateTps}
              onClose={closePosition}
            />
          ) : (
            <TradeEntryForm
              orderType={orderType}
              marginMode={marginMode}
              amount={amount}
              leverage={leverage}
              isBracketEnabled={isBracketEnabled}
              limitPrice={limitPrice}
              stopLoss={stopLoss}
              takeProfits={takeProfits}
              currentPrice={currentPrice}
              availableBalance={demoState.availableBalance}
              isRegistered={Boolean(user)}
              hasPendingLimitOrder={Boolean(pendingLimitOrder)}
              pendingLimitPrice={pendingLimitOrder?.limitPrice ?? ""}
              errors={formErrors}
              onOrderTypeChange={setOrderType}
              onMarginModeChange={setMarginMode}
              onAmountChange={setAmount}
              onLeverageChange={setLeverage}
              onBracketEnabledChange={(enabled) => {
                setIsBracketEnabled(enabled);
                if (enabled && takeProfits.length === 0) setTakeProfits(emptyTakeProfits);
              }}
              onLimitPriceChange={setLimitPrice}
              onStopLossChange={setStopLoss}
              onTakeProfitsChange={setTakeProfits}
              onCancelLimitOrder={() => setPendingLimitOrder(null)}
              onOpen={openTrade}
            />
          )}
        </aside>
      </section>

      <section className="dashboard-grid demo-summary-grid">
        <article className="section-panel demo-balance-panel">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Demo balance</p>
              <h2>Reset / re-up</h2>
            </div>
          </div>
          <label>
            Starting Balance
            <input
              type="number"
              min="1"
              step="1"
              value={nextStartingBalance}
              onChange={(event) => setNextStartingBalance(event.target.value)}
            />
          </label>
          <button className="ghost-button compact" type="button" onClick={requestBalanceReset}>
            <RotateCcw size={16} />
            Reset and Apply Balance
          </button>
        </article>

        <PerformanceStats stats={stats} />
      </section>

      <TradeHistoryTable trades={demoState.tradeHistory} onExport={exportCsv} />

      {showResetModal && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card reset-demo-modal" role="dialog" aria-modal="true" aria-labelledby="reset-demo-title">
            <AlertTriangle size={24} aria-hidden="true" />
            <h2 id="reset-demo-title">Reset demo progress?</h2>
            <p>
              Changing your starting demo balance will reset your current demo progress, including open positions
              and trade history. You can export your previous trades to CSV before resetting.
            </p>
            <div className="inline-actions">
              <button className="ghost-button compact" type="button" onClick={() => setShowResetModal(false)}>
                Cancel
              </button>
              <button className="ghost-button compact" type="button" onClick={exportCsv}>
                <Download size={16} />
                Export CSV
              </button>
              <button className="primary-button compact" type="button" onClick={confirmBalanceReset}>
                Reset and Apply New Balance
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function TradeEntryForm({
  orderType,
  marginMode,
  amount,
  leverage,
  isBracketEnabled,
  limitPrice,
  stopLoss,
  takeProfits,
  currentPrice,
  availableBalance,
  isRegistered,
  hasPendingLimitOrder,
  pendingLimitPrice,
  errors,
  onOrderTypeChange,
  onMarginModeChange,
  onAmountChange,
  onLeverageChange,
  onBracketEnabledChange,
  onLimitPriceChange,
  onStopLossChange,
  onTakeProfitsChange,
  onCancelLimitOrder,
  onOpen
}: {
  orderType: DemoOrderType;
  marginMode: DemoMarginMode;
  amount: string;
  leverage: string;
  isBracketEnabled: boolean;
  limitPrice: string;
  stopLoss: string;
  takeProfits: TakeProfitDraft[];
  currentPrice: number | null;
  availableBalance: number;
  isRegistered: boolean;
  hasPendingLimitOrder: boolean;
  pendingLimitPrice: string;
  errors: string[];
  onOrderTypeChange: (type: DemoOrderType) => void;
  onMarginModeChange: (mode: DemoMarginMode) => void;
  onAmountChange: (value: string) => void;
  onLeverageChange: (value: string) => void;
  onBracketEnabledChange: (enabled: boolean) => void;
  onLimitPriceChange: (value: string) => void;
  onStopLossChange: (value: string) => void;
  onTakeProfitsChange: (items: TakeProfitDraft[]) => void;
  onCancelLimitOrder: () => void;
  onOpen: (side: DemoTradeSide) => void;
}) {
  const parsedLeverage = Math.max(1, Math.trunc(parseNumber(leverage)) || 1);
  const amountValue = parseNumber(amount);
  const maxMargin = Math.max(0, availableBalance);
  const maxOpenableAmount = maxMargin * parsedLeverage;
  const amountPercent = maxOpenableAmount > 0 ? clamp((amountValue / maxOpenableAmount) * 100, 0, 100) : 0;
  const sliderStyle = { "--size-fill": `${amountPercent}%` } as CSSProperties;
  const notional = amountValue;
  const margin = notional / parsedLeverage;
  const liquidationCollateral = marginMode === "cross" ? availableBalance : margin;
  const quantity = currentPrice && currentPrice > 0 ? notional / currentPrice : 0;
  const longLiquidation = currentPrice
    ? calculateLiquidationPrice({
        side: "long",
        avgEntryPrice: currentPrice,
        quantityRemaining: quantity,
        isolatedMarginRemaining: liquidationCollateral
      })
    : null;
  const shortLiquidation = currentPrice
    ? calculateLiquidationPrice({
        side: "short",
        avgEntryPrice: currentPrice,
        quantityRemaining: quantity,
        isolatedMarginRemaining: liquidationCollateral
      })
    : null;

  const setAmountFromPercent = (nextPercent: string) => {
    const nextPercentValue = clamp(parseNumber(nextPercent), 0, 100);
    const nextAmount = Math.min(maxOpenableAmount, maxOpenableAmount * (nextPercentValue / 100));
    onAmountChange(formatAmountInput(nextAmount));
  };

  const openSide = (nextSide: DemoTradeSide) => {
    onOpen(nextSide);
  };

  return (
    <div className="demo-ticket-stack futures-ticket">
      <div className="futures-contract-row">
        <strong>BTCUSDT Perpetual</strong>
        <span>Market</span>
      </div>

      <div className="futures-mode-row">
        <select
          className="futures-mode-chip"
          value={marginMode}
          onChange={(event) => onMarginModeChange(event.target.value as DemoMarginMode)}
          aria-label="Margin mode"
        >
          <option value="isolated">Isolated</option>
          <option value="cross">Cross</option>
        </select>
        <select className="futures-mode-chip" value={leverage} onChange={(event) => onLeverageChange(event.target.value)} aria-label="Leverage">
          {Array.from({ length: 100 }, (_, index) => index + 1).map((value) => (
            <option value={value} key={value}>
              {value}X
            </option>
          ))}
        </select>
      </div>

      <div className="futures-order-tabs" aria-label="Order type">
        <button
          className={orderType === "limit" ? "active" : ""}
          type="button"
          disabled={!isRegistered}
          title={isRegistered ? "Place a limit order" : "Limit orders are for registered users"}
          onClick={() => onOrderTypeChange("limit")}
        >
          Limit
        </button>
        <button className={orderType === "market" ? "active" : ""} type="button" onClick={() => onOrderTypeChange("market")}>
          Market
        </button>
      </div>

      {orderType === "limit" && (
        <label className="futures-limit-price">
          Limit Price
          <input type="number" min="0" step="0.01" value={limitPrice} onChange={(event) => onLimitPriceChange(event.target.value)} />
        </label>
      )}

      {hasPendingLimitOrder && (
        <div className="futures-pending-limit">
          <span>Limit pending at {formatUsdt(parseNumber(pendingLimitPrice))}</span>
          <button type="button" onClick={onCancelLimitOrder}>
            Cancel
          </button>
        </div>
      )}

      <div className="futures-available-row">
        <span>Available</span>
        <strong>{formatUsdt(availableBalance)}</strong>
      </div>

      <label className="futures-quantity-card">
        <span>Quantity (USDT)</span>
        <div className="futures-quantity-input-row">
          <input
            type="number"
            min="0"
            step="1"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            placeholder="Max. openable quantity"
          />
          <strong>{Math.round(amountPercent)}%</strong>
        </div>
      </label>

      <div className="futures-percent-control">
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(amountPercent)}
          style={sliderStyle}
          onChange={(event) => setAmountFromPercent(event.target.value)}
          aria-label="Position size percent"
        />
        <div className="futures-percent-marks" aria-hidden="true">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
      </div>

      <div className="futures-side-notional">
        <span>
          Buy <strong>{formatUsdt(notional)}</strong>
        </span>
        <span>
          Sell <strong>{formatUsdt(notional)}</strong>
        </span>
      </div>

      <details className="futures-bracket-block" open={isBracketEnabled} onToggle={(event) => onBracketEnabledChange(event.currentTarget.open)}>
        <summary>
          <span aria-hidden="true" />
          <strong>TP/SL</strong>
        </summary>
        {isBracketEnabled && (
          <>
            <label>
              Stop Loss
              <input type="number" min="0" step="0.01" value={stopLoss} onChange={(event) => onStopLossChange(event.target.value)} />
            </label>
            <TakeProfitEditor takeProfits={takeProfits} onChange={onTakeProfitsChange} />
          </>
        )}
      </details>

      <div className="futures-action-row">
        <button className="primary-button futures-submit long" type="button" onClick={() => openSide("long")} disabled={!currentPrice}>
          Open Long
        </button>
        <button className="primary-button futures-submit short" type="button" onClick={() => openSide("short")} disabled={!currentPrice}>
          Open Short
        </button>
      </div>

      <dl className="demo-estimate-grid futures-estimate-grid">
        <div>
          <dt>Margin</dt>
          <dd>{formatUsdt(margin)}</dd>
        </div>
        <div>
          <dt>Notional</dt>
          <dd>{formatUsdt(notional)}</dd>
        </div>
        <div>
          <dt>Long Liquidation Price</dt>
          <dd>{longLiquidation ? formatUsdt(longLiquidation) : "-- USDT"}</dd>
        </div>
        <div>
          <dt>Short Liquidation Price</dt>
          <dd>{shortLiquidation ? formatUsdt(shortLiquidation) : "-- USDT"}</dd>
        </div>
      </dl>

      <ErrorList errors={errors} />
    </div>
  );
}

function PositionManager({
  position,
  stopLoss,
  leverage,
  takeProfits,
  closePercent,
  addAmount,
  availableBalance,
  currentPrice,
  errors,
  onStopLossChange,
  onLeverageChange,
  onTakeProfitsChange,
  onClosePercentChange,
  onAddAmountChange,
  onAddToPosition,
  onUpdateStop,
  onUpdateLeverage,
  onUpdateTakeProfits,
  onClose
}: {
  position: DemoOpenPosition;
  stopLoss: string;
  leverage: string;
  takeProfits: TakeProfitDraft[];
  closePercent: string;
  addAmount: string;
  availableBalance: number;
  currentPrice: number;
  errors: string[];
  onStopLossChange: (value: string) => void;
  onLeverageChange: (value: string) => void;
  onTakeProfitsChange: (items: TakeProfitDraft[]) => void;
  onClosePercentChange: (value: string) => void;
  onAddAmountChange: (value: string) => void;
  onAddToPosition: () => void;
  onUpdateStop: () => void;
  onUpdateLeverage: () => void;
  onUpdateTakeProfits: () => void;
  onClose: () => void;
}) {
  const closePercentValue = clamp(parseNumber(closePercent), 0, 100);
  const closeRatio = closePercentValue / 100;
  const closingQuantity = position.remainingQuantity * closeRatio;
  const remainingAfterClose = position.remainingQuantity - closingQuantity;
  const closeSliderStyle = { "--size-fill": `${closePercentValue}%` } as CSSProperties;
  const addAmountValue = parseNumber(addAmount);
  const maxAddAmount = Math.max(0, availableBalance) * position.leverage;
  const addPercent = maxAddAmount > 0 ? clamp((addAmountValue / maxAddAmount) * 100, 0, 100) : 0;
  const addSliderStyle = { "--size-fill": `${addPercent}%` } as CSSProperties;
  const estimatedAddQuantity = currentPrice > 0 ? addAmountValue / currentPrice : 0;

  const setAddAmountFromPercent = (nextPercent: string) => {
    const nextPercentValue = clamp(parseNumber(nextPercent), 0, 100);
    const nextAmount = Math.min(maxAddAmount, maxAddAmount * (nextPercentValue / 100));
    onAddAmountChange(formatAmountInput(nextAmount));
  };

  return (
    <div className="demo-ticket-stack">
      <div className="position-add-block">
        <div className="manual-close-heading">
          <strong>Add to position</strong>
          <span>{Math.round(addPercent)}%</span>
        </div>
        <label>
          Quantity (USDT)
          <input
            type="number"
            min="0"
            step="1"
            value={addAmount}
            onChange={(event) => onAddAmountChange(event.target.value)}
            placeholder="Extra size"
          />
        </label>
        <div className="futures-percent-control">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(addPercent)}
            style={addSliderStyle}
            onChange={(event) => setAddAmountFromPercent(event.target.value)}
            aria-label="Add position size percent"
          />
          <div className="futures-percent-marks" aria-hidden="true">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </div>
        </div>
        <dl className="manual-close-metrics">
          <div>
            <dt>Available</dt>
            <dd>{formatUsdt(availableBalance)}</dd>
          </div>
          <div>
            <dt>Est. Qty</dt>
            <dd>{estimatedAddQuantity.toFixed(6)} BTC</dd>
          </div>
        </dl>
        <button className="ghost-button compact" type="button" onClick={onAddToPosition} disabled={!maxAddAmount}>
          Add to Position
        </button>
      </div>

      <div className="demo-inline-edit">
        <label>
          Stop Loss
          <input type="number" min="0" step="0.01" value={stopLoss} onChange={(event) => onStopLossChange(event.target.value)} />
        </label>
        <button className="ghost-button compact" type="button" onClick={onUpdateStop}>
          <Save size={16} />
          Update SL
        </button>
      </div>

      <div className="demo-inline-edit">
        <label>
          Leverage
          <select value={leverage} onChange={(event) => onLeverageChange(event.target.value)}>
            {Array.from({ length: 100 }, (_, index) => index + 1).map((value) => (
              <option value={value} key={value}>
                {value}x
              </option>
            ))}
          </select>
        </label>
        <button className="ghost-button compact" type="button" onClick={onUpdateLeverage}>
          <Save size={16} />
          Update
        </button>
      </div>

      <TakeProfitEditor takeProfits={takeProfits} onChange={onTakeProfitsChange} />
      <button className="ghost-button compact" type="button" onClick={onUpdateTakeProfits}>
        <Save size={16} />
        Save TP Changes
      </button>

      <div className="manual-close-block">
        <div className="manual-close-heading">
          <strong>Market close</strong>
          <span>{closePercentValue.toFixed(closePercentValue % 1 ? 2 : 0)}%</span>
        </div>
        <label>
          Close Size (%)
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            value={closePercent}
            onChange={(event) => onClosePercentChange(event.target.value)}
          />
        </label>
        <div className="futures-percent-control">
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={Math.max(1, Math.round(closePercentValue || 1))}
            style={closeSliderStyle}
            onChange={(event) => onClosePercentChange(event.target.value)}
            aria-label="Manual close size percent"
          />
          <div className="futures-percent-marks" aria-hidden="true">
            <span>1%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </div>
        </div>
        <dl className="manual-close-metrics">
          <div>
            <dt>Closing Qty</dt>
            <dd>{closingQuantity.toFixed(6)} BTC</dd>
          </div>
          <div>
            <dt>Remaining</dt>
            <dd>{Math.max(0, remainingAfterClose).toFixed(6)} BTC</dd>
          </div>
        </dl>
        <button className="primary-button danger-button" type="button" onClick={onClose}>
          Close at Market
        </button>
      </div>

      <ErrorList errors={errors} />
    </div>
  );
}

function TakeProfitEditor({
  takeProfits,
  onChange
}: {
  takeProfits: TakeProfitDraft[];
  onChange: (items: TakeProfitDraft[]) => void;
}) {
  const updateRow = (id: string, patch: Partial<TakeProfitDraft>) => {
    onChange(takeProfits.map((takeProfit) => (takeProfit.id === id ? { ...takeProfit, ...patch } : takeProfit)));
  };

  const addRow = () => {
    onChange([...takeProfits, { id: `tp-${Date.now()}`, price: "", closePercent: "" }]);
  };

  const removeRow = (id: string) => {
    onChange(takeProfits.filter((takeProfit) => takeProfit.id !== id));
  };

  return (
    <div className="tp-builder">
      <div className="tp-builder-heading">
        <strong>Take Profits</strong>
        <button className="icon-button" type="button" onClick={addRow} aria-label="Add take profit">
          <Plus size={16} />
        </button>
      </div>
      {takeProfits.map((takeProfit, index) => (
        <div className="tp-draft-row" key={takeProfit.id}>
          <label>
            TP{index + 1} Price
            <input
              type="number"
              min="0"
              step="0.01"
              value={takeProfit.price}
              onChange={(event) => updateRow(takeProfit.id, { price: event.target.value })}
            />
          </label>
          <label>
            Close %
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={takeProfit.closePercent}
              onChange={(event) => updateRow(takeProfit.id, { closePercent: event.target.value })}
            />
          </label>
          <button className="icon-button danger" type="button" onClick={() => removeRow(takeProfit.id)} aria-label={`Remove TP${index + 1}`}>
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

function DemoTradeChart({
  candles,
  currentPrice,
  position,
  timeframe,
  onTimeframeChange
}: {
  candles: DemoTradeCandle[];
  currentPrice: number | null;
  position: DemoOpenPosition | null;
  timeframe: DemoTradeTimeframe;
  onTimeframeChange: (timeframe: DemoTradeTimeframe) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(defaultVisibleCandles(timeframe));
  const [offset, setOffset] = useState(0);
  const [isRightDragging, setIsRightDragging] = useState(false);
  const [isPriceScaling, setIsPriceScaling] = useState(false);
  const [priceScale, setPriceScale] = useState(1);
  const [pricePan, setPricePan] = useState(0);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number; price: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; offset: number; pricePan: number; pointerId: number } | null>(null);
  const priceScaleStartRef = useRef<{ y: number; scale: number; pointerId: number } | null>(null);
  const maxOffset = Math.max(0, candles.length - visibleCount);
  const futurePaddingCandles = Math.min(90, Math.max(24, Math.floor(visibleCount * 0.5)));
  const safeOffset = clamp(offset, -futurePaddingCandles, maxOffset);
  const futureSlots = Math.max(0, -safeOffset);
  const dataWindowCount = Math.max(1, visibleCount - futureSlots);
  const end = Math.max(0, candles.length - Math.max(safeOffset, 0));
  const visibleCandles = candles.slice(Math.max(0, end - dataWindowCount), end);
  const overlayLines = buildOverlayLines(position, currentPrice);
  const autoscaleOverlayPrices = overlayLines
    .filter((line) => line.tone !== "liquidation")
    .map((line) => line.price);
  const prices = visibleCandles.flatMap((candle) => [candle.high, candle.low]).concat(autoscaleOverlayPrices);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 1;
  const range = Math.max(maxPrice - minPrice, 1);
  const priceMidpoint = (minPrice + maxPrice) / 2 + pricePan;
  const scaledRange = range * priceScale;
  const paddedMin = priceMidpoint - scaledRange * 0.62;
  const paddedMax = priceMidpoint + scaledRange * 0.62;
  const width = 1040;
  const height = 660;
  const padding = { top: 24, right: 118, bottom: 34, left: 22 };
  const axisX = width - padding.right;
  const chartWidth = axisX - padding.left;
  const chartHeight = height - padding.top - padding.bottom;
  const candleGap = chartWidth / Math.max(visibleCount, 1);
  const candleWidth = clamp(candleGap * 0.76, 7, 20);
  const isFastTimeframe = timeframe === "1m" || timeframe === "5m";
  const minBodyHeight = isFastTimeframe ? 5 : 3;
  const minWickHeight = isFastTimeframe ? 12 : 5;
  const yForPrice = (price: number) => padding.top + ((paddedMax - price) / (paddedMax - paddedMin)) * chartHeight;
  const priceForY = (y: number) => paddedMax - ((y - padding.top) / chartHeight) * (paddedMax - paddedMin);
  const priceTicks = Array.from({ length: 8 }, (_, index) => paddedMax - ((paddedMax - paddedMin) / 7) * index);
  const verticalGridCount = Math.min(10, Math.max(4, Math.floor(visibleCount / 10)));

  useEffect(() => {
    setVisibleCount(defaultVisibleCandles(timeframe));
    setOffset(0);
    setPriceScale(1);
    setPricePan(0);
  }, [timeframe]);

  useEffect(() => {
    setOffset((value) => clamp(value, -futurePaddingCandles, Math.max(0, candles.length - visibleCount)));
  }, [candles.length, futurePaddingCandles, visibleCount]);

  const zoomBy = (amount: number) => {
    setVisibleCount((count) => clamp(count + amount, 28, Math.min(160, Math.max(candles.length, 40))));
  };

  const startRightDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const axisStart = bounds.left + (axisX / width) * bounds.width;
    if (event.clientX >= axisStart) {
      priceScaleStartRef.current = { y: event.clientY, scale: priceScale, pointerId: event.pointerId };
      setIsPriceScaling(true);
      return;
    }
    dragStartRef.current = { x: event.clientX, y: event.clientY, offset: safeOffset, pricePan, pointerId: event.pointerId };
    setIsRightDragging(true);
  };

  const updateCrosshair = (event: PointerEvent<SVGSVGElement>) => {
    if (dragStartRef.current || priceScaleStartRef.current) return;

    const pointer = getSvgPointer(event, width, height);
    const x = clamp(pointer.x, padding.left, axisX);
    const y = clamp(pointer.y, padding.top, height - padding.bottom);
    const isInsidePlot = pointer.x >= padding.left && pointer.x <= axisX && pointer.y >= padding.top && pointer.y <= height - padding.bottom;

    setCrosshair(isInsidePlot ? { x, y, price: priceForY(y) } : null);
  };

  const moveRightDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (priceScaleStartRef.current) {
      event.preventDefault();
      const deltaY = event.clientY - priceScaleStartRef.current.y;
      setPriceScale(clamp(priceScaleStartRef.current.scale * Math.exp(deltaY / 180), 0.45, 4));
      return;
    }
    if (!dragStartRef.current) return;
    event.preventDefault();
    const deltaCandles = Math.round((event.clientX - dragStartRef.current.x) / Math.max(5, candleGap));
    const pricePerPixel = scaledRange / Math.max(1, chartHeight);
    const deltaY = event.clientY - dragStartRef.current.y;
    setOffset(clamp(dragStartRef.current.offset + deltaCandles, -futurePaddingCandles, Math.max(0, candles.length - visibleCount)));
    setPricePan(dragStartRef.current.pricePan + deltaY * pricePerPixel);
  };

  const handleChartPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    updateCrosshair(event);
    moveRightDrag(event);
  };

  const stopRightDrag = (event?: PointerEvent<SVGSVGElement>) => {
    if (event && dragStartRef.current && event.currentTarget.hasPointerCapture(dragStartRef.current.pointerId)) {
      event.currentTarget.releasePointerCapture(dragStartRef.current.pointerId);
    }
    if (event && priceScaleStartRef.current && event.currentTarget.hasPointerCapture(priceScaleStartRef.current.pointerId)) {
      event.currentTarget.releasePointerCapture(priceScaleStartRef.current.pointerId);
    }
    dragStartRef.current = null;
    priceScaleStartRef.current = null;
    setIsRightDragging(false);
    setIsPriceScaling(false);
  };

  const leaveChart = (event: PointerEvent<SVGSVGElement>) => {
    stopRightDrag(event);
    setCrosshair(null);
  };
  const chartClassName = [
    "demo-trade-chart",
    isRightDragging ? "dragging" : "",
    isPriceScaling ? "scaling" : ""
  ].filter(Boolean).join(" ");

  return (
    <div className="demo-chart-shell">
      <div className="demo-chart-controls">
        <div className="demo-timeframe-tabs" aria-label="Chart timeframe">
          {demoTradeTimeframes.map((item) => (
            <button
              className={timeframe === item.value ? "active" : ""}
              type="button"
              onClick={() => onTimeframeChange(item.value)}
              key={item.value}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="demo-chart-icon-controls" aria-label="Chart view controls">
          <button className="icon-button chart-control-button" type="button" onClick={() => zoomBy(-12)} title="Zoom in">
            <Plus size={16} />
            <span className="sr-only">Zoom in</span>
          </button>
          <button className="icon-button chart-control-button" type="button" onClick={() => zoomBy(12)} title="Zoom out">
            <Minus size={16} />
            <span className="sr-only">Zoom out</span>
          </button>
        </div>
      </div>

      {visibleCandles.length ? (
        <svg
          className={chartClassName}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Custom BTC USDT demo trading chart"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={startRightDrag}
          onPointerMove={handleChartPointerMove}
          onPointerUp={stopRightDrag}
          onPointerCancel={stopRightDrag}
          onPointerLeave={leaveChart}
        >
          <defs>
            <clipPath id="demo-trade-chart-plot">
              <rect x={padding.left} y={padding.top} width={chartWidth} height={chartHeight} rx="4" />
            </clipPath>
          </defs>
          <rect width={width} height={height} rx="10" />
          <rect className="chart-axis-panel" x={axisX} y="0" width={padding.right} height={height} />
          {priceTicks.map((price) => {
            const y = yForPrice(price);
            return (
              <g key={price}>
                <line className="chart-grid-line" x1={padding.left} x2={axisX} y1={y} y2={y} />
                <text className="chart-price-label" x={axisX + 14} y={y + 4}>
                  {formatChartPrice(price)}
                </text>
              </g>
            );
          })}
          {Array.from({ length: verticalGridCount + 1 }, (_, index) => {
            const x = padding.left + (chartWidth / verticalGridCount) * index;
            return <line className="chart-grid-line vertical" x1={x} x2={x} y1={padding.top} y2={height - padding.bottom} key={x} />;
          })}
          <g clipPath="url(#demo-trade-chart-plot)">
            {visibleCandles.map((candle, index) => {
              const x = padding.left + index * candleGap + candleGap / 2;
              const openY = yForPrice(candle.open);
              const closeY = yForPrice(candle.close);
              const highY = yForPrice(candle.high);
              const lowY = yForPrice(candle.low);
              const previousClose = visibleCandles[index - 1]?.close ?? candle.open;
              const isUp = candle.close === candle.open ? candle.close >= previousClose : candle.close > candle.open;
              const candleShape = buildCandleShape({
                openY,
                closeY,
                highY,
                lowY,
                minBodyHeight,
                minWickHeight,
                chartTop: padding.top,
                chartBottom: height - padding.bottom
              });
              return (
                <g className={isUp ? "candle up" : "candle down"} key={`${candle.timestamp}-${index}`}>
                  <line className="candle-wick" x1={x} x2={x} y1={candleShape.wickY1} y2={candleShape.wickY2} />
                  <rect
                    className="candle-body"
                    x={x - candleWidth / 2}
                    y={candleShape.bodyY}
                    width={candleWidth}
                    height={candleShape.bodyHeight}
                    rx="1.5"
                  />
                </g>
              );
            })}
          </g>
          {overlayLines.map((line) => {
            const rawY = yForPrice(line.price);
            const y = clamp(rawY, padding.top + 10, height - padding.bottom - 10);
            return (
              <g className={`trade-overlay-line ${line.tone}`} key={`${line.label}-${line.price}`}>
                <line x1={padding.left} x2={axisX} y1={y} y2={y} />
                {line.tone === "mark" ? (
                  <>
                    <rect className="chart-price-marker" x={axisX + 8} y={y - 15} width="86" height="28" rx="4" />
                    <text className="chart-price-marker-text" x={axisX + 16} y={y + 4}>
                      {formatChartPrice(line.price)}
                    </text>
                  </>
                ) : (
                  <text x={axisX + 14} y={y + 4}>
                    {line.label}
                  </text>
                )}
                <text className="chart-overlay-label" x={padding.left + 8} y={y - 6}>
                  {line.label}
                </text>
              </g>
            );
          })}
          {crosshair && (
            <g className="chart-crosshair" aria-hidden="true">
              <line className="chart-crosshair-line" x1={padding.left} x2={axisX} y1={crosshair.y} y2={crosshair.y} />
              <line className="chart-crosshair-line" x1={crosshair.x} x2={crosshair.x} y1={padding.top} y2={height - padding.bottom} />
              <rect className="chart-crosshair-price" x={axisX + 8} y={crosshair.y - 14} width="86" height="28" rx="4" />
              <text className="chart-crosshair-price-text" x={axisX + 16} y={crosshair.y + 4}>
                {formatChartPrice(crosshair.price)}
              </text>
            </g>
          )}
        </svg>
      ) : (
        <div className="demo-chart-empty">
          <LineChart size={28} />
          <strong>Loading custom BTC chart</strong>
          <span>Live candles will appear here when market data is available.</span>
        </div>
      )}
    </div>
  );
}

function CurrentTradeRow({ position }: { position: DemoOpenPosition }) {
  return (
    <div className="current-trade-row">
      <div className="current-trade-heading">
        <span>Current trade</span>
        <strong className={position.side === "long" ? "positive" : "negative"}>
          {position.side.toUpperCase()} BTC/USDT
        </strong>
      </div>
      <dl className="current-trade-metrics">
        <Metric label="Entry" value={formatCurrency(position.entryPrice)} />
        <Metric label="Mark" value={formatCurrency(position.markPrice)} />
        <Metric label="Qty" value={`${position.remainingQuantity.toFixed(6)} BTC`} />
        <Metric label="Margin" value={formatCurrency(position.remainingMargin)} />
        <Metric label="Liq" value={position.liquidationPrice ? formatCurrency(position.liquidationPrice) : "N/A"} />
        <Metric
          label="uPnL"
          value={formatCurrency(position.unrealizedPnl)}
          tone={position.unrealizedPnl >= 0 ? "positive" : "negative"}
        />
        <Metric label="Status" value={position.status} />
      </dl>
    </div>
  );
}

function PerformanceStats({ stats }: { stats: ReturnType<typeof calculateDemoTradeStats> }) {
  return (
    <article className="section-panel performance-panel">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Performance stats</p>
          <h2>Demo account</h2>
        </div>
      </div>
      <dl className="demo-stats-grid">
        <Metric label="Starting Balance" value={formatCurrency(stats.startingBalance)} />
        <Metric label="Current Balance" value={formatCurrency(stats.currentBalance)} />
        <Metric label="Available Balance" value={formatCurrency(stats.availableBalance)} />
        <Metric label="Equity" value={formatCurrency(stats.equity)} />
        <Metric label="Realized PnL" value={formatCurrency(stats.realizedPnl)} tone={stats.realizedPnl >= 0 ? "positive" : "negative"} />
        <Metric label="Unrealized PnL" value={formatCurrency(stats.unrealizedPnl)} tone={stats.unrealizedPnl >= 0 ? "positive" : "negative"} />
        <Metric label="Total Return" value={`${stats.totalReturnPercent.toFixed(2)}%`} />
        <Metric label="Trades" value={String(stats.trades)} />
        <Metric label="Wins" value={String(stats.wins)} />
        <Metric label="Losses" value={String(stats.losses)} />
        <Metric label="Win Rate" value={`${stats.winRate.toFixed(2)}%`} />
        <Metric label="Largest Win" value={formatCurrency(stats.largestWin)} />
        <Metric label="Largest Loss" value={formatCurrency(stats.largestLoss)} />
        <Metric label="Liquidations" value={String(stats.liquidations)} />
      </dl>
    </article>
  );
}

function TradeHistoryTable({ trades, onExport }: { trades: DemoTradeState["tradeHistory"]; onExport: () => void }) {
  return (
    <section className="section-panel demo-history-panel">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Trade history</p>
          <h2>Closed demo trades</h2>
        </div>
        <button className="ghost-button compact" type="button" onClick={onExport}>
          <Download size={16} />
          Export CSV
        </button>
      </div>
      {trades.length ? (
        <div className="table-scroll">
          <table className="past-trades-table demo-history-table">
            <thead>
              <tr>
                <th scope="col">Trade ID</th>
                <th scope="col">Side</th>
                <th scope="col">Entry</th>
                <th scope="col">Exit</th>
                <th scope="col">Realized PnL</th>
                <th scope="col">Return</th>
                <th scope="col">Status</th>
                <th scope="col">Closed</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.tradeId}>
                  <td>{trade.tradeId}</td>
                  <td>{trade.side.toUpperCase()}</td>
                  <td>{formatCurrency(trade.entryPrice)}</td>
                  <td>{formatCurrency(trade.exitPrice)}</td>
                  <td className={trade.realizedPnl >= 0 ? "positive" : "negative"}>{formatCurrency(trade.realizedPnl)}</td>
                  <td>{trade.returnPercent.toFixed(2)}%</td>
                  <td>{trade.status}</td>
                  <td>{formatDateTime(trade.closedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Closed demo trades and action history will appear here.</p>
      )}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={tone}>{value}</dd>
    </div>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul className="form-error-list">
      {errors.map((error) => (
        <li key={error}>{error}</li>
      ))}
    </ul>
  );
}

function applyLivePriceToCandles(
  candles: DemoTradeCandle[],
  price: number,
  timeframe: DemoTradeTimeframe,
  timestamp = Date.now()
): DemoTradeCandle[] {
  if (!candles.length || !Number.isFinite(price) || price <= 0) return candles;

  const nextCandles = [...candles];
  const latest = nextCandles[nextCandles.length - 1];
  const bucketStart = getCandleBucketStart(timestamp, timeframe);

  if (bucketStart > latest.timestamp) {
    nextCandles.push({
      timestamp: bucketStart,
      open: latest.close,
      high: Math.max(latest.close, price),
      low: Math.min(latest.close, price),
      close: price,
      volume: 0
    });
    return nextCandles.slice(-240);
  }

  nextCandles[nextCandles.length - 1] = {
    ...latest,
    close: price,
    high: Math.max(latest.high, price),
    low: Math.min(latest.low, price)
  };
  return nextCandles;
}

function getCandleBucketStart(timestamp: number, timeframe: DemoTradeTimeframe): number {
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();

  if (timeframe === "1M") {
    const date = new Date(safeTimestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }

  if (timeframe === "1w") {
    const date = new Date(safeTimestamp);
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
  }

  const duration = demoTimeframeDurationMs[timeframe] ?? demoTimeframeDurationMs["1h"];
  return Math.floor(safeTimestamp / duration) * duration;
}

const demoTimeframeDurationMs: Record<Exclude<DemoTradeTimeframe, "1M" | "1w">, number> = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000
};

function buildCandleShape({
  openY,
  closeY,
  highY,
  lowY,
  minBodyHeight,
  minWickHeight,
  chartTop,
  chartBottom
}: {
  openY: number;
  closeY: number;
  highY: number;
  lowY: number;
  minBodyHeight: number;
  minWickHeight: number;
  chartTop: number;
  chartBottom: number;
}) {
  const rawBodyHeight = Math.abs(openY - closeY);
  const bodyHeight = Math.max(minBodyHeight, rawBodyHeight);
  const bodyCenter = (openY + closeY) / 2;
  const bodyY = clamp(bodyCenter - bodyHeight / 2, chartTop, chartBottom - bodyHeight);
  const renderedBodyCenter = bodyY + bodyHeight / 2;
  const wickY1 = clamp(
    Math.min(highY, lowY, bodyY, renderedBodyCenter - minWickHeight / 2),
    chartTop,
    chartBottom
  );
  const wickY2 = clamp(
    Math.max(highY, lowY, bodyY + bodyHeight, renderedBodyCenter + minWickHeight / 2),
    chartTop,
    chartBottom
  );

  return {
    bodyY,
    bodyHeight,
    wickY1,
    wickY2
  };
}

function getSvgPointer(event: PointerEvent<SVGSVGElement>, width: number, height: number) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * width,
    y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * height
  };
}

function buildOverlayLines(position: DemoOpenPosition | null, currentPrice: number | null) {
  const lines: Array<{ label: string; price: number; tone: string }> = [];
  if (currentPrice) lines.push({ label: "Mark", price: currentPrice, tone: "mark" });
  if (!position) return lines;

  lines.push({ label: "Entry", price: position.entryPrice, tone: "entry" });
  if (position.stopLoss > 0) lines.push({ label: "SL", price: position.stopLoss, tone: "danger" });
  if (position.liquidationPrice) lines.push({ label: "Liq", price: position.liquidationPrice, tone: "liquidation" });
  position.takeProfits.forEach((takeProfit, index) => {
    lines.push({ label: `TP${index + 1}`, price: takeProfit.price, tone: takeProfit.isHit ? "hit" : "target" });
  });
  return lines;
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildSubmittedBracket(
  isBracketEnabled: boolean,
  stopLoss: string,
  takeProfits: TakeProfitDraft[]
) {
  if (!isBracketEnabled) {
    return {
      stopLoss: 0,
      takeProfits: []
    };
  }

  return {
    stopLoss: parseNumber(stopLoss),
    takeProfits: takeProfits.map((takeProfit) => ({
      id: takeProfit.id,
      price: parseNumber(takeProfit.price),
      closePercent: parseNumber(takeProfit.closePercent)
    }))
  };
}

function formatInputPrice(value: number): string {
  return value.toFixed(2);
}

function formatChartPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 1000 ? 1 : 2,
    maximumFractionDigits: value >= 1000 ? 1 : 2
  });
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

function formatUsdt(value: number): string {
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 2
  })} USDT`;
}

function formatAmountInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const digits = value >= 1 ? 2 : 4;
  const flooredValue = floorTo(value, digits);
  if (flooredValue <= 0) return "";
  if (flooredValue >= 100 && Number.isInteger(flooredValue)) return flooredValue.toFixed(0);
  return flooredValue.toFixed(digits);
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function defaultVisibleCandles(timeframe: DemoTradeTimeframe): number {
  if (timeframe === "1m") return 62;
  if (timeframe === "5m") return 74;
  if (timeframe === "1M") return 48;
  if (timeframe === "1w") return 72;
  if (timeframe === "1d") return 80;
  return 90;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function floorTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  const normalized = Number(value.toFixed(8));
  return Math.floor(normalized * factor) / factor;
}
