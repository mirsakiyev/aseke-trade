import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  LockKeyhole,
  Route,
  ShieldAlert,
  Sparkles,
  Target,
  Trophy,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  calculateRouteResult,
  createFallbackTradeRoutePuzzle,
  generateTradeRoutePuzzle,
  isSameSelection,
  scoreTradeRoute,
  tradeRouteAssets,
  type Asset,
  type Market,
  type OptimalRoute,
  type RouteResult,
  type TradeRoutePuzzle,
  type TransferRoute,
  type UserSelection
} from "../lib/tradeRouteOptimizer";

type TradeRouteOptimizerProps = {
  userId?: string | null;
};

type PartialSelection = Partial<UserSelection>;

type CompletedRoute = {
  puzzleId: string;
  seed: string;
  selection: UserSelection;
  result: RouteResult;
  optimalRoute: OptimalRoute;
  score: number;
  completedAt: string;
};

const storagePrefix = "aseke-trade-route-optimizer";

export function TradeRouteOptimizer({ userId }: TradeRouteOptimizerProps) {
  const [selection, setSelection] = useState<PartialSelection>({});
  const [completion, setCompletion] = useState<CompletedRoute | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const puzzleState = useMemo(() => {
    try {
      return {
        puzzle: generateTradeRoutePuzzle(new Date(), userId),
        usingFallback: false
      };
    } catch {
      return {
        puzzle: createFallbackTradeRoutePuzzle(new Date(), userId),
        usingFallback: true
      };
    }
  }, [userId]);

  const { puzzle, usingFallback } = puzzleState;
  const storageKey = `${storagePrefix}-${puzzle.seed}`;
  const completeSelection = getCompleteSelection(selection);
  const previewResult = useMemo(
    () => (completeSelection ? calculateRouteResult(puzzle, completeSelection) : null),
    [completeSelection, puzzle]
  );

  useEffect(() => {
    const storedCompletion = readStoredCompletion(storageKey, puzzle);
    setCompletion(storedCompletion);
    setSelection(storedCompletion?.selection ?? {});
    setNotice(usingFallback ? "Using safe simulated fallback values for today's puzzle." : null);
  }, [puzzle, storageKey, usingFallback]);

  const chooseAsset = (asset: Asset) => {
    if (completion) return;
    setSelection((current) => ({ ...current, asset }));
  };

  const chooseBuyMarket = (marketId: string) => {
    if (completion) return;
    setSelection((current) => ({
      ...current,
      buyMarketId: marketId,
      sellMarketId: current.sellMarketId === marketId ? undefined : current.sellMarketId
    }));
  };

  const chooseSellMarket = (marketId: string) => {
    if (completion) return;
    setSelection((current) => ({
      ...current,
      buyMarketId: current.buyMarketId === marketId ? undefined : current.buyMarketId,
      sellMarketId: marketId
    }));
  };

  const chooseRoute = (routeId: string) => {
    if (completion) return;
    setSelection((current) => ({ ...current, routeId }));
  };

  const submitRoute = () => {
    if (!completeSelection || !previewResult || completion) return;

    const score = scoreTradeRoute(completeSelection, previewResult, puzzle.optimalRoute);
    const nextCompletion: CompletedRoute = {
      puzzleId: puzzle.puzzleId,
      seed: puzzle.seed,
      selection: completeSelection,
      result: previewResult,
      optimalRoute: puzzle.optimalRoute,
      score,
      completedAt: new Date().toISOString()
    };

    setCompletion(nextCompletion);
    setNotice(null);

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextCompletion));
    } catch {
      setNotice("This route is saved for this session, but this browser blocked local storage.");
    }
  };

  return (
    <>
      <section className="page-title-row puzzle-title-row trade-optimizer-title-row">
        <div>
          <p className="eyebrow">Puzzle</p>
          <div className="trade-title-line">
            <h1>Trade Route Optimizer</h1>
            <span className={completion ? "status-pill free" : "status-pill premium"}>
              <Sparkles size={15} />
              {completion ? "Completed today" : "Daily Puzzle"}
            </span>
          </div>
          <p className="muted">
            Buy low, move smart, sell high. Fees can turn a winning route into a losing one.
          </p>
          <p className="trade-sim-note">Simulated educational puzzle. Not financial advice.</p>
        </div>
        <span className="quiz-title-mark" aria-hidden="true">
          <Route size={34} />
        </span>
      </section>

      {notice && <p className="soft-notice">{notice}</p>}

      <section className="trade-optimizer-grid">
        <article className="section-panel trade-balance-panel">
          <span className="feature-icon">
            <WalletCards size={22} />
          </span>
          <div>
            <p className="eyebrow">Starting Balance</p>
            <h2>{formatUSDT(puzzle.startingBalance)}</h2>
            <p>Goal: Finish with the most USDT after fees, slippage, and network costs.</p>
          </div>
          <div className="trade-daily-meta">
            <span>Daily setup</span>
            <strong>{formatDateKey(puzzle.dateKey)}</strong>
          </div>
        </article>

        <article className="section-panel trade-selection-panel">
          <div className="lesson-title-line">
            <div>
              <p className="eyebrow">Build Your Route</p>
              <h2>Pick the most profitable path</h2>
            </div>
            {completion && (
              <span className="status-pill free">
                <LockKeyhole size={15} />
                Locked in
              </span>
            )}
          </div>

          <SelectionGroup title="Choose Asset" description="Pick the asset with the best price spread.">
            <div className="trade-asset-grid" role="group" aria-label="Choose asset">
              {tradeRouteAssets.map((asset) => (
                <button
                  className={asset === selection.asset ? "trade-option-card selected" : "trade-option-card"}
                  type="button"
                  key={asset}
                  aria-pressed={asset === selection.asset}
                  disabled={Boolean(completion)}
                  onClick={() => chooseAsset(asset)}
                >
                  <strong>{asset}</strong>
                  <span>{assetDescriptions[asset]}</span>
                  {asset === selection.asset && <SelectionState />}
                </button>
              ))}
            </div>
          </SelectionGroup>

          <SelectionGroup title="Buy From" description="Lower buy prices and lower fees help your entry.">
            <MarketChoiceGrid
              markets={puzzle.markets}
              selectedMarketId={selection.buyMarketId}
              blockedMarketId={selection.sellMarketId}
              disabled={Boolean(completion)}
              actionLabel="Buy from"
              blockedLabel="Selected sell market"
              onChoose={chooseBuyMarket}
            />
          </SelectionGroup>

          <SelectionGroup title="Transfer Route" description="Network cost and slippage can erase a spread.">
            <div className="trade-route-grid" role="group" aria-label="Choose transfer route">
              {puzzle.routes.map((route) => (
                <button
                  className={route.id === selection.routeId ? "trade-option-card route-card selected" : "trade-option-card route-card"}
                  type="button"
                  key={route.id}
                  aria-pressed={route.id === selection.routeId}
                  disabled={Boolean(completion)}
                  onClick={() => chooseRoute(route.id)}
                >
                  <span className={`trade-risk-badge ${route.riskLabel.toLowerCase()}`}>{route.riskLabel} risk</span>
                  <strong>{route.name}</strong>
                  <span>{formatUSDT(route.networkFeeUSDT)} network fee</span>
                  <span>{formatPercent(route.slippagePercent)} slippage</span>
                  <small>{route.delayLabel} delay</small>
                  {route.id === selection.routeId && <SelectionState />}
                </button>
              ))}
            </div>
          </SelectionGroup>

          <SelectionGroup title="Sell At" description="Higher sell prices matter after fees and slippage.">
            <MarketChoiceGrid
              markets={puzzle.markets}
              selectedMarketId={selection.sellMarketId}
              blockedMarketId={selection.buyMarketId}
              disabled={Boolean(completion)}
              actionLabel="Sell at"
              blockedLabel="Selected buy market"
              onChoose={chooseSellMarket}
            />
          </SelectionGroup>
        </article>

        <aside className="section-panel trade-preview-panel" aria-live="polite">
          <PreviewPanel
            puzzle={puzzle}
            selection={selection}
            result={previewResult}
            completion={completion}
            onSubmit={submitRoute}
          />
        </aside>
      </section>

      <section className="section-panel trade-market-panel">
        <div className="lesson-title-line">
          <div>
            <p className="eyebrow">Market Board</p>
            <h2>Simulated prices</h2>
          </div>
          <span className="status-pill">Fictional markets</span>
        </div>
        <div className="trade-market-board">
          {puzzle.markets.map((market) => (
            <article className="trade-market-tile" key={market.id}>
              <header>
                <h3>{market.name}</h3>
                <span>{formatPercent(market.tradingFeePercent)} fee</span>
              </header>
              <div className="trade-price-grid">
                {tradeRouteAssets.map((asset) => (
                  <div className="trade-price-row" key={asset}>
                    <strong>{asset}</strong>
                    <span>Buy {formatPrice(asset, market.prices[asset].buy)}</span>
                    <span>Sell {formatPrice(asset, market.prices[asset].sell)}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      {completion && <ResultPanel puzzle={puzzle} completion={completion} />}
    </>
  );
}

function SelectionGroup({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="trade-selection-group">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

function MarketChoiceGrid({
  markets,
  selectedMarketId,
  blockedMarketId,
  disabled,
  actionLabel,
  blockedLabel,
  onChoose
}: {
  markets: Market[];
  selectedMarketId?: string;
  blockedMarketId?: string;
  disabled: boolean;
  actionLabel: string;
  blockedLabel: string;
  onChoose: (marketId: string) => void;
}) {
  return (
    <div className="trade-market-choice-grid" role="group" aria-label={actionLabel}>
      {markets.map((market) => {
        const isSelected = selectedMarketId === market.id;
        const isBlocked = blockedMarketId === market.id && !isSelected;

        return (
          <button
            className={["trade-option-card", isSelected ? "selected" : "", isBlocked ? "blocked" : ""]
              .filter(Boolean)
              .join(" ")}
            type="button"
            key={market.id}
            aria-pressed={isSelected}
            disabled={disabled || isBlocked}
            onClick={() => onChoose(market.id)}
          >
            <strong>{market.name}</strong>
            <span>{formatPercent(market.tradingFeePercent)} trading fee</span>
            {isSelected && <SelectionState />}
            {isBlocked && <span className="trade-option-note">{blockedLabel}</span>}
          </button>
        );
      })}
    </div>
  );
}

function PreviewPanel({
  puzzle,
  selection,
  result,
  completion,
  onSubmit
}: {
  puzzle: TradeRoutePuzzle;
  selection: PartialSelection;
  result: RouteResult | null;
  completion: CompletedRoute | null;
  onSubmit: () => void;
}) {
  const completeSelection = getCompleteSelection(selection);
  const activeSelection = completion?.selection ?? completeSelection;
  const activeResult = completion?.result ?? result;
  const missingSelection = !completeSelection && !completion;

  return (
    <>
      <div className="trade-preview-heading">
        <span className="feature-icon compact-icon">
          <Target size={20} />
        </span>
        <div>
          <p className="eyebrow">Live Estimate</p>
          <h2>{completion ? "Route locked" : "Preview route"}</h2>
        </div>
      </div>

      {missingSelection && (
        <div className="trade-preview-empty">
          <CircleDollarSign size={24} aria-hidden="true" />
          <p>Choose an asset, buy market, transfer route, and sell market to estimate the route.</p>
        </div>
      )}

      {activeSelection && activeResult && (
        <>
          <RoutePath puzzle={puzzle} selection={activeSelection} />
          <dl className="trade-preview-metrics">
            <Metric label="Asset quantity" value={formatQuantity(activeSelection.asset, activeResult.assetQuantity)} />
            <Metric label="Estimated fees" value={formatUSDT(activeResult.totalFees)} />
            <Metric label="Final USDT" value={formatUSDT(activeResult.finalUSDT)} strong />
            <Metric
              label="Estimated P/L"
              value={formatSignedUSDT(activeResult.profit)}
              tone={activeResult.profit >= 0 ? "positive" : "negative"}
            />
          </dl>
        </>
      )}

      <button
        className="primary-button full-width"
        type="button"
        disabled={!completeSelection || !result || Boolean(completion)}
        onClick={onSubmit}
      >
        {completion ? "Route locked" : "Lock In Route"}
        <CheckCircle2 size={18} />
      </button>
    </>
  );
}

function ResultPanel({ puzzle, completion }: { puzzle: TradeRoutePuzzle; completion: CompletedRoute }) {
  const explanation = buildRouteExplanation(puzzle, completion);
  const isOptimal = isSameSelection(completion.selection, completion.optimalRoute.selection);

  return (
    <section className="section-panel trade-result-panel">
      <div className="lesson-title-line">
        <div>
          <p className="eyebrow">Result</p>
          <h2>{isOptimal ? "Best route found" : "Best route revealed"}</h2>
        </div>
        <span className={isOptimal ? "status-pill free trade-score-pill" : "status-pill premium trade-score-pill"}>
          <Trophy size={15} />
          Score: {completion.score}/100
        </span>
      </div>

      <div className="trade-result-grid">
        <RouteSummaryCard
          title="Your Route"
          puzzle={puzzle}
          selection={completion.selection}
          result={completion.result}
          badge={isOptimal ? "Optimal pick" : "Submitted"}
        />
        <RouteSummaryCard
          title="Optimal Route"
          puzzle={puzzle}
          selection={completion.optimalRoute.selection}
          result={completion.optimalRoute.result}
          badge="Best Route"
        />
      </div>

      <div className={isOptimal ? "quiz-explanation correct" : "quiz-explanation"}>
        <strong>
          {isOptimal ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
          Route breakdown
        </strong>
        <p>{explanation}</p>
      </div>
    </section>
  );
}

function RouteSummaryCard({
  title,
  puzzle,
  selection,
  result,
  badge
}: {
  title: string;
  puzzle: TradeRoutePuzzle;
  selection: UserSelection;
  result: RouteResult;
  badge: string;
}) {
  return (
    <article className="trade-route-summary">
      <header>
        <h3>{title}</h3>
        <span className="status-pill">{badge}</span>
      </header>
      <RoutePath puzzle={puzzle} selection={selection} />
      <dl className="trade-preview-metrics compact">
        <Metric label="Final USDT" value={formatUSDT(result.finalUSDT)} strong />
        <Metric
          label="Profit/Loss"
          value={formatSignedUSDT(result.profit)}
          tone={result.profit >= 0 ? "positive" : "negative"}
        />
        <Metric label="Fees + slippage" value={formatUSDT(result.totalFees)} />
      </dl>
    </article>
  );
}

function RoutePath({ puzzle, selection }: { puzzle: TradeRoutePuzzle; selection: UserSelection }) {
  const buyMarket = getMarket(puzzle, selection.buyMarketId);
  const sellMarket = getMarket(puzzle, selection.sellMarketId);
  const route = getRoute(puzzle, selection.routeId);

  return (
    <div className="trade-route-path" aria-label="Selected route path">
      <span>
        <small>Buy</small>
        {buyMarket?.name ?? "Unknown"}
      </span>
      <ArrowRight size={16} aria-hidden="true" />
      <span>
        <small>{selection.asset}</small>
        {route?.name ?? "Unknown"}
      </span>
      <ArrowRight size={16} aria-hidden="true" />
      <span>
        <small>Sell</small>
        {sellMarket?.name ?? "Unknown"}
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  strong,
  tone
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "positive" | "negative";
}) {
  return (
    <div className={["trade-metric-row", strong ? "strong" : "", tone ?? ""].filter(Boolean).join(" ")}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SelectionState() {
  return (
    <span className="trade-selected-state">
      <CheckCircle2 size={15} />
      Selected
    </span>
  );
}

function getCompleteSelection(selection: PartialSelection): UserSelection | null {
  if (!selection.asset || !selection.buyMarketId || !selection.sellMarketId || !selection.routeId) {
    return null;
  }

  if (selection.buyMarketId === selection.sellMarketId) {
    return null;
  }

  return {
    asset: selection.asset,
    buyMarketId: selection.buyMarketId,
    sellMarketId: selection.sellMarketId,
    routeId: selection.routeId
  };
}

function readStoredCompletion(storageKey: string, puzzle: TradeRoutePuzzle): CompletedRoute | null {
  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (!storedValue) return null;

    const parsed = JSON.parse(storedValue) as Partial<CompletedRoute>;
    if (parsed.puzzleId !== puzzle.puzzleId || !isStoredSelection(parsed.selection, puzzle)) {
      return null;
    }

    const result = calculateRouteResult(puzzle, parsed.selection);
    if (!result) return null;

    return {
      puzzleId: puzzle.puzzleId,
      seed: puzzle.seed,
      selection: parsed.selection,
      result,
      optimalRoute: puzzle.optimalRoute,
      score: scoreTradeRoute(parsed.selection, result, puzzle.optimalRoute),
      completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function isStoredSelection(value: unknown, puzzle: TradeRoutePuzzle): value is UserSelection {
  if (!value || typeof value !== "object") return false;

  const selection = value as Partial<UserSelection>;

  return (
    typeof selection.asset === "string" &&
    tradeRouteAssets.includes(selection.asset as Asset) &&
    typeof selection.buyMarketId === "string" &&
    typeof selection.sellMarketId === "string" &&
    typeof selection.routeId === "string" &&
    selection.buyMarketId !== selection.sellMarketId &&
    puzzle.markets.some((market) => market.id === selection.buyMarketId) &&
    puzzle.markets.some((market) => market.id === selection.sellMarketId) &&
    puzzle.routes.some((route) => route.id === selection.routeId)
  );
}

function buildRouteExplanation(puzzle: TradeRoutePuzzle, completion: CompletedRoute): string {
  const user = completion.selection;
  const optimal = completion.optimalRoute.selection;
  const userRoute = getRoute(puzzle, user.routeId);
  const optimalRoute = getRoute(puzzle, optimal.routeId);
  const userBuyMarket = getMarket(puzzle, user.buyMarketId);
  const optimalBuyMarket = getMarket(puzzle, optimal.buyMarketId);
  const userSellMarket = getMarket(puzzle, user.sellMarketId);
  const optimalSellMarket = getMarket(puzzle, optimal.sellMarketId);
  const baseCopy = `You finished with ${formatUSDT(completion.result.finalUSDT)}. The optimal route finished with ${formatUSDT(
    completion.optimalRoute.result.finalUSDT
  )}.`;

  if (isSameSelection(user, optimal)) {
    return `${baseCopy} You matched the best asset, entry, transfer route, and exit market.`;
  }

  if (user.asset !== optimal.asset) {
    return `${baseCopy} The strongest simulated spread was on ${optimal.asset}, while your route used ${user.asset}.`;
  }

  if (userBuyMarket?.id !== optimalBuyMarket?.id) {
    return `${baseCopy} ${optimalBuyMarket?.name ?? "The optimal buy market"} had the better entry after fees than ${
      userBuyMarket?.name ?? "your buy market"
    }.`;
  }

  if (userSellMarket?.id !== optimalSellMarket?.id) {
    return `${baseCopy} ${optimalSellMarket?.name ?? "The optimal sell market"} paid more after exit fees than ${
      userSellMarket?.name ?? "your sell market"
    }.`;
  }

  if (userRoute?.id !== optimalRoute?.id) {
    return `${baseCopy} ${optimalRoute?.name ?? "The optimal transfer route"} kept more USDT after network cost and slippage than ${
      userRoute?.name ?? "your transfer route"
    }.`;
  }

  return `${baseCopy} The optimal route kept slightly more USDT after all costs were counted.`;
}

function getMarket(puzzle: TradeRoutePuzzle, marketId: string): Market | undefined {
  return puzzle.markets.find((market) => market.id === marketId);
}

function getRoute(puzzle: TradeRoutePuzzle, routeId: string): TransferRoute | undefined {
  return puzzle.routes.find((route) => route.id === routeId);
}

function formatDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatUSDT(value: number): string {
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)} USDT`;
}

function formatSignedUSDT(value: number): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${formatUSDT(Math.abs(value))}`;
}

function formatPrice(asset: Asset, value: number): string {
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: asset === "SOL" ? 3 : 2,
    maximumFractionDigits: asset === "SOL" ? 3 : 2
  }).format(value)} USDT`;
}

function formatQuantity(asset: Asset, value: number): string {
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6
  }).format(value)} ${asset}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

const assetDescriptions: Record<Asset, string> = {
  BTC: "High value, tighter quantities",
  ETH: "Mid-range route math",
  SOL: "Lower price, larger size"
};
