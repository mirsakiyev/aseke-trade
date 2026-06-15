import {
  Calculator,
  Crown,
  Headphones,
  LineChart,
  Plus,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  ShieldCheck,
  Trash2,
  Trophy,
  UserRound
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { LoadingState } from "../components/LoadingState";
import { UserBadgePill } from "../components/UserBadgePill";
import { useAuth } from "../contexts/AuthContext";
import { useAccountStatus } from "../hooks/useAccountStatus";
import { formatUsd } from "../lib/accountStatus";
import { resolvePublicAvatarUrl } from "../lib/avatarUrls";
import {
  calculateRisk,
  type PositionSizeMode,
  type RiskCalculatorResult,
  type RiskDirection,
  type RiskValueMode
} from "../lib/riskCalculator";
import {
  AML_CHECK_PRICE_CENTS,
  fetchTradingAcademyLeaderboard,
  fetchTradingSignals,
  fetchUserAmlCheckRequests,
  submitAmlCheck
} from "../lib/tradingAcademyApi";
import { leaderboardRankTone } from "../lib/tradingAcademyAccess";
import {
  TRADING_SIGNAL_FINAL_STATUSES,
  calculateSignalFinalRoi,
  formatPercent,
  formatSignalStatus,
  getSignalDisplayTitle,
  getSignalTakeProfits,
  getSignalUpdates
} from "../lib/tradingSignals";
import { sanitizePlainText } from "../lib/validation";
import type {
  AmlCheckRequest,
  TradingAcademyLeaderboardRow,
  TradingSignal
} from "../types/content";

const blankAmlForm = {
  address: "",
  network: "",
  notes: ""
};

type RiskCalculatorFormState = {
  direction: RiskDirection;
  accountBalance: string;
  riskPercent: string;
  entryPrice: string;
  stopLossMode: RiskValueMode;
  stopLossValue: string;
  takeProfitMode: RiskValueMode;
  takeProfits: RiskTakeProfitInput[];
  leverage: string;
  positionSizeMode: PositionSizeMode;
  manualNotionalValue: string;
};

type RiskTakeProfitInput = {
  id: string;
  value: string;
};

type RiskCalculatorEditableField = Exclude<keyof RiskCalculatorFormState, "takeProfits">;

const riskLeverageOptions = Array.from({ length: 100 }, (_, index) => String(index + 1));

function createBlankRiskForm(): RiskCalculatorFormState {
  return {
    direction: "long",
    accountBalance: "",
    riskPercent: "1",
    entryPrice: "",
    stopLossMode: "percentage",
    stopLossValue: "",
    takeProfitMode: "percentage",
    takeProfits: [createRiskTakeProfitInput()],
    leverage: "1",
    positionSizeMode: "auto",
    manualNotionalValue: ""
  };
}

function createRiskTakeProfitInput(): RiskTakeProfitInput {
  return {
    id: crypto.randomUUID(),
    value: ""
  };
}

export function TradingAcademyDashboard() {
  const { user, profile } = useAuth();
  const accountStatus = useAccountStatus();
  const [leaderboard, setLeaderboard] = useState<TradingAcademyLeaderboardRow[]>([]);
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [amlRequests, setAmlRequests] = useState<AmlCheckRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amlForm, setAmlForm] = useState(blankAmlForm);
  const [amlIdempotencyKey, setAmlIdempotencyKey] = useState(() => crypto.randomUUID());
  const [amlMessage, setAmlMessage] = useState<string | null>(null);
  const [isAmlSubmitting, setIsAmlSubmitting] = useState(false);
  const [isLeaderboardExpanded, setIsLeaderboardExpanded] = useState(false);
  const [riskForm, setRiskForm] = useState<RiskCalculatorFormState>(() => createBlankRiskForm());
  const [riskResult, setRiskResult] = useState<RiskCalculatorResult | null>(null);
  const [riskErrors, setRiskErrors] = useState<string[]>([]);
  const [hasRiskCalculated, setHasRiskCalculated] = useState(false);

  const loadDashboard = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const [nextLeaderboard, nextSignals, nextAmlRequests] = await Promise.all([
        fetchTradingAcademyLeaderboard(),
        fetchTradingSignals(),
        fetchUserAmlCheckRequests(user.id)
      ]);

      setLeaderboard(nextLeaderboard);
      setSignals(nextSignals);
      setAmlRequests(nextAmlRequests);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Trading Academy dashboard could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const displayName = useMemo(
    () => profile?.full_name ?? profile?.username ?? user?.email ?? "Academy learner",
    [profile, user]
  );
  const activeSignals = useMemo(() => signals.filter((signal) => signal.status === "active"), [signals]);
  const pastTrades = useMemo(
    () => signals.filter((signal) => TRADING_SIGNAL_FINAL_STATUSES.includes(signal.status)),
    [signals]
  );
  const visibleLeaderboard = useMemo(
    () => (isLeaderboardExpanded ? leaderboard : leaderboard.slice(0, 3)),
    [isLeaderboardExpanded, leaderboard]
  );

  const submitAml = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || isAmlSubmitting) return;

    const address = sanitizePlainText(amlForm.address, 500);
    const network = sanitizePlainText(amlForm.network, 120);

    if (!address) {
      setAmlMessage("Wallet address is required.");
      return;
    }

    if (!network) {
      setAmlMessage("Network is required.");
      return;
    }

    if (accountStatus.balanceCents < AML_CHECK_PRICE_CENTS) {
      setAmlMessage(`AML checks cost ${formatUsd(AML_CHECK_PRICE_CENTS)}. Top up your balance before submitting.`);
      return;
    }

    setIsAmlSubmitting(true);
    setAmlMessage(null);

    try {
      await submitAmlCheck({
        address,
        network,
        notes: amlForm.notes,
        idempotencyKey: amlIdempotencyKey
      });
      setAmlForm(blankAmlForm);
      setAmlIdempotencyKey(crypto.randomUUID());
      setAmlMessage("AML check request submitted. Your balance was charged $2.00.");
      await Promise.all([accountStatus.refreshBalance(), loadDashboard()]);
    } catch (submitError) {
      setAmlMessage(submitError instanceof Error ? submitError.message : "AML check could not be submitted.");
    } finally {
      setIsAmlSubmitting(false);
    }
  };

  const calculateCurrentRisk = useCallback(() => {
    const calculation = calculateRisk({
      symbol: "Position",
      direction: riskForm.direction,
      accountBalance: numberFromInput(riskForm.accountBalance),
      riskPercent: numberFromInput(riskForm.riskPercent),
      entryPrice: numberFromInput(riskForm.entryPrice),
      stopLossMode: riskForm.stopLossMode,
      stopLossValue: numberFromInput(riskForm.stopLossValue),
      takeProfitMode: riskForm.takeProfitMode,
      takeProfitValues: riskForm.takeProfits.map((takeProfit) => numberFromInput(takeProfit.value)),
      leverage: numberFromInput(riskForm.leverage),
      positionSizeMode: riskForm.positionSizeMode,
      manualNotionalValue: numberFromInput(riskForm.manualNotionalValue)
    });

    if (!calculation.ok) {
      setRiskResult(null);
      setRiskErrors(calculation.errors);
      return false;
    }

    setRiskErrors([]);
    setRiskResult(calculation.result);
    return true;
  }, [riskForm]);

  useEffect(() => {
    if (!hasRiskCalculated) return;

    calculateCurrentRisk();
  }, [calculateCurrentRisk, hasRiskCalculated]);

  const submitRiskCalculation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHasRiskCalculated(true);
    calculateCurrentRisk();
  };

  const updateRiskForm = (field: RiskCalculatorEditableField, value: string) => {
    setRiskForm((form) => {
      if (field === "positionSizeMode" && value === "manual") {
        return {
          ...form,
          positionSizeMode: value,
          manualNotionalValue: form.manualNotionalValue || form.accountBalance
        };
      }

      return { ...form, [field]: value };
    });
  };

  const updateRiskTakeProfit = (takeProfitId: string, price: string) => {
    setRiskForm((form) => ({
      ...form,
      takeProfits: form.takeProfits.map((takeProfit) =>
        takeProfit.id === takeProfitId ? { ...takeProfit, value: price } : takeProfit
      )
    }));
  };

  const addRiskTakeProfit = () => {
    setRiskForm((form) => ({ ...form, takeProfits: [...form.takeProfits, createRiskTakeProfitInput()] }));
  };

  const removeRiskTakeProfit = (takeProfitId: string) => {
    setRiskForm((form) => ({
      ...form,
      takeProfits:
        form.takeProfits.length > 1
          ? form.takeProfits.filter((takeProfit) => takeProfit.id !== takeProfitId)
          : form.takeProfits
    }));
  };

  const resetRiskCalculator = () => {
    setRiskForm(createBlankRiskForm());
    setRiskResult(null);
    setRiskErrors([]);
    setHasRiskCalculated(false);
  };

  return (
    <main className="page page-stack trading-academy-dashboard">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Trading Academy</p>
          <h1>Academy dashboard</h1>
          <p className="muted">
            Welcome back, {displayName}. Track leaderboard progress, review signals, request AML checks, and contact premium support.
          </p>
        </div>
        <div className="inline-actions">
          <span className="status-pill premium">
            <Crown size={15} />
            {accountStatus.planLabel}
          </span>
          <button className="ghost-button compact" type="button" onClick={() => void loadDashboard()}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </section>

      {error && <p className="warning-box">{error}</p>}

      {isLoading ? (
        <LoadingState label="Loading Trading Academy" />
      ) : (
        <>
          <section className="section-panel leaderboard-panel">
            <div className="lesson-title-line">
              <div>
                <p className="eyebrow">Leaderboard</p>
                <h2 className="title-with-leading-icon">
                  <Trophy size={28} aria-hidden="true" />
                  Top Academy learners
                </h2>
              </div>
            </div>
            {leaderboard.length ? (
              <ol className="leaderboard-list">
                {visibleLeaderboard.map((row) => (
                  <li className={`leaderboard-row ${leaderboardRankTone(row.rank)}`} key={row.member_key}>
                    <span className="leaderboard-rank">#{row.rank}</span>
                    <LeaderboardAvatar row={row} />
                    <div className="leaderboard-member-info">
                      <strong>{row.display_name}</strong>
                      <small>{row.total_xp} XP</small>
                      <LeaderboardBadgeStrip row={row} />
                    </div>
                    <span className="level-badge">LVL {row.level}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No Trading Academy users are ranked yet.</p>
            )}
            {leaderboard.length > 3 && (
              <button
                className="ghost-button compact leaderboard-toggle"
                type="button"
                onClick={() => setIsLeaderboardExpanded((expanded) => !expanded)}
              >
                {isLeaderboardExpanded ? "Show top 3" : `Show all ${leaderboard.length}`}
              </button>
            )}
          </section>

          <section className="section-panel academy-signal-section">
            <div className="lesson-title-line">
              <div>
                <p className="eyebrow">Trading Signals</p>
                <h2 className="title-with-leading-icon">
                  <LineChart size={28} aria-hidden="true" />
                  Trading Signal by ASEKE TRADE
                </h2>
              </div>
            </div>
            {activeSignals.length ? (
              <div className="signal-grid academy-signal-grid">
                {activeSignals.map((signal) => (
                  <SignalCard signal={signal} key={signal.id} />
                ))}
              </div>
            ) : (
              <div className="compact-empty-state">
                <LineChart size={20} aria-hidden="true" />
                <p className="muted">No active trading signals have been posted yet.</p>
              </div>
            )}
          </section>

          <section className="section-panel academy-signal-section">
            <div className="lesson-title-line">
              <div>
                <p className="eyebrow">Past Trades</p>
                <h2 className="title-with-leading-icon">
                  <Trophy size={28} aria-hidden="true" />
                  Completed signal history
                </h2>
              </div>
            </div>
            {pastTrades.length ? (
              <div className="signal-grid academy-signal-grid">
                {pastTrades.map((signal) => (
                  <SignalCard signal={signal} showPastSummary key={signal.id} />
                ))}
              </div>
            ) : (
              <div className="compact-empty-state">
                <Trophy size={20} aria-hidden="true" />
                <p className="muted">Completed Trading Academy signals will appear here.</p>
              </div>
            )}
          </section>

          <RiskCalculatorPanel
            addTakeProfit={addRiskTakeProfit}
            errors={riskErrors}
            form={riskForm}
            isLocked={!accountStatus.isPremiumActive}
            onChange={updateRiskForm}
            onRemoveTakeProfit={removeRiskTakeProfit}
            onReset={resetRiskCalculator}
            onSubmit={submitRiskCalculation}
            onTakeProfitChange={updateRiskTakeProfit}
            result={riskResult}
          />

          <section className="dashboard-grid academy-tools-grid">
            <article className="section-panel stack-form academy-tool-panel">
              <div className="compact-tool-heading">
                <span className="feature-icon">
                  <SearchCheck size={20} />
                </span>
                <div>
                  <h2>AML Check</h2>
                  <p className="muted">Each request costs {formatUsd(AML_CHECK_PRICE_CENTS)} and is manually reviewed by admin.</p>
                </div>
              </div>
              <p className="muted helper-copy">
                AML checks help assess whether a crypto wallet or transaction may be connected to suspicious activity,
                helping protect you from receiving dirty or high-risk crypto that may create exchange, withdrawal, or
                compliance review problems.
              </p>
              {amlMessage && <p className="soft-notice">{amlMessage}</p>}
              <form className="stack-form" onSubmit={submitAml}>
                <label>
                  Wallet / address
                  <input
                    value={amlForm.address}
                    onChange={(event) => setAmlForm((form) => ({ ...form, address: event.target.value }))}
                    maxLength={500}
                    required
                  />
                </label>
                <label>
                  Network / blockchain
                  <input
                    value={amlForm.network}
                    onChange={(event) => setAmlForm((form) => ({ ...form, network: event.target.value }))}
                    maxLength={120}
                    required
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    value={amlForm.notes}
                    onChange={(event) => setAmlForm((form) => ({ ...form, notes: event.target.value }))}
                    maxLength={1000}
                    rows={3}
                  />
                </label>
                <button className="primary-button" type="submit" disabled={isAmlSubmitting}>
                  <SearchCheck size={17} />
                  {isAmlSubmitting ? "Submitting" : `Submit AML Check - ${formatUsd(AML_CHECK_PRICE_CENTS)}`}
                </button>
              </form>
              <CompactAmlHistory requests={amlRequests} />
            </article>

            <article className="section-panel stack-form academy-tool-panel premium-support-panel">
              <div className="compact-tool-heading">
                <span className="feature-icon">
                  <Headphones size={20} />
                </span>
                <div>
                  <h2>Premium Support</h2>
                  <p className="muted">Premium members get direct Telegram support for faster help.</p>
                </div>
              </div>
              <p className="muted helper-copy">
                For fastest assistance, message @don_chrome directly on Telegram.
              </p>
              <div className="premium-support-direct">
                <a
                  className="telegram-contact-link"
                  href="https://t.me/don_chrome"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Message ASEKE TRADE support on Telegram at @don_chrome"
                >
                  <span className="telegram-icon-frame">
                    <TelegramIcon />
                  </span>
                  <span>
                    <strong>Message Premium Support</strong>
                    <small>@don_chrome</small>
                  </span>
                </a>
              </div>
            </article>
          </section>
        </>
      )}
    </main>
  );
}

function RiskCalculatorPanel({
  addTakeProfit,
  errors,
  form,
  isLocked,
  onChange,
  onRemoveTakeProfit,
  onReset,
  onSubmit,
  onTakeProfitChange,
  result
}: {
  addTakeProfit: () => void;
  errors: string[];
  form: RiskCalculatorFormState;
  isLocked: boolean;
  onChange: (field: RiskCalculatorEditableField, value: string) => void;
  onRemoveTakeProfit: (takeProfitId: string) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTakeProfitChange: (takeProfitId: string, price: string) => void;
  result: RiskCalculatorResult | null;
}) {
  return (
    <section className="section-panel risk-calculator-panel">
      <div className="lesson-title-line">
        <div>
          <h2 className="title-with-leading-icon">
            <Calculator size={28} aria-hidden="true" />
            Risk Calculator
          </h2>
        </div>
      </div>

      {isLocked ? (
        <div className="compact-empty-state">
          <Crown size={20} aria-hidden="true" />
          <p className="muted">Risk Calculator is available to Trading Academy subscribers.</p>
        </div>
      ) : (
        <div className="risk-calculator-layout">
          <form className="risk-calculator-form risk-input-panel stack-form" onSubmit={onSubmit}>
            <div className="risk-field-group">
              <span className="risk-field-label">Direction</span>
              <div className="risk-direction-toggle" role="group" aria-label="Trade direction">
                <button
                  className={form.direction === "long" ? "long active" : "long"}
                  type="button"
                  onClick={() => onChange("direction", "long")}
                >
                  Long
                </button>
                <button
                  className={form.direction === "short" ? "short active" : "short"}
                  type="button"
                  onClick={() => onChange("direction", "short")}
                >
                  Short
                </button>
              </div>
            </div>

            <label className="risk-field-group">
              <span className="risk-field-label">Account Balance</span>
              <span className="risk-prefixed-input">
                <span>$</span>
                <input
                  inputMode="decimal"
                  value={form.accountBalance}
                  onChange={(event) => onChange("accountBalance", event.target.value)}
                />
              </span>
            </label>

            {form.positionSizeMode === "auto" && (
              <label className="risk-field-group">
                <span className="risk-field-label">Max Loss at Stop %</span>
                <span className="risk-prefixed-input">
                  <span>%</span>
                  <input
                    inputMode="decimal"
                    value={form.riskPercent}
                    onChange={(event) => onChange("riskPercent", event.target.value)}
                  />
                </span>
                <small className="risk-derived-line">{formatMaxLossHelper(form)}</small>
              </label>
            )}

            <div className="risk-form-grid">
              <label>
                Entry Price
                <input
                  inputMode="decimal"
                  value={form.entryPrice}
                  onChange={(event) => onChange("entryPrice", event.target.value)}
                />
              </label>
              <label>
                Leverage
                <select value={form.leverage} onChange={(event) => onChange("leverage", event.target.value)}>
                  {riskLeverageOptions.map((leverage) => (
                    <option value={leverage} key={leverage}>
                      {leverage}X
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Size Mode
                <select
                  value={form.positionSizeMode}
                  onChange={(event) => onChange("positionSizeMode", event.target.value)}
                >
                  <option value="auto">Auto: Calculate position from max loss</option>
                  <option value="manual">Manual: I choose position value</option>
                </select>
              </label>
            </div>

            {form.positionSizeMode === "manual" && (
              <label className="risk-field-group">
                <span className="risk-field-label">Manual Notional Value</span>
                <span className="risk-prefixed-input">
                  <span>$</span>
                  <input
                    inputMode="decimal"
                    value={form.manualNotionalValue}
                    onChange={(event) => onChange("manualNotionalValue", event.target.value)}
                  />
                </span>
                <small className="risk-derived-line">
                  This is your full position value, not your margin and not your max loss.
                  {formatManualMarginHelper(form)}
                </small>
              </label>
            )}

            <div className="risk-field-group">
              <span className="risk-field-label">Stop Loss Mode</span>
              <div className="risk-direction-toggle risk-mode-toggle" role="group" aria-label="Stop loss input mode">
                <button
                  className={form.stopLossMode === "percentage" ? "active" : ""}
                  type="button"
                  onClick={() => onChange("stopLossMode", "percentage")}
                >
                  Percentage
                </button>
                <button
                  className={form.stopLossMode === "price" ? "active" : ""}
                  type="button"
                  onClick={() => onChange("stopLossMode", "price")}
                >
                  Price
                </button>
              </div>
            </div>

            <label className="risk-field-group">
              <span className="risk-field-label">
                {form.stopLossMode === "percentage" ? "Stop Loss %" : "Stop Loss Price"}
              </span>
              <span className={form.stopLossMode === "percentage" ? "risk-prefixed-input suffix" : "risk-prefixed-input"}>
                <span>{form.stopLossMode === "percentage" ? "%" : "$"}</span>
                <input
                  inputMode="decimal"
                  placeholder={form.stopLossMode === "percentage" ? "5" : "60,800"}
                  value={form.stopLossValue}
                  onChange={(event) => onChange("stopLossValue", event.target.value)}
                />
              </span>
              {formatDerivedStopLossLine(form) && (
                <small className="risk-derived-line">{formatDerivedStopLossLine(form)}</small>
              )}
            </label>

            <div className="risk-tp-editor">
              <div className="compact-panel-header">
                <h3>Take Profits</h3>
                <button className="ghost-button compact" type="button" onClick={addTakeProfit}>
                  <Plus size={16} />
                  Add TP
                </button>
              </div>
              <div className="risk-direction-toggle risk-mode-toggle" role="group" aria-label="Take profit input mode">
                <button
                  className={form.takeProfitMode === "percentage" ? "active" : ""}
                  type="button"
                  onClick={() => onChange("takeProfitMode", "percentage")}
                >
                  Percentage
                </button>
                <button
                  className={form.takeProfitMode === "price" ? "active" : ""}
                  type="button"
                  onClick={() => onChange("takeProfitMode", "price")}
                >
                  Price
                </button>
              </div>
              <div className="risk-tp-input-list">
                {form.takeProfits.map((takeProfit, index) => (
                  <div className="risk-tp-input-row" key={takeProfit.id}>
                    <label>
                      {form.takeProfitMode === "percentage" ? `TP${index + 1} %` : `TP${index + 1} Price`}
                      <input
                        inputMode="decimal"
                        placeholder={form.takeProfitMode === "percentage" ? "10" : "70,000"}
                        value={takeProfit.value}
                        onChange={(event) => onTakeProfitChange(takeProfit.id, event.target.value)}
                      />
                      {formatDerivedTakeProfitLine(form, takeProfit.value) && (
                        <small className="risk-derived-line">{formatDerivedTakeProfitLine(form, takeProfit.value)}</small>
                      )}
                    </label>
                    <button
                      className="icon-button danger"
                      type="button"
                      onClick={() => onRemoveTakeProfit(takeProfit.id)}
                      disabled={form.takeProfits.length === 1}
                    >
                      <Trash2 size={16} />
                      <span className="sr-only">Remove TP{index + 1}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <p className="risk-education-note">
              Position value, margin, and account risk are different. A $1,000 position with a 3% stop risks $30. To
              risk $1,000 with a 3% stop, the position must be $33,333.33. This calculator is for educational purposes
              only and does not guarantee profit or prevent loss.
            </p>

            {errors.length > 0 && (
              <ul className="risk-message-list warning">
                {errors.map((riskError) => (
                  <li key={riskError}>{riskError}</li>
                ))}
              </ul>
            )}
            <div className="inline-actions">
              <button className="primary-button compact" type="submit">
                <Calculator size={17} />
                Calculate
              </button>
              <button className="ghost-button compact" type="button" onClick={onReset}>
                <RotateCcw size={17} />
                Reset
              </button>
            </div>
          </form>

          <RiskCalculatorResults result={result} />
        </div>
      )}
    </section>
  );
}

function RiskCalculatorResults({ result }: { result: RiskCalculatorResult | null }) {
  const assessment = getRiskAssessment(result?.accountRiskPercent ?? null);
  const isAutoMode = result?.positionSizeMode !== "manual";

  return (
    <article className="risk-result-panel">
      <p className="risk-start-line">
        {result ? `${result.direction.toUpperCase()} risk profile` : "Enter Account Balance to start"}
      </p>

      <div className="risk-position-card">
        <span>Notional Position Value</span>
        <strong>{result ? formatUsdAmount(result.notionalPositionValue) : "$--"}</strong>
        <small>{result ? `Position Size: ${formatCoinQuantity(result.positionSizeUnits)} units` : "Position Size: -- units"}</small>
      </div>

      <dl className="risk-summary-list">
        <RiskMetricRow
          label={isAutoMode ? "Max Loss at Stop" : "Actual Loss at Stop"}
          value={
            result
              ? `${formatUsdAmount(result.actualRiskAmount)} (${formatPercentValue(result.actualRiskPercent)})`
              : "$-- (--)"
          }
        />
        <RiskMetricRow label="Stop Loss Distance" value={result ? formatPercentValue(result.stopLossPercent) : "--%"} />
        <RiskMetricRow label="Stop Loss Price" value={result ? formatUsdAmount(result.stopLossPrice) : "$--"} />
        <RiskMetricRow
          label="Margin Required"
          value={result ? `${formatUsdAmount(result.marginRequired)} at ${formatRiskDecimal(result.leverage)}x` : "$--"}
        />
      </dl>

      <RiskModeSummary result={result} />

      {result?.positionSizeMode === "auto" && <RiskAutoExplanation result={result} />}

      <section className="risk-breakdown-card">
        <h3>
          <ShieldCheck size={17} />
          Risk Breakdown
        </h3>
        <dl className="risk-result-grid">
          <RiskMetricBox
            label={isAutoMode ? "Max Account Risk" : "Actual Account Risk"}
            value={result ? formatPercentValue(result.actualRiskPercent) : "--%"}
          />
          <RiskMetricBox label="Stop Loss Distance" value={result ? formatPercentValue(result.stopLossPercent) : "--%"} />
          <RiskMetricBox label="Margin Used" value={result ? formatPercentValue(result.marginUsedPercent) : "--%"} />
          <RiskMetricBox label="Required Leverage" value={result ? `${formatRiskDecimal(result.requiredLeverage)}x` : "--x"} />
        </dl>
      </section>

      <dl className="risk-summary-list">
        <RiskMetricRow label="Available Balance" value={result ? formatUsdAmount(result.accountBalance) : "$--"} />
        <RiskMetricRow
          label="Max Position at Selected Leverage"
          value={result ? formatUsdAmount(result.maxPositionValueAtSelectedLeverage) : "$--"}
        />
        <RiskMetricRow
          label="Max Affordable Coin Quantity"
          value={result ? `${formatCoinQuantity(result.maxAffordableCoinQuantity)} units` : "-- units"}
        />
        {result && result.marginShortfall > 0 && (
          <RiskMetricRow label="Margin Shortfall" value={formatUsdAmount(result.marginShortfall)} />
        )}
      </dl>

      <section className={`risk-assessment-card ${assessment.tone}`}>
        <h3>
          <ShieldCheck size={17} />
          Risk Assessment
        </h3>
        <div
          className={`risk-assessment-bar ${assessment.tone}`}
          role="meter"
          aria-label="Account risk assessment"
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={assessment.meterValue}
          aria-valuetext={assessment.ariaLabel}
        >
          <span className="risk-assessment-fill" style={{ width: `${assessment.positionPercent}%` }} />
          <span className="risk-assessment-marker" style={{ left: `${assessment.positionPercent}%` }} />
        </div>
        <div className="risk-assessment-scale">
          <span>0%</span>
          <span>1%</span>
          <span>2%</span>
          <span>5%+</span>
        </div>
        <strong>{assessment.valueLabel}</strong>
        <span>{assessment.label}</span>
      </section>

      {result && result.takeProfits.length > 0 && (
        <ul className="risk-tp-list">
          {result.takeProfits.map((takeProfit) => (
            <li className={takeProfit.profitAmount > 0 ? "positive" : "warning"} key={takeProfit.label}>
              <strong>
                {takeProfit.label}: {formatUsdAmount(takeProfit.price)} ({formatPercentValue(takeProfit.percent)})
              </strong>
              <span>
                {formatUsdAmount(takeProfit.profitAmount)} - {formatRiskMultiple(takeProfit.riskReward)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {result && result.warnings.length > 0 && (
        <ul className="risk-message-list">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

function RiskModeSummary({ result }: { result: RiskCalculatorResult | null }) {
  if (!result) {
    return (
      <section className="risk-mode-summary">
        <h3>Position sizing mode</h3>
        <p>Choose auto mode to size from max loss, or manual mode to choose the position value yourself.</p>
      </section>
    );
  }

  if (result.positionSizeMode === "auto") {
    return (
      <section className="risk-mode-summary">
        <h3>Auto position sizing</h3>
        <p>The calculator chooses the position size needed to match your max loss at stop.</p>
        <dl className="risk-summary-list">
          <RiskMetricRow label="Max Loss at Stop" value={formatUsdAmount(result.selectedRiskAmount)} />
          <RiskMetricRow label="Stop Loss Distance" value={formatPercentValue(result.stopLossPercent)} />
          <RiskMetricRow label="Required Notional Position" value={formatUsdAmount(result.notionalPositionValue)} />
        </dl>
      </section>
    );
  }

  return (
    <section className="risk-mode-summary">
      <h3>Manual position sizing</h3>
      <p>You choose the position value. The calculator shows how much you would actually lose if stop loss is hit.</p>
      <dl className="risk-summary-list">
        <RiskMetricRow label="Chosen Position Value" value={formatUsdAmount(result.notionalPositionValue)} />
        <RiskMetricRow label="Stop Loss Distance" value={formatPercentValue(result.stopLossPercent)} />
        <RiskMetricRow label="Actual Loss at Stop" value={formatUsdAmount(result.actualRiskAmount)} />
        <RiskMetricRow label="Actual Account Risk" value={formatPercentValue(result.actualRiskPercent)} />
      </dl>
    </section>
  );
}

function RiskAutoExplanation({ result }: { result: RiskCalculatorResult }) {
  return (
    <section className="risk-explanation-card">
      <p>
        You selected to risk {formatUsdAmount(result.selectedRiskAmount)} if stop loss is hit. Since your stop loss is{" "}
        {formatPercentValue(result.stopLossPercent)} away, the calculator needs a{" "}
        {formatUsdAmount(result.notionalPositionValue)} position because{" "}
        {formatPercentValue(result.stopLossPercent)} of {formatUsdAmount(result.notionalPositionValue)} equals{" "}
        {formatUsdAmount(result.selectedRiskAmount)}.
      </p>
      <p>This is why Auto mode can create a much larger position than Manual mode.</p>
    </section>
  );
}

function RiskMetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RiskMetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function CompactAmlHistory({ requests }: { requests: AmlCheckRequest[] }) {
  const recentRequests = requests.slice(0, 3);
  const olderRequests = requests.slice(3);

  return (
    <div className="compact-history-panel">
      <div className="compact-history-heading">
        <div>
          <p className="eyebrow">Recent checks</p>
          <h3>AML history</h3>
        </div>
        <span>{requests.length} total</span>
      </div>

      {requests.length ? (
        <>
          <CompactAmlHistoryList requests={recentRequests} />
          {olderRequests.length > 0 && (
            <details className="compact-history-details">
              <summary>View all {requests.length} AML checks</summary>
              <CompactAmlHistoryList requests={olderRequests} />
            </details>
          )}
        </>
      ) : (
        <p className="compact-history-empty">No AML check history yet.</p>
      )}
    </div>
  );
}

function CompactAmlHistoryList({ requests }: { requests: AmlCheckRequest[] }) {
  return (
    <ul className="compact-history-list">
      {requests.map((request) => (
        <li className="compact-history-row" key={request.id}>
          <div>
            <strong>{request.network} - {shortenAddress(request.address)}</strong>
            <span>
              {formatDateTime(request.created_at)} - {formatUsd(request.amount_charged_cents)}
            </span>
            {(request.admin_result || request.admin_notes) && (
              <small>{request.admin_result ?? request.admin_notes}</small>
            )}
          </div>
          <span className="status-pill free">{request.status.replace("_", " ")}</span>
        </li>
      ))}
    </ul>
  );
}

function LeaderboardAvatar({ row }: { row: TradingAcademyLeaderboardRow }) {
  const [hasImageError, setHasImageError] = useState(false);
  const avatarUrl = resolvePublicAvatarUrl(row.avatar_url);
  const fallbackInitial = row.display_name.trim().charAt(0).toUpperCase() || "A";

  return (
    <span className="leaderboard-avatar">
      {avatarUrl && !hasImageError ? (
        <img src={avatarUrl} alt={`${row.display_name} avatar`} onError={() => setHasImageError(true)} />
      ) : (
        <>
          <UserRound size={16} aria-hidden="true" />
          <span aria-hidden="true">{fallbackInitial}</span>
        </>
      )}
    </span>
  );
}

function LeaderboardBadgeStrip({ row }: { row: TradingAcademyLeaderboardRow }) {
  if (!row.badges.length) return null;

  return (
    <span className="leaderboard-badge-strip" aria-label={`${row.display_name} earned badges`}>
      {row.badges.map((badge) => (
        <UserBadgePill badge={badge} size="small" showLabel={false} key={badge.id} />
      ))}
    </span>
  );
}

function SignalLevel({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{formatSignalPrice(value)}</dd>
    </div>
  );
}

function SignalStopLossLevel({
  currentValue,
  originalValue
}: {
  currentValue: string | number;
  originalValue?: string | number | null;
}) {
  const wasUpdated =
    originalValue !== null && originalValue !== undefined && !signalPriceValuesMatch(originalValue, currentValue);

  return (
    <div className={wasUpdated ? "signal-stop-loss-level updated" : "signal-stop-loss-level"}>
      <dt>SL</dt>
      <dd>
        {wasUpdated ? (
          <span className="signal-sl-stack">
            <span className="signal-sl-row old">
              <span className="signal-sl-label">Initial</span>
              <s>{formatSignalPrice(originalValue)}</s>
            </span>
            <span className="signal-sl-row current">
              <span className="signal-sl-label">Updated</span>
              <strong>{formatSignalPrice(currentValue)}</strong>
            </span>
          </span>
        ) : (
          formatSignalPrice(currentValue)
        )}
      </dd>
    </div>
  );
}

function SignalCard({ signal, showPastSummary = false }: { signal: TradingSignal; showPastSummary?: boolean }) {
  const original = signal.original_signal;
  const currentTakeProfits = getSignalTakeProfits(signal);
  const displayTakeProfits = currentTakeProfits;
  const updates = getSignalUpdates(signal);
  const title = getSignalDisplayTitle(signal);
  const direction = signal.direction;
  const leverage = signal.leverage ?? 1;
  const finalRoi = signal.final_roi ?? calculateSignalFinalRoi(signal);

  return (
    <article className="signal-card academy-signal-card">
      <div className="signal-card-setup">
        {signal.chart_image_url ? (
          <img className="signal-chart-image" src={signal.chart_image_url} alt="" />
        ) : (
          <div className="signal-chart-empty">Chart pending</div>
        )}
        <div className="signal-card-body">
          <div className="lesson-title-line">
            <div>
              <p className="eyebrow">{signal.symbol}</p>
              <h3>{title}</h3>
            </div>
            <span className={`status-pill ${signal.status === "hit_sl" ? "danger" : "premium"}`}>
              {formatSignalStatus(signal.status)}
            </span>
          </div>

          <dl className="signal-level-grid">
            <SignalLevel label="Direction" value={direction.toUpperCase()} />
            <SignalLevel label="Leverage" value={`${leverage}X`} />
            <SignalLevel label="Entry" value={signal.entry_price} />
            <SignalStopLossLevel currentValue={signal.stop_loss} originalValue={original?.stopLoss} />
            <SignalLevel label="Opened" value={formatDateTime(signal.created_at)} />
          </dl>

          <div className="signal-detail-block">
            <h4>Take Profits</h4>
            <ul className="signal-tp-list">
              {displayTakeProfits.map((takeProfit, index) => (
                <li className={takeProfit.isHit ? "hit" : ""} key={takeProfit.id}>
                  <strong>TP{index + 1}: {formatSignalPrice(takeProfit.price)}</strong>
                  <span>
                    {formatPercent(takeProfit.positionSizePercent)}% - {takeProfit.isHit ? "Hit" : "Pending"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {showPastSummary && (
            <dl className="signal-level-grid">
              <SignalLevel label="Final status" value={formatSignalStatus(signal.status)} />
              <SignalLevel label="Final price" value={signal.final_price ?? signal.manual_close_price ?? signal.stop_loss} />
              <SignalLevel label="Closed" value={signal.closed_at ? formatDateTime(signal.closed_at) : "Pending"} />
              <SignalLevel label="Final ROI" value={finalRoi === null ? "N/A" : formatRoi(finalRoi)} />
            </dl>
          )}

          {(signal.notes || original?.notes) && <p className="muted">{signal.notes ?? original?.notes}</p>}
        </div>
      </div>

      <div className="signal-detail-block signal-card-updates">
        <h4>Updates</h4>
        <ol className="signal-timeline">
          {updates.map((update) => (
            <li key={update.id}>
              <time>{formatDateTime(update.createdAt)}</time>
              <span>{update.message}</span>
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}

function TelegramIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M21.64 4.08c.31-.13.66.11.59.48l-2.79 15.73c-.06.34-.44.5-.72.31l-4.82-3.38-2.46 2.38c-.27.26-.72.11-.79-.26l-.82-4.32-4.72-1.62c-.39-.13-.41-.68-.03-.84L21.64 4.08Zm-3.59 3.3-10.4 5.63 3.01.97 6.85-4.31c.15-.09.3.1.18.22l-5.53 5.26.58 2.74 1.24-1.19c.16-.15.4-.17.58-.04l3.32 2.33 2.2-12.37-2.03.76Z"
      />
    </svg>
  );
}

function numberFromInput(value: string): number {
  return Number(value.replace(/,/g, "").trim());
}

function signalPriceValuesMatch(first: string | number, second: string | number): boolean {
  const firstNumber = numberFromSignalPrice(first);
  const secondNumber = numberFromSignalPrice(second);

  if (firstNumber !== null && secondNumber !== null) {
    return firstNumber === secondNumber;
  }

  return String(first).trim() === String(second).trim();
}

function numberFromSignalPrice(value: string | number): number | null {
  const numericValue = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatMaxLossHelper(form: RiskCalculatorFormState): string {
  const accountBalance = numberFromInput(form.accountBalance);
  const maxLossPercent = numberFromInput(form.riskPercent);

  if (isPositiveNumber(accountBalance) && isPositiveNumber(maxLossPercent)) {
    const maxLossAmount = accountBalance * (maxLossPercent / 100);
    if (maxLossPercent >= 100) {
      return `You selected 100%, meaning you are risking the full ${formatUsdAmount(accountBalance)} account if stop loss is hit.`;
    }

    return `This is the percentage of your account you are willing to lose if stop loss is hit. It is not the position size. Example: With a ${formatUsdAmount(
      accountBalance
    )} account and ${formatPercentValue(maxLossPercent)} max loss, you are risking ${formatUsdAmount(maxLossAmount)}.`;
  }

  return "This is the percentage of your account you are willing to lose if stop loss is hit. It is not the position size.";
}

function formatManualMarginHelper(form: RiskCalculatorFormState): string {
  const manualNotionalValue = numberFromInput(form.manualNotionalValue);
  const leverage = numberFromInput(form.leverage);
  if (!isPositiveNumber(manualNotionalValue) || !isPositiveNumber(leverage) || leverage <= 1) return "";

  return ` At ${formatRiskDecimal(leverage)}x, this position requires approximately ${formatUsdAmount(
    manualNotionalValue / leverage
  )} margin.`;
}

function formatDerivedStopLossLine(form: RiskCalculatorFormState): string | null {
  const entryPrice = numberFromInput(form.entryPrice);
  const stopLossValue = numberFromInput(form.stopLossValue);
  if (!isPositiveNumber(entryPrice) || !isPositiveNumber(stopLossValue)) return null;

  if (form.stopLossMode === "percentage") {
    const stopLossPrice =
      form.direction === "long"
        ? entryPrice * (1 - stopLossValue / 100)
        : entryPrice * (1 + stopLossValue / 100);
    if (!isPositiveNumber(stopLossPrice)) return null;
    return `Stop Price: ${formatUsdAmount(stopLossPrice)}`;
  }

  const stopDistancePercent = (Math.abs(entryPrice - stopLossValue) / entryPrice) * 100;
  return `Stop Distance: ${formatPercentValue(stopDistancePercent)}`;
}

function formatDerivedTakeProfitLine(form: RiskCalculatorFormState, takeProfitValue: string): string | null {
  const entryPrice = numberFromInput(form.entryPrice);
  const takeProfit = numberFromInput(takeProfitValue);
  if (!isPositiveNumber(entryPrice) || !isPositiveNumber(takeProfit)) return null;

  if (form.takeProfitMode === "percentage") {
    const takeProfitPrice =
      form.direction === "long"
        ? entryPrice * (1 + takeProfit / 100)
        : entryPrice * (1 - takeProfit / 100);
    if (!isPositiveNumber(takeProfitPrice)) return null;
    return `TP Price: ${formatUsdAmount(takeProfitPrice)}`;
  }

  const takeProfitPercent = (Math.abs(takeProfit - entryPrice) / entryPrice) * 100;
  return `TP Distance: ${formatPercentValue(takeProfitPercent)}`;
}

function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function getRiskAssessment(accountRiskPercent: number | null): {
  ariaLabel: string;
  label: string;
  meterValue: number;
  positionPercent: number;
  tone: "empty" | "conservative" | "moderate" | "aggressive" | "high-risk";
  valueLabel: string;
} {
  if (accountRiskPercent === null || !Number.isFinite(accountRiskPercent)) {
    return {
      ariaLabel: "Enter trade values to calculate account risk.",
      label: "ENTER VALUES",
      meterValue: 0,
      positionPercent: 0,
      tone: "empty",
      valueLabel: "--%"
    };
  }

  const meterValue = Math.min(5, Math.max(0, accountRiskPercent));
  const positionPercent = (meterValue / 5) * 100;
  const label =
    accountRiskPercent <= 1
      ? "CONSERVATIVE"
      : accountRiskPercent <= 2
        ? "MODERATE"
        : accountRiskPercent <= 5
          ? "AGGRESSIVE"
          : "HIGH RISK";
  const tone =
    accountRiskPercent <= 1
      ? "conservative"
      : accountRiskPercent <= 2
        ? "moderate"
        : accountRiskPercent <= 5
          ? "aggressive"
          : "high-risk";

  return {
    ariaLabel: `${formatPercentValue(accountRiskPercent)} account risk. ${label}.`,
    label,
    meterValue,
    positionPercent,
    tone,
    valueLabel: formatPercentValue(accountRiskPercent)
  };
}

function formatUsdAmount(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

function formatPercentValue(value: number): string {
  return `${formatRiskDecimal(value)}%`;
}

function formatRiskMultiple(value: number): string {
  return `${formatRiskDecimal(value)}R`;
}

function formatRiskDecimal(value: number): string {
  if (!Number.isFinite(value)) return "N/A";

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2
  });
}

function formatCoinQuantity(value: number): string {
  if (!Number.isFinite(value)) return "N/A";

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 8
  });
}

function formatSignalPrice(value: string | number): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value);

  return numericValue.toLocaleString("en-US", {
    maximumFractionDigits: 10
  });
}

function formatRoi(value: string | number): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value);

  return `${numericValue >= 0 ? "+" : ""}${numericValue.toLocaleString("en-US", {
    maximumFractionDigits: 2
  })}%`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return date.toLocaleString();
}

function shortenAddress(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}
