import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Download,
  LineChart,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  TrendingDown,
  TrendingUp
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  applyMarketPrice,
  calculateLiquidationPrice,
  calculateDemoTradeStats,
  closeOpenPosition,
  createInitialDemoTradeState,
  demoTradeCsvFilename,
  exportDemoTradesToCsv,
  openDemoPosition,
  resetDemoTradeState,
  updateDemoLeverage,
  updateDemoStopLoss,
  updateDemoTakeProfits,
  type DemoOpenPosition,
  type DemoTradeSide,
  type DemoTradeSizeMode,
  type DemoTradeState
} from "../lib/demoTradeMath";
import {
  demoTradeSymbols,
  demoTradeTimeframes,
  fetchDemoTradeCandles,
  fetchDemoTradeTicker,
  type DemoTradeCandle,
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

const emptyTakeProfits: TakeProfitDraft[] = [
  { id: "tp-1", price: "", closePercent: "50" },
  { id: "tp-2", price: "", closePercent: "50" }
];

export function DemoTrade() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [demoState, setDemoState] = useState<DemoTradeState>(() =>
    createInitialDemoTradeState({ sessionId: "guest-session" })
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [candles, setCandles] = useState<DemoTradeCandle[]>([]);
  const [timeframe, setTimeframe] = useState<DemoTradeTimeframe>("1h");
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [marketSource, setMarketSource] = useState("Binance.US public market data");
  const [marketError, setMarketError] = useState<string | null>(null);
  const [isMarketLoading, setIsMarketLoading] = useState(true);
  const [side, setSide] = useState<DemoTradeSide>("long");
  const [sizeMode, setSizeMode] = useState<DemoTradeSizeMode>("margin");
  const [amount, setAmount] = useState("100");
  const [leverage, setLeverage] = useState("5");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfits, setTakeProfits] = useState<TakeProfitDraft[]>(emptyTakeProfits);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [nextStartingBalance, setNextStartingBalance] = useState("1000");
  const [showResetModal, setShowResetModal] = useState(false);
  const [positionStopLoss, setPositionStopLoss] = useState("");
  const [positionLeverage, setPositionLeverage] = useState("5");
  const [positionTakeProfits, setPositionTakeProfits] = useState<TakeProfitDraft[]>([]);
  const [positionErrors, setPositionErrors] = useState<string[]>([]);

  const stats = useMemo(() => calculateDemoTradeStats(demoState), [demoState]);
  const equityTone = stats.equity >= demoState.startingBalance ? "positive" : "negative";
  const activeSymbol = demoTradeSymbols[0];

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

    setSaveState("saving");
    const saveTimer = window.setTimeout(() => {
      const save = user
        ? saveRegisteredDemoTradeState(user.id, demoState)
        : Promise.resolve(saveGuestDemoTradeState(demoState));

      save
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 450);

    return () => window.clearTimeout(saveTimer);
  }, [demoState, isHydrated, user]);

  const loadMarketData = useCallback(async () => {
    setMarketError(null);
    try {
      const [nextCandles, ticker] = await Promise.all([
        fetchDemoTradeCandles(activeSymbol.symbol, timeframe),
        fetchDemoTradeTicker(activeSymbol.symbol)
      ]);
      setCandles(nextCandles);
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
    const priceTimer = window.setInterval(() => {
      fetchDemoTradeTicker(activeSymbol.symbol)
        .then((ticker) => {
          setCurrentPrice(ticker.price);
          setMarketSource(ticker.source);
          setDemoState((state) => applyMarketPrice(state, ticker.price));
        })
        .catch(() => setMarketError("Live BTC price update failed. Retrying..."));
    }, 8000);
    const candleTimer = window.setInterval(() => {
      fetchDemoTradeCandles(activeSymbol.symbol, timeframe)
        .then(setCandles)
        .catch(() => setMarketError("BTC candles could not be refreshed."));
    }, 30000);

    return () => {
      window.clearInterval(priceTimer);
      window.clearInterval(candleTimer);
    };
  }, [activeSymbol.symbol, loadMarketData, timeframe]);

  useEffect(() => {
    if (!currentPrice || stopLoss) return;
    const defaultStop = side === "long" ? currentPrice * 0.98 : currentPrice * 1.02;
    const defaultTp1 = side === "long" ? currentPrice * 1.02 : currentPrice * 0.98;
    const defaultTp2 = side === "long" ? currentPrice * 1.04 : currentPrice * 0.96;
    setStopLoss(formatInputPrice(defaultStop));
    setTakeProfits([
      { id: "tp-1", price: formatInputPrice(defaultTp1), closePercent: "50" },
      { id: "tp-2", price: formatInputPrice(defaultTp2), closePercent: "50" }
    ]);
  }, [currentPrice, side, stopLoss]);

  useEffect(() => {
    const position = demoState.openPosition;
    if (!position) {
      setPositionTakeProfits([]);
      setPositionStopLoss("");
      return;
    }

    setPositionStopLoss(String(position.stopLoss));
    setPositionLeverage(String(position.leverage));
    setPositionTakeProfits(
      position.takeProfits.map((takeProfit) => ({
        id: takeProfit.id,
        price: String(takeProfit.price),
        closePercent: String(takeProfit.closePercent)
      }))
    );
  }, [demoState.openPosition?.tradeId]);

  const openTrade = () => {
    const entryPrice = currentPrice ?? candles[candles.length - 1]?.close ?? 0;
    const result = openDemoPosition(demoState, {
      userId: user?.id ?? null,
      sessionId: demoState.sessionId,
      symbol: activeSymbol.symbol,
      side,
      sizeMode,
      amount: parseNumber(amount),
      leverage: parseNumber(leverage),
      entryPrice,
      stopLoss: parseNumber(stopLoss),
      takeProfits: takeProfits.map((takeProfit) => ({
        id: takeProfit.id,
        price: parseNumber(takeProfit.price),
        closePercent: parseNumber(takeProfit.closePercent)
      }))
    });

    if (!result.ok) {
      setFormErrors(result.errors);
      return;
    }

    setFormErrors([]);
    setDemoState(result.state);
  };

  const updateStop = () => {
    const result = updateDemoStopLoss(demoState, parseNumber(positionStopLoss));
    if (!result.ok) {
      setPositionErrors(result.errors);
      return;
    }
    setPositionErrors([]);
    setDemoState(result.state);
  };

  const updateLeverage = () => {
    const result = updateDemoLeverage(demoState, parseNumber(positionLeverage));
    if (!result.ok) {
      setPositionErrors(result.errors);
      return;
    }
    setPositionErrors([]);
    setDemoState(result.state);
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
    setDemoState(result.state);
  };

  const closePosition = () => {
    if (!demoState.openPosition || !currentPrice) return;
    setDemoState(closeOpenPosition(demoState, currentPrice));
  };

  const requestBalanceReset = () => {
    const hasProgress = Boolean(demoState.openPosition) || demoState.tradeHistory.length > 0 || demoState.currentBalance !== demoState.startingBalance;
    if (hasProgress) {
      setShowResetModal(true);
      return;
    }
    setDemoState(resetDemoTradeState(demoState, parseNumber(nextStartingBalance)));
  };

  const confirmBalanceReset = () => {
    setDemoState(resetDemoTradeState(demoState, parseNumber(nextStartingBalance)));
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
        <div className="demo-title-actions">
          <button className="ghost-button compact" type="button" onClick={() => void loadMarketData()}>
            <RefreshCw size={16} />
            Refresh BTC
          </button>
          <button className="primary-button compact" type="button" onClick={exportCsv}>
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </section>

      {!user && (
        <section className="notice-box demo-save-note">
          Create an account to save your demo trading progress permanently. Guest progress is kept only for this browser session.
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
          <span>Data / Save</span>
          <strong>{saveState === "saving" ? "Saving..." : saveState === "error" ? "Save retry needed" : "Ready"}</strong>
          <small>{marketSource}</small>
        </div>
      </section>

      {marketError && <p className="warning-box">{marketError}</p>}

      <section className="demo-trade-grid">
        <article className="section-panel demo-chart-panel">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Custom chart</p>
              <h2>BTC/USDT practice chart</h2>
            </div>
            <span className="status-pill premium">Simulated</span>
          </div>
          <DemoTradeChart
            candles={candles}
            currentPrice={currentPrice}
            position={demoState.openPosition}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
          />
        </article>

        <aside className="section-panel demo-ticket-panel">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Trade ticket</p>
              <h2>{demoState.openPosition ? "Manage position" : "Open demo trade"}</h2>
            </div>
          </div>

          {demoState.openPosition ? (
            <PositionManager
              position={demoState.openPosition}
              stopLoss={positionStopLoss}
              leverage={positionLeverage}
              takeProfits={positionTakeProfits}
              errors={positionErrors}
              onStopLossChange={setPositionStopLoss}
              onLeverageChange={setPositionLeverage}
              onTakeProfitsChange={setPositionTakeProfits}
              onUpdateStop={updateStop}
              onUpdateLeverage={updateLeverage}
              onUpdateTakeProfits={updateTps}
              onClose={closePosition}
            />
          ) : (
            <TradeEntryForm
              side={side}
              sizeMode={sizeMode}
              amount={amount}
              leverage={leverage}
              stopLoss={stopLoss}
              takeProfits={takeProfits}
              currentPrice={currentPrice}
              errors={formErrors}
              onSideChange={setSide}
              onSizeModeChange={setSizeMode}
              onAmountChange={setAmount}
              onLeverageChange={setLeverage}
              onStopLossChange={setStopLoss}
              onTakeProfitsChange={setTakeProfits}
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

      <OpenPositionPanel position={demoState.openPosition} />
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
  side,
  sizeMode,
  amount,
  leverage,
  stopLoss,
  takeProfits,
  currentPrice,
  errors,
  onSideChange,
  onSizeModeChange,
  onAmountChange,
  onLeverageChange,
  onStopLossChange,
  onTakeProfitsChange,
  onOpen
}: {
  side: DemoTradeSide;
  sizeMode: DemoTradeSizeMode;
  amount: string;
  leverage: string;
  stopLoss: string;
  takeProfits: TakeProfitDraft[];
  currentPrice: number | null;
  errors: string[];
  onSideChange: (side: DemoTradeSide) => void;
  onSizeModeChange: (mode: DemoTradeSizeMode) => void;
  onAmountChange: (value: string) => void;
  onLeverageChange: (value: string) => void;
  onStopLossChange: (value: string) => void;
  onTakeProfitsChange: (items: TakeProfitDraft[]) => void;
  onOpen: () => void;
}) {
  const notional = sizeMode === "margin" ? parseNumber(amount) * parseNumber(leverage) : parseNumber(amount);
  const margin = sizeMode === "margin" ? parseNumber(amount) : notional / Math.max(1, parseNumber(leverage));
  const quantity = currentPrice && currentPrice > 0 ? notional / currentPrice : 0;
  const estimatedLiquidation = currentPrice
    ? calculateLiquidationPrice({
        side,
        avgEntryPrice: currentPrice,
        quantityRemaining: quantity,
        isolatedMarginRemaining: margin
      })
    : null;

  return (
    <div className="demo-ticket-stack futures-ticket">
      <div className="futures-ticket-header">
        <div>
          <span>BTCUSDT Perpetual</span>
          <strong>Isolated · Market</strong>
        </div>
        <span className="futures-leverage-badge">{parseNumber(leverage) || 1}x</span>
      </div>

      <div className="demo-side-toggle" aria-label="Choose trade direction">
        <button className={side === "long" ? "long active" : "long"} type="button" onClick={() => onSideChange("long")}>
          <TrendingUp size={16} />
          Buy / Long
        </button>
        <button className={side === "short" ? "short active" : "short"} type="button" onClick={() => onSideChange("short")}>
          <TrendingDown size={16} />
          Sell / Short
        </button>
      </div>

      <div className="futures-size-toggle" aria-label="Choose size input mode">
        <button className={sizeMode === "margin" ? "active" : ""} type="button" onClick={() => onSizeModeChange("margin")}>
          Margin
        </button>
        <button className={sizeMode === "notional" ? "active" : ""} type="button" onClick={() => onSizeModeChange("notional")}>
          Position Size
        </button>
      </div>

      <div className="futures-ticket-grid">
        <label>
          Entry Price
          <input value={currentPrice ? formatInputPrice(currentPrice) : ""} disabled />
        </label>

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

        <label>
          {sizeMode === "margin" ? "Margin USDT" : "Position USDT"}
          <input type="number" min="0" step="1" value={amount} onChange={(event) => onAmountChange(event.target.value)} />
        </label>

        <label>
          Stop Loss
          <input type="number" min="0" step="0.01" value={stopLoss} onChange={(event) => onStopLossChange(event.target.value)} />
        </label>
      </div>

      <TakeProfitEditor takeProfits={takeProfits} onChange={onTakeProfitsChange} />

      <dl className="demo-estimate-grid futures-estimate-grid">
        <div>
          <dt>Notional</dt>
          <dd>{formatCurrency(notional)}</dd>
        </div>
        <div>
          <dt>Margin</dt>
          <dd>{formatCurrency(margin)}</dd>
        </div>
        <div>
          <dt>Qty</dt>
          <dd>{quantity > 0 ? `${quantity.toFixed(6)} BTC` : "N/A"}</dd>
        </div>
        <div>
          <dt>Est. Liq</dt>
          <dd>{estimatedLiquidation ? formatCurrency(estimatedLiquidation) : "N/A"}</dd>
        </div>
      </dl>

      <ErrorList errors={errors} />
      <button className={side === "long" ? "primary-button futures-submit long" : "primary-button futures-submit short"} type="button" onClick={onOpen} disabled={!currentPrice}>
        {side === "long" ? "Open Long" : "Open Short"}
      </button>
    </div>
  );
}

function PositionManager({
  position,
  stopLoss,
  leverage,
  takeProfits,
  errors,
  onStopLossChange,
  onLeverageChange,
  onTakeProfitsChange,
  onUpdateStop,
  onUpdateLeverage,
  onUpdateTakeProfits,
  onClose
}: {
  position: DemoOpenPosition;
  stopLoss: string;
  leverage: string;
  takeProfits: TakeProfitDraft[];
  errors: string[];
  onStopLossChange: (value: string) => void;
  onLeverageChange: (value: string) => void;
  onTakeProfitsChange: (items: TakeProfitDraft[]) => void;
  onUpdateStop: () => void;
  onUpdateLeverage: () => void;
  onUpdateTakeProfits: () => void;
  onClose: () => void;
}) {
  return (
    <div className="demo-ticket-stack">
      <dl className="demo-position-metrics">
        <Metric label="Side" value={position.side.toUpperCase()} tone={position.side === "long" ? "positive" : "negative"} />
        <Metric label="Entry Price" value={formatCurrency(position.entryPrice)} />
        <Metric label="Mark Price" value={formatCurrency(position.markPrice)} />
        <Metric label="Remaining Qty" value={`${position.remainingQuantity.toFixed(6)} BTC`} />
        <Metric label="Remaining Margin" value={formatCurrency(position.remainingMargin)} />
        <Metric label="Liquidation Price" value={position.liquidationPrice ? formatCurrency(position.liquidationPrice) : "N/A"} />
        <Metric
          label="Unrealized PnL"
          value={formatCurrency(position.unrealizedPnl)}
          tone={position.unrealizedPnl >= 0 ? "positive" : "negative"}
        />
      </dl>

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

      <ErrorList errors={errors} />
      <button className="primary-button danger-button" type="button" onClick={onClose}>
        Manual Close at Market
      </button>
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
  const dragStartRef = useRef<{ x: number; offset: number; pointerId: number } | null>(null);
  const maxOffset = Math.max(0, candles.length - visibleCount);
  const safeOffset = Math.min(offset, maxOffset);
  const end = Math.max(0, candles.length - safeOffset);
  const visibleCandles = candles.slice(Math.max(0, end - visibleCount), end);
  const overlayLines = buildOverlayLines(position, currentPrice);
  const prices = visibleCandles.flatMap((candle) => [candle.high, candle.low]).concat(overlayLines.map((line) => line.price));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 1;
  const range = Math.max(maxPrice - minPrice, 1);
  const paddedMin = minPrice - range * 0.12;
  const paddedMax = maxPrice + range * 0.12;
  const width = 980;
  const height = 460;
  const padding = { top: 24, right: 118, bottom: 34, left: 22 };
  const axisX = width - padding.right;
  const chartWidth = axisX - padding.left;
  const chartHeight = height - padding.top - padding.bottom;
  const candleGap = chartWidth / Math.max(visibleCandles.length, 1);
  const candleWidth = clamp(candleGap * 0.64, 5, 16);
  const yForPrice = (price: number) => padding.top + ((paddedMax - price) / (paddedMax - paddedMin)) * chartHeight;
  const priceTicks = Array.from({ length: 8 }, (_, index) => paddedMax - ((paddedMax - paddedMin) / 7) * index);
  const verticalGridCount = Math.min(10, Math.max(4, Math.floor(visibleCandles.length / 10)));

  useEffect(() => {
    setVisibleCount(defaultVisibleCandles(timeframe));
    setOffset(0);
  }, [timeframe]);

  useEffect(() => {
    setOffset((value) => Math.min(value, Math.max(0, candles.length - visibleCount)));
  }, [candles.length, visibleCount]);

  const panBy = (amount: number) => {
    setOffset((value) => clamp(value + amount, 0, Math.max(0, candles.length - visibleCount)));
  };

  const zoomBy = (amount: number) => {
    setVisibleCount((count) => clamp(count + amount, 28, Math.min(160, Math.max(candles.length, 40))));
  };

  const startRightDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = { x: event.clientX, offset: safeOffset, pointerId: event.pointerId };
    setIsRightDragging(true);
  };

  const moveRightDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragStartRef.current) return;
    event.preventDefault();
    const deltaCandles = Math.round((dragStartRef.current.x - event.clientX) / Math.max(6, candleGap * 0.55));
    setOffset(clamp(dragStartRef.current.offset + deltaCandles, 0, Math.max(0, candles.length - visibleCount)));
  };

  const stopRightDrag = (event?: PointerEvent<SVGSVGElement>) => {
    if (event && dragStartRef.current && event.currentTarget.hasPointerCapture(dragStartRef.current.pointerId)) {
      event.currentTarget.releasePointerCapture(dragStartRef.current.pointerId);
    }
    dragStartRef.current = null;
    setIsRightDragging(false);
  };

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
          <button className="icon-button chart-control-button" type="button" onClick={() => panBy(12)} title="Move left">
            <ArrowLeft size={16} />
            <span className="sr-only">Move chart left</span>
          </button>
          <button className="icon-button chart-control-button" type="button" onClick={() => panBy(-12)} title="Move right">
            <ArrowRight size={16} />
            <span className="sr-only">Move chart right</span>
          </button>
        </div>
      </div>

      {visibleCandles.length ? (
        <svg
          className={isRightDragging ? "demo-trade-chart dragging" : "demo-trade-chart"}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Custom BTC USDT demo trading chart"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={startRightDrag}
          onPointerMove={moveRightDrag}
          onPointerUp={stopRightDrag}
          onPointerCancel={stopRightDrag}
          onPointerLeave={stopRightDrag}
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
              const isUp = candle.close >= candle.open;
              const bodyHeight = Math.max(3, Math.abs(openY - closeY));
              return (
                <g className={isUp ? "candle up" : "candle down"} key={`${candle.timestamp}-${index}`}>
                  <line className="candle-wick" x1={x} x2={x} y1={highY} y2={lowY} />
                  <rect
                    className="candle-body"
                    x={x - candleWidth / 2}
                    y={Math.min(openY, closeY) - (bodyHeight === 3 ? 1.5 : 0)}
                    width={candleWidth}
                    height={bodyHeight}
                    rx="1.5"
                  />
                </g>
              );
            })}
          </g>
          {overlayLines.map((line) => {
            const y = yForPrice(line.price);
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

function OpenPositionPanel({ position }: { position: DemoOpenPosition | null }) {
  return (
    <section className="section-panel open-position-panel">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Open position</p>
          <h2>{position ? `${position.side.toUpperCase()} BTC/USDT` : "No open demo position"}</h2>
        </div>
      </div>
      {position ? (
        <dl className="signal-level-grid">
          <Metric label="Entry Price" value={formatCurrency(position.entryPrice)} />
          <Metric label="Mark Price" value={formatCurrency(position.markPrice)} />
          <Metric label="Initial Margin" value={formatCurrency(position.initialMargin)} />
          <Metric label="Remaining Margin" value={formatCurrency(position.remainingMargin)} />
          <Metric label="Leverage" value={`${position.leverage}x`} />
          <Metric label="Stop Loss" value={formatCurrency(position.stopLoss)} />
          <Metric label="Liquidation" value={position.liquidationPrice ? formatCurrency(position.liquidationPrice) : "N/A"} />
          <Metric label="Status" value={position.status} />
        </dl>
      ) : (
        <p className="muted">Open a virtual BTC trade to see entry, SL, TP, liquidation, and PnL details here.</p>
      )}
    </section>
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

function buildOverlayLines(position: DemoOpenPosition | null, currentPrice: number | null) {
  const lines: Array<{ label: string; price: number; tone: string }> = [];
  if (currentPrice) lines.push({ label: "Mark", price: currentPrice, tone: "mark" });
  if (!position) return lines;

  lines.push({ label: "Entry", price: position.entryPrice, tone: "entry" });
  lines.push({ label: "SL", price: position.stopLoss, tone: "danger" });
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function defaultVisibleCandles(timeframe: DemoTradeTimeframe): number {
  if (timeframe === "1w") return 72;
  if (timeframe === "1d") return 80;
  return 90;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
