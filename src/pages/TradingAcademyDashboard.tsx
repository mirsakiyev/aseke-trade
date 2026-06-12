import {
  Calculator,
  Crown,
  Headphones,
  LineChart,
  Plus,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  Send,
  ShieldCheck,
  Trash2,
  Trophy,
  UserRound
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { useAccountStatus } from "../hooks/useAccountStatus";
import { formatUsd } from "../lib/accountStatus";
import { resolvePublicAvatarUrl } from "../lib/avatarUrls";
import {
  calculateRisk,
  type PositionSizeMode,
  type RiskCalculatorResult,
  type RiskDirection
} from "../lib/riskCalculator";
import {
  AML_CHECK_PRICE_CENTS,
  fetchTradingAcademyLeaderboard,
  fetchTradingSignals,
  fetchUserAmlCheckRequests,
  fetchUserPremiumSupportRequests,
  submitAmlCheck,
  submitPremiumSupportRequest
} from "../lib/tradingAcademyApi";
import { leaderboardRankTone } from "../lib/tradingAcademyAccess";
import {
  TRADING_SIGNAL_FINAL_STATUSES,
  calculateSignalFinalRoi,
  formatPercent,
  formatSignalStatus,
  generateSignalTitle,
  getSignalTakeProfits,
  getSignalUpdates
} from "../lib/tradingSignals";
import { sanitizePlainText } from "../lib/validation";
import type {
  AmlCheckRequest,
  PremiumSupportPriority,
  PremiumSupportRequest,
  TradingAcademyLeaderboardRow,
  TradingSignal,
  TradingSignalTakeProfit
} from "../types/content";

const blankAmlForm = {
  address: "",
  network: "",
  notes: ""
};

const blankSupportForm = {
  subject: "",
  message: "",
  category: "strategy",
  priority: "normal" as PremiumSupportPriority
};

type RiskCalculatorFormState = {
  direction: RiskDirection;
  accountBalance: string;
  riskPercent: string;
  entryPrice: string;
  stopLossPrice: string;
  takeProfits: RiskTakeProfitInput[];
  leverage: string;
  positionSizeMode: PositionSizeMode;
  manualPositionSize: string;
};

type RiskTakeProfitInput = {
  id: string;
  price: string;
};

type RiskCalculatorEditableField = Exclude<keyof RiskCalculatorFormState, "takeProfits">;

const riskLeverageOptions = Array.from({ length: 100 }, (_, index) => String(index + 1));

function createBlankRiskForm(): RiskCalculatorFormState {
  return {
    direction: "long",
    accountBalance: "",
    riskPercent: "1",
    entryPrice: "",
    stopLossPrice: "",
    takeProfits: [createRiskTakeProfitInput()],
    leverage: "1",
    positionSizeMode: "auto",
    manualPositionSize: ""
  };
}

function createRiskTakeProfitInput(): RiskTakeProfitInput {
  return {
    id: crypto.randomUUID(),
    price: ""
  };
}

export function TradingAcademyDashboard() {
  const { user, profile } = useAuth();
  const accountStatus = useAccountStatus();
  const [leaderboard, setLeaderboard] = useState<TradingAcademyLeaderboardRow[]>([]);
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [amlRequests, setAmlRequests] = useState<AmlCheckRequest[]>([]);
  const [supportRequests, setSupportRequests] = useState<PremiumSupportRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amlForm, setAmlForm] = useState(blankAmlForm);
  const [amlIdempotencyKey, setAmlIdempotencyKey] = useState(() => crypto.randomUUID());
  const [amlMessage, setAmlMessage] = useState<string | null>(null);
  const [isAmlSubmitting, setIsAmlSubmitting] = useState(false);
  const [supportForm, setSupportForm] = useState(blankSupportForm);
  const [supportMessage, setSupportMessage] = useState<string | null>(null);
  const [isSupportSubmitting, setIsSupportSubmitting] = useState(false);
  const [isLeaderboardExpanded, setIsLeaderboardExpanded] = useState(false);
  const [riskForm, setRiskForm] = useState<RiskCalculatorFormState>(() => createBlankRiskForm());
  const [riskResult, setRiskResult] = useState<RiskCalculatorResult | null>(null);
  const [riskErrors, setRiskErrors] = useState<string[]>([]);

  const loadDashboard = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const [nextLeaderboard, nextSignals, nextAmlRequests, nextSupportRequests] = await Promise.all([
        fetchTradingAcademyLeaderboard(),
        fetchTradingSignals(),
        fetchUserAmlCheckRequests(user.id),
        fetchUserPremiumSupportRequests(user.id)
      ]);

      setLeaderboard(nextLeaderboard);
      setSignals(nextSignals);
      setAmlRequests(nextAmlRequests);
      setSupportRequests(nextSupportRequests);
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

  const submitSupport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || isSupportSubmitting) return;

    const subject = sanitizePlainText(supportForm.subject, 160);
    const message = sanitizePlainText(supportForm.message, 2000);

    if (!subject) {
      setSupportMessage("Subject is required.");
      return;
    }

    if (!message) {
      setSupportMessage("Message is required.");
      return;
    }

    setIsSupportSubmitting(true);
    setSupportMessage(null);

    try {
      await submitPremiumSupportRequest({
        userId: user.id,
        subject,
        message,
        category: supportForm.category,
        priority: supportForm.priority
      });
      setSupportForm(blankSupportForm);
      setSupportMessage("Premium support request submitted.");
      setSupportRequests(await fetchUserPremiumSupportRequests(user.id));
    } catch (submitError) {
      setSupportMessage(submitError instanceof Error ? submitError.message : "Support request could not be submitted.");
    } finally {
      setIsSupportSubmitting(false);
    }
  };

  const submitRiskCalculation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const calculation = calculateRisk({
      symbol: "Position",
      direction: riskForm.direction,
      accountBalance: numberFromInput(riskForm.accountBalance),
      riskPercent: numberFromInput(riskForm.riskPercent),
      entryPrice: numberFromInput(riskForm.entryPrice),
      stopLossPrice: numberFromInput(riskForm.stopLossPrice),
      takeProfitPrices: riskForm.takeProfits.map((takeProfit) => numberFromInput(takeProfit.price)),
      leverage: numberFromInput(riskForm.leverage),
      positionSizeMode: riskForm.positionSizeMode,
      manualPositionSize: numberFromInput(riskForm.manualPositionSize)
    });

    if (!calculation.ok) {
      setRiskResult(null);
      setRiskErrors(calculation.errors);
      return;
    }

    setRiskErrors([]);
    setRiskResult(calculation.result);
  };

  const updateRiskForm = (field: RiskCalculatorEditableField, value: string) => {
    setRiskForm((form) => ({ ...form, [field]: value }));
  };

  const updateRiskTakeProfit = (takeProfitId: string, price: string) => {
    setRiskForm((form) => ({
      ...form,
      takeProfits: form.takeProfits.map((takeProfit) =>
        takeProfit.id === takeProfitId ? { ...takeProfit, price } : takeProfit
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
                <h2>Top Academy learners</h2>
              </div>
              <Trophy size={28} aria-hidden="true" />
            </div>
            {leaderboard.length ? (
              <ol className="leaderboard-list">
                {visibleLeaderboard.map((row) => (
                  <li className={`leaderboard-row ${leaderboardRankTone(row.rank)}`} key={row.member_key}>
                    <span className="leaderboard-rank">#{row.rank}</span>
                    <LeaderboardAvatar row={row} />
                    <span>
                      <strong>{row.display_name}</strong>
                      <small>{row.total_xp} XP</small>
                    </span>
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
                <h2>Trading Signal by ASEKE TRADE</h2>
              </div>
              <LineChart size={28} aria-hidden="true" />
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
                <h2>Completed signal history</h2>
              </div>
              <Trophy size={28} aria-hidden="true" />
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
                  <p className="muted">Need help? Premium members can reach support directly on Telegram.</p>
                </div>
              </div>
              <div className="telegram-contact-grid" aria-label="Telegram support links">
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
                    <strong>Message Support</strong>
                    <small>@don_chrome</small>
                  </span>
                </a>
                <a
                  className="telegram-contact-link"
                  href="https://t.me/aseketrade"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Join the ASEKE TRADE Telegram group"
                >
                  <span className="telegram-icon-frame">
                    <TelegramIcon />
                  </span>
                  <span>
                    <strong>Join Community</strong>
                    <small>t.me/aseketrade</small>
                  </span>
                </a>
              </div>
              {supportMessage && <p className="soft-notice">{supportMessage}</p>}
              <form className="stack-form" onSubmit={submitSupport}>
                <label>
                  Subject
                  <input
                    value={supportForm.subject}
                    onChange={(event) => setSupportForm((form) => ({ ...form, subject: event.target.value }))}
                    maxLength={160}
                    required
                  />
                </label>
                <div className="form-row">
                  <label>
                    Category
                    <select
                      value={supportForm.category}
                      onChange={(event) => setSupportForm((form) => ({ ...form, category: event.target.value }))}
                    >
                      <option value="strategy">Strategy</option>
                      <option value="risk">Risk</option>
                      <option value="technical">Technical</option>
                      <option value="account">Account</option>
                    </select>
                  </label>
                  <label>
                    Priority
                    <select
                      value={supportForm.priority}
                      onChange={(event) =>
                        setSupportForm((form) => ({ ...form, priority: event.target.value as PremiumSupportPriority }))
                      }
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </label>
                </div>
                <label>
                  Message
                  <textarea
                    value={supportForm.message}
                    onChange={(event) => setSupportForm((form) => ({ ...form, message: event.target.value }))}
                    maxLength={2000}
                    rows={5}
                    required
                  />
                </label>
                <button className="primary-button" type="submit" disabled={isSupportSubmitting}>
                  <Send size={17} />
                  {isSupportSubmitting ? "Sending" : "Send Support Request"}
                </button>
              </form>
              <CompactSupportHistory requests={supportRequests} />
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
          <p className="eyebrow">Risk Calculator</p>
          <h2>Position plan</h2>
        </div>
        <Calculator size={28} aria-hidden="true" />
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
                  className={form.direction === "long" ? "active" : ""}
                  type="button"
                  onClick={() => onChange("direction", "long")}
                >
                  Long
                </button>
                <button
                  className={form.direction === "short" ? "active" : ""}
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

            <label className="risk-field-group">
              <span className="risk-field-label">Risk Per Trade</span>
              <span className="risk-prefixed-input">
                <span>%</span>
                <input
                  inputMode="decimal"
                  value={form.riskPercent}
                  onChange={(event) => onChange("riskPercent", event.target.value)}
                />
              </span>
            </label>

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
                Stop Loss
                <input
                  inputMode="decimal"
                  value={form.stopLossPrice}
                  onChange={(event) => onChange("stopLossPrice", event.target.value)}
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
            </div>

            <div className="risk-tp-editor">
              <div className="compact-panel-header">
                <h3>Take Profits</h3>
                <button className="ghost-button compact" type="button" onClick={addTakeProfit}>
                  <Plus size={16} />
                  Add TP
                </button>
              </div>
              <div className="risk-tp-input-list">
                {form.takeProfits.map((takeProfit, index) => (
                  <div className="risk-tp-input-row" key={takeProfit.id}>
                    <label>
                      TP{index + 1}
                      <input
                        inputMode="decimal"
                        value={takeProfit.price}
                        onChange={(event) => onTakeProfitChange(takeProfit.id, event.target.value)}
                      />
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

            <details className="risk-advanced-options">
              <summary>Advanced Options</summary>
              <div className="risk-form-grid">
                <label>
                  Size mode
                  <select
                    value={form.positionSizeMode}
                    onChange={(event) => onChange("positionSizeMode", event.target.value)}
                  >
                    <option value="auto">Auto size</option>
                    <option value="manual">Manual size</option>
                  </select>
                </label>
                {form.positionSizeMode === "manual" && (
                  <label>
                    Position size
                    <input
                      inputMode="decimal"
                      value={form.manualPositionSize}
                      onChange={(event) => onChange("manualPositionSize", event.target.value)}
                    />
                  </label>
                )}
              </div>
            </details>

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

  return (
    <article className="risk-result-panel">
      <p className="risk-start-line">{result ? `${result.direction.toUpperCase()} position plan` : "Enter Account Balance to start"}</p>

      <div className="risk-position-card">
        <span>Position Size</span>
        <strong>{result ? formatRiskNumber(result.positionSizeUnits) : "--"} coins</strong>
        <small>{result ? formatUsdAmount(result.notionalPositionValue) : "$--"} total value</small>
      </div>

      <dl className="risk-summary-list">
        <RiskMetricRow label="Risk Amount" value={result ? formatUsdAmount(result.riskAmount) : "$--"} />
        <RiskMetricRow
          label="Risk Distance"
          value={result ? `${formatUsdAmount(result.stopDistance)} (${formatPercentValue(result.stopDistancePercent)})` : "$-- (--)"}
        />
        <RiskMetricRow label="Position Value" value={result ? formatUsdAmount(result.notionalPositionValue) : "$--"} />
      </dl>

      <section className="risk-breakdown-card">
        <h3>
          <ShieldCheck size={17} />
          Risk Breakdown
        </h3>
        <dl className="risk-result-grid">
          <RiskMetricBox label="Account Risk" value={result ? formatPercentValue(result.accountRiskPercent) : "--%"} />
          <RiskMetricBox label="Position Risk" value={result ? formatPercentValue(result.positionRiskPercent) : "--%"} />
          <RiskMetricBox label="Margin Used" value={result ? formatPercentValue(result.marginUsedPercent) : "--%"} />
        </dl>
      </section>

      <section className="risk-assessment-card">
        <h3>
          <ShieldCheck size={17} />
          Risk Assessment
        </h3>
        <div className="risk-assessment-bar" aria-label="Risk assessment scale">
          <span className="risk-assessment-fill" style={{ width: `${assessment.positionPercent}%` }} />
          <span className="risk-assessment-marker" style={{ left: `${assessment.positionPercent}%` }} />
        </div>
        <div className="risk-assessment-scale">
          <span>0%</span>
          <span>2%</span>
          <span>5%</span>
          <span>10%+</span>
        </div>
        <strong>{assessment.valueLabel}</strong>
        <span>{assessment.label}</span>
      </section>

      {result && result.takeProfits.length > 0 && (
        <ul className="risk-tp-list">
          {result.takeProfits.map((takeProfit) => (
            <li className={takeProfit.profitAmount > 0 ? "positive" : "warning"} key={takeProfit.label}>
              <strong>
                {takeProfit.label}: {formatRiskNumber(takeProfit.price)}
              </strong>
              <span>
                {formatUsdAmount(takeProfit.profitAmount)} - {formatRiskNumber(takeProfit.riskReward)}R
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

function CompactSupportHistory({ requests }: { requests: PremiumSupportRequest[] }) {
  const recentRequests = requests.slice(0, 3);
  const olderRequests = requests.slice(3);

  return (
    <div className="compact-history-panel">
      <div className="compact-history-heading">
        <div>
          <p className="eyebrow">Recent support</p>
          <h3>Support history</h3>
        </div>
        <span>{requests.length} total</span>
      </div>

      {requests.length ? (
        <>
          <CompactSupportHistoryList requests={recentRequests} />
          {olderRequests.length > 0 && (
            <details className="compact-history-details">
              <summary>View all {requests.length} support requests</summary>
              <CompactSupportHistoryList requests={olderRequests} />
            </details>
          )}
        </>
      ) : (
        <p className="compact-history-empty">No premium support requests yet.</p>
      )}
    </div>
  );
}

function CompactSupportHistoryList({ requests }: { requests: PremiumSupportRequest[] }) {
  return (
    <ul className="compact-history-list">
      {requests.map((request) => (
        <li className="compact-history-row" key={request.id}>
          <div>
            <strong>{request.subject}</strong>
            <span>
              {request.status.replace("_", " ")} - {request.priority} - {formatDateTime(request.created_at)}
            </span>
            {request.admin_response && <small>{request.admin_response}</small>}
          </div>
          <span className="status-pill premium">{request.priority}</span>
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

function SignalLevel({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{formatSignalPrice(value)}</dd>
    </div>
  );
}

function SignalCard({ signal, showPastSummary = false }: { signal: TradingSignal; showPastSummary?: boolean }) {
  const original = signal.original_signal;
  const currentTakeProfits = getSignalTakeProfits(signal);
  const displayTakeProfits = original?.takeProfits?.length
    ? original.takeProfits.map((takeProfit, index) => mergeTakeProfitHitState(takeProfit, currentTakeProfits[index]))
    : currentTakeProfits;
  const updates = getSignalUpdates(signal);
  const title =
    original?.generatedTitle ||
    signal.generated_title ||
    signal.title ||
    generateSignalTitle(signal.direction, signal.leverage ?? 1);
  const direction = original?.direction ?? signal.direction;
  const leverage = original?.leverage ?? signal.leverage ?? 1;
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
            <SignalLevel label="Entry" value={original?.entryPrice ?? signal.entry_price} />
            <SignalLevel label="SL" value={original?.stopLoss ?? signal.stop_loss} />
            <SignalLevel label="Opened" value={formatDateTime(original?.createdAt ?? signal.created_at)} />
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

          {(original?.notes || signal.notes) && <p className="muted">{original?.notes ?? signal.notes}</p>}
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

function mergeTakeProfitHitState(
  originalTakeProfit: TradingSignalTakeProfit,
  currentTakeProfit: TradingSignalTakeProfit | undefined
): TradingSignalTakeProfit {
  return {
    ...originalTakeProfit,
    isHit: currentTakeProfit?.isHit ?? originalTakeProfit.isHit,
    hitAt: currentTakeProfit?.hitAt ?? originalTakeProfit.hitAt
  };
}

function numberFromInput(value: string): number {
  return Number(value.replace(/,/g, "").trim());
}

function getRiskAssessment(accountRiskPercent: number | null): {
  label: string;
  positionPercent: number;
  valueLabel: string;
} {
  if (accountRiskPercent === null || !Number.isFinite(accountRiskPercent)) {
    return { label: "CONSERVATIVE", positionPercent: 0, valueLabel: "--%" };
  }

  const positionPercent = Math.min(100, Math.max(0, (accountRiskPercent / 10) * 100));
  const label =
    accountRiskPercent <= 2
      ? "CONSERVATIVE"
      : accountRiskPercent <= 5
        ? "BALANCED"
        : accountRiskPercent <= 10
          ? "AGGRESSIVE"
          : "HIGH RISK";

  return {
    label,
    positionPercent,
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
  return `${formatRiskNumber(value)}%`;
}

function formatRiskNumber(value: number): string {
  if (!Number.isFinite(value)) return "N/A";

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 6
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
