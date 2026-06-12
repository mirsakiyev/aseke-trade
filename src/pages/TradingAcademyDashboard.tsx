import {
  Crown,
  Headphones,
  LineChart,
  Medal,
  RefreshCw,
  SearchCheck,
  Send,
  Trophy
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { useAccountStatus } from "../hooks/useAccountStatus";
import { formatUsd } from "../lib/accountStatus";
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
import { sanitizePlainText } from "../lib/validation";
import type {
  AmlCheckRequest,
  PremiumSupportPriority,
  PremiumSupportRequest,
  TradingAcademyLeaderboardRow,
  TradingSignal
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
                {leaderboard.map((row) => (
                  <li className={`leaderboard-row ${leaderboardRankTone(row.rank)}`} key={row.member_key}>
                    <span className="leaderboard-rank">#{row.rank}</span>
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
          </section>

          <section className="section-panel page-stack">
            <div className="lesson-title-line">
              <div>
                <p className="eyebrow">Trading Signals</p>
                <h2>Admin-posted market setups</h2>
              </div>
              <LineChart size={28} aria-hidden="true" />
            </div>
            {signals.length ? (
              <div className="signal-grid">
                {signals.map((signal) => (
                  <article className="signal-card" key={signal.id}>
                    {signal.chart_image_url ? (
                      <img className="signal-chart-image" src={signal.chart_image_url} alt="" />
                    ) : (
                      <div className="signal-chart-empty">Chart pending</div>
                    )}
                    <div className="signal-card-body">
                      <div className="lesson-title-line">
                        <div>
                          <p className="eyebrow">{signal.direction.toUpperCase()}</p>
                          <h3>{signal.title || signal.symbol}</h3>
                        </div>
                        <span className="status-pill premium">{signal.status.replace("_", " ")}</span>
                      </div>
                      <dl className="signal-level-grid">
                        <SignalLevel label="Entry" value={signal.entry_price} />
                        <SignalLevel label="SL" value={signal.stop_loss} />
                        <SignalLevel label="TP1" value={signal.take_profit_1} />
                        <SignalLevel label="TP2" value={signal.take_profit_2} />
                        <SignalLevel label="TP3" value={signal.take_profit_3} />
                        <SignalLevel label="Creation price" value={signal.price_at_creation} />
                      </dl>
                      {signal.notes && <p className="muted">{signal.notes}</p>}
                      <small className="muted">Posted {formatDateTime(signal.created_at)}</small>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No trading signals have been posted yet.</p>
            )}
          </section>

          <section className="dashboard-grid">
            <article className="section-panel stack-form">
              <span className="feature-icon">
                <SearchCheck size={21} />
              </span>
              <h2>Paid AML Check</h2>
              <p className="muted">Each request costs {formatUsd(AML_CHECK_PRICE_CENTS)} and is manually reviewed by admin.</p>
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
            </article>

            <article className="section-panel">
              <h2>AML check history</h2>
              {amlRequests.length ? (
                <ul className="plain-list">
                  {amlRequests.map((request) => (
                    <li key={request.id}>
                      <div>
                        <strong>{request.network} - {shortenAddress(request.address)}</strong>
                        <span>
                          {request.status.replace("_", " ")} - {formatDateTime(request.created_at)} -{" "}
                          {formatUsd(request.amount_charged_cents)}
                        </span>
                        {(request.admin_result || request.admin_notes) && (
                          <span>{request.admin_result ?? request.admin_notes}</span>
                        )}
                      </div>
                      <span className="status-pill free">{request.status.replace("_", " ")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No AML check history yet.</p>
              )}
            </article>
          </section>

          <section className="dashboard-grid">
            <article className="section-panel stack-form">
              <span className="feature-icon">
                <Headphones size={21} />
              </span>
              <h2>Premium Support</h2>
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
            </article>

            <article className="section-panel">
              <h2>Support history</h2>
              {supportRequests.length ? (
                <ul className="plain-list">
                  {supportRequests.map((request) => (
                    <li key={request.id}>
                      <div>
                        <strong>{request.subject}</strong>
                        <span>
                          {request.status.replace("_", " ")} - {request.priority} - {formatDateTime(request.created_at)}
                        </span>
                        {request.admin_response && <span>{request.admin_response}</span>}
                      </div>
                      <Medal size={18} aria-hidden="true" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No premium support requests yet.</p>
              )}
            </article>
          </section>
        </>
      )}
    </main>
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

function formatSignalPrice(value: string | number): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value);

  return numericValue.toLocaleString("en-US", {
    maximumFractionDigits: 10
  });
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
