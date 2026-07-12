import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Clock3,
  Database,
  ExternalLink,
  Play,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FuturesCandlestickChart,
  type FuturesChartOverlayLine,
  type FuturesChartOverlayZone
} from "../components/FuturesCandlestickChart";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { AI_FUTURES_RISK_PRESETS } from "../lib/aiFuturesConfig";
import { fetchAiRiskProfile, requestAiFuturesAnalysis } from "../lib/aiFuturesApi";
import type {
  AiAnalysisResponse,
  AiFuturesTimeframe,
  AiRiskProfileInput,
  AiScoreBreakdown,
  AiScoreWeights
} from "../lib/aiFuturesTypes";

const defaultProfile: AiRiskProfileInput = {
  preset: "balanced",
  planningBalance: "1000",
  riskPercent: AI_FUTURES_RISK_PRESETS.balanced.riskPercent,
  maxLeverage: AI_FUTURES_RISK_PRESETS.balanced.maxLeverage,
  maxMarginPercent: AI_FUTURES_RISK_PRESETS.balanced.maxMarginPercent,
  saveProfile: false
};

const timeframeOptions: Array<{ value: AiFuturesTimeframe; label: string }> = [
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" }
];

export function AiFuturesAnalyst() {
  const { profile, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [riskProfile, setRiskProfile] = useState<AiRiskProfileInput>(defaultProfile);
  const [analysis, setAnalysis] = useState<AiAnalysisResponse | null>(null);
  const [timeframe, setTimeframe] = useState<AiFuturesTimeframe>("15m");
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchAiRiskProfile().then((saved) => {
      if (active && saved) setRiskProfile(saved);
    }).finally(() => {
      if (active) setIsLoadingProfile(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (isAdmin || !profile?.premium_until) return;
    const remaining = Date.parse(profile.premium_until) - Date.now();
    if (remaining <= 0) {
      setAnalysis(null);
      navigate("/trading-academy", { replace: true });
      return;
    }
    const timeout = window.setTimeout(() => {
      setAnalysis(null);
      navigate("/trading-academy", { replace: true });
    }, Math.min(remaining, 2_147_000_000));
    return () => window.clearTimeout(timeout);
  }, [isAdmin, navigate, profile?.premium_until]);

  const updatePreset = (preset: Exclude<AiRiskProfileInput["preset"], "custom">) => {
    const values = AI_FUTURES_RISK_PRESETS[preset];
    setRiskProfile((current) => ({
      ...current,
      preset,
      riskPercent: values.riskPercent,
      maxLeverage: values.maxLeverage,
      maxMarginPercent: values.maxMarginPercent
    }));
  };

  const analyze = async () => {
    if (isAnalyzing) return;
    const profileError = validateRiskDraft(riskProfile);
    if (profileError) {
      setAnalysis(null);
      setError(profileError);
      return;
    }
    setIsAnalyzing(true);
    setAnalysis(null);
    setError(null);
    try {
      setAnalysis(await requestAiFuturesAnalysis(riskProfile));
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "AI Futures analysis is unavailable.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const chartCandles = useMemo(
    () => (analysis?.candles?.[timeframe] ?? []).map((candle) => ({
      timestamp: candle.openTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume
    })),
    [analysis, timeframe]
  );
  const chartLines = useMemo<FuturesChartOverlayLine[]>(() => {
    const candidate = analysis?.candidate;
    if (!candidate?.direction || !candidate.stopLoss) return [];
    const direction = candidate.direction;
    return [
      { id: "ai-stop", label: "SL", price: candidate.stopLoss, tone: "danger", side: direction },
      ...(candidate.invalidationLevel && candidate.invalidationLevel !== candidate.stopLoss
        ? [{ id: "ai-invalidation", label: "Invalidation", price: candidate.invalidationLevel, tone: "invalidation" as const }]
        : []),
      ...candidate.takeProfits.map((target) => ({
        id: target.label,
        label: `${target.label} ${target.positionSizePercent}%`,
        price: target.price,
        tone: "target" as const,
        side: direction
      }))
    ];
  }, [analysis]);
  const chartZones = useMemo<FuturesChartOverlayZone[]>(() => {
    const entry = analysis?.candidate?.entryZone;
    return entry ? [{ id: "ai-entry-zone", label: "Entry zone", lowPrice: entry.low, highPrice: entry.high, tone: "entry" }] : [];
  }, [analysis]);

  return (
    <main className="page page-stack ai-futures-page">
      <section className="page-title-row compact-title-row ai-futures-hero">
        <div>
          <p className="eyebrow">Trading Academy · AI Futures Analyst</p>
          <h1><BrainCircuit size={38} aria-hidden="true" /> BTCUSDT futures analysis</h1>
          <p className="muted">
            Closed-candle technical analysis, Binance USD-M positioning, contextual sentiment, and deterministic risk planning.
          </p>
        </div>
        <Link className="ghost-button compact" to="/trading-academy/dashboard">Academy dashboard</Link>
      </section>

      <section className="ai-futures-control-grid">
        <article className="section-panel no-hover-effect ai-risk-profile-card">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Risk profile</p>
              <h2>Planning assumptions</h2>
            </div>
            <ShieldAlert size={24} aria-hidden="true" />
          </div>
          {isLoadingProfile ? <LoadingState label="Loading risk profile" /> : (
            <div className="stack-form">
              <div className="ai-risk-presets" role="group" aria-label="Risk model">
                {(["conservative", "balanced", "aggressive"] as const).map((preset) => (
                  <button
                    className={riskProfile.preset === preset ? "filter-pill active" : "filter-pill"}
                    type="button"
                    onClick={() => updatePreset(preset)}
                    key={preset}
                  >
                    {capitalize(preset)}
                  </button>
                ))}
                <button
                  className={riskProfile.preset === "custom" ? "filter-pill active" : "filter-pill"}
                  type="button"
                  onClick={() => setRiskProfile((current) => ({ ...current, preset: "custom" }))}
                >Custom</button>
              </div>
              <label>
                Planning Balance (USDT)
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max="10000000"
                  step="0.01"
                  value={riskProfile.planningBalance}
                  onChange={(event) => setRiskProfile((current) => ({ ...current, planningBalance: event.target.value }))}
                />
                <small>Planning only. ASEKE TRADE does not hold or control exchange funds.</small>
              </label>
              <div className="form-row">
                <label>
                  Risk per trade (%)
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.1"
                    max="3"
                    step="0.1"
                    disabled={riskProfile.preset !== "custom"}
                    value={riskProfile.riskPercent}
                    onChange={(event) => setRiskProfile((current) => ({ ...current, riskPercent: event.target.value }))}
                  />
                </label>
                <label>
                  Maximum leverage
                  <input
                    type="number"
                    min={1}
                    max={10}
                    disabled={riskProfile.preset !== "custom"}
                    value={riskProfile.maxLeverage}
                    onChange={(event) => setRiskProfile((current) => ({ ...current, maxLeverage: Number(event.target.value) }))}
                  />
                </label>
              </div>
              <label>
                Maximum balance allocated as margin (%)
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  max="50"
                  step="0.1"
                  disabled={riskProfile.preset !== "custom"}
                  value={riskProfile.maxMarginPercent}
                  onChange={(event) => setRiskProfile((current) => ({ ...current, maxMarginPercent: event.target.value }))}
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={riskProfile.saveProfile}
                  onChange={(event) => setRiskProfile((current) => ({ ...current, saveProfile: event.target.checked }))}
                />
                Save this risk profile to my account
              </label>
              <button className="primary-button full-width" type="button" onClick={() => void analyze()} disabled={isAnalyzing}>
                <RefreshCw size={17} className={isAnalyzing ? "spin" : ""} />
                {isAnalyzing ? "Analyzing closed market data" : "Analyze BTCUSDT"}
              </button>
            </div>
          )}
        </article>

        <article className="section-panel no-hover-effect ai-analysis-method-card">
          <p className="eyebrow">V1 analysis profile</p>
          <h2>Intraday · isolated margin</h2>
          <dl className="ai-method-list">
            <Metric label="Market" value="Binance USD-M BTCUSDT perpetual" />
            <Metric label="Entry timeframe" value="15-minute closed candles" />
            <Metric label="Context" value="1-hour and 4-hour" />
            <Metric label="Execution" value="Educational plan only" />
          </dl>
          <div className="soft-notice">
            The engine is designed to return <strong>NO_TRADE</strong> when confluence, freshness, or risk constraints are insufficient.
          </div>
        </article>
      </section>

      {error && <p className="warning-box" role="alert">{error}</p>}
      {isAnalyzing && <LoadingState label="Calculating indicators and validating the setup" />}

      <section className="section-panel no-hover-effect ai-futures-chart-panel">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Read-only futures chart</p>
            <h2>BTCUSDT market snapshot</h2>
          </div>
          {analysis && <span className="status-pill">{analysis.source}</span>}
        </div>
        <FuturesCandlestickChart
          candles={chartCandles}
          currentPrice={analysis?.currentPrice ?? null}
          timeframe={timeframe}
          timeframeOptions={timeframeOptions}
          onTimeframeChange={setTimeframe}
          overlayLines={chartLines}
          overlayZones={chartZones}
          isLoading={isAnalyzing}
          error={error}
          emptyLabel={analysis?.status === "NO_TRADE" ? "No setup overlay" : "Run market analysis"}
          emptyDescription="A protected Binance USD-M snapshot will appear after a successful analysis."
          currentPriceLabel="Mark"
          readOnly
          className="ai-futures-chart"
        />
        {analysis?.candidate && (
          <dl className="ai-chart-context" aria-label="Setup chart context">
            <Metric label="Direction" value={analysis.candidate.direction?.toUpperCase() ?? "No directional setup"} />
            <Metric label="Setup created" value={formatDate(analysis.candidate.createdAt)} />
            <Metric label="Setup expires" value={formatDate(analysis.candidate.expiresAt)} />
          </dl>
        )}
      </section>

      {analysis && <AnalysisResult analysis={analysis} onPractice={(planId) => navigate(`/demo-trade?aiPlan=${encodeURIComponent(planId)}`)} />}

      <section className="warning-box ai-risk-disclosure">
        <AlertTriangle size={22} aria-hidden="true" />
        <div>
          <strong>Educational analysis only. Not financial advice.</strong>
          <p>Futures and leverage can cause rapid or total loss. Verify all prices, fees, leverage and liquidation information with your exchange.</p>
        </div>
      </section>
    </main>
  );
}

function AnalysisResult({ analysis, onPractice }: { analysis: AiAnalysisResponse; onPractice: (planId: string) => void }) {
  const candidate = analysis.candidate;
  const isDirectional = analysis.status === "LONG_SETUP" || analysis.status === "SHORT_SETUP" || analysis.status === "WAIT_FOR_ENTRY";
  const directionIcon = candidate?.direction === "long" ? <TrendingUp /> : candidate?.direction === "short" ? <TrendingDown /> : <Activity />;
  const canPractice = (analysis.status === "LONG_SETUP" || analysis.status === "SHORT_SETUP") && Boolean(analysis.plan?.id);
  const entryDistance = candidate?.entryZone && analysis.currentPrice !== null
    ? distanceFromZone(analysis.currentPrice, candidate.entryZone)
    : null;
  return (
    <div className="page-stack ai-analysis-results" aria-live="polite">
      <section className={`section-panel no-hover-effect ai-verdict-card verdict-${analysis.status.toLowerCase()}`}>
        <div className="ai-verdict-heading">
          <div className="ai-verdict-icon">{directionIcon}</div>
          <div>
            <p className="eyebrow">Current verdict</p>
            <h2>{formatStatus(analysis.status)}</h2>
            <p>{analysis.message}</p>
          </div>
          {candidate && (
            <div className="ai-quality-score" aria-label={`Setup Quality ${candidate.qualityScore} out of 100`}>
              <span>Setup Quality</span>
              <strong>{candidate.qualityScore}/100</strong>
            </div>
          )}
        </div>
        {analysis.deterministicOnly && <p className="soft-notice">Deterministic-only result: independent AI review was not used.</p>}
        {canPractice && (
          <button className="primary-button" type="button" onClick={() => onPractice(analysis.plan!.id!)}>
            <Play size={17} /> Practice in Demo Trade
          </button>
        )}
      </section>

      {isDirectional && candidate?.entryZone && candidate.stopLoss && (
        <section className="ai-result-grid">
          <article className="section-panel no-hover-effect">
            <p className="eyebrow">Levels</p>
            <h2>Entry, stop and exits</h2>
            <div className="table-scroll">
              <table className="ai-levels-table">
                <thead><tr><th>Level</th><th>Price</th><th>Allocation</th><th>R multiple</th></tr></thead>
                <tbody>
                  <tr><td>Entry zone</td><td>{formatPrice(candidate.entryZone.low)}–{formatPrice(candidate.entryZone.high)}</td><td>Review first</td><td>—</td></tr>
                  <tr><td>Stop loss</td><td>{formatPrice(candidate.stopLoss)}</td><td>100% remaining</td><td>-1R</td></tr>
                  {candidate.takeProfits.map((target) => (
                    <tr key={target.label}><td>{target.label}</td><td>{formatPrice(target.price)}</td><td>{target.positionSizePercent}%</td><td>{target.rMultiple}R</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">Weighted projected reward-to-risk: {candidate.projectedRewardRisk?.toFixed(2) ?? "—"}</p>
            {analysis.status === "WAIT_FOR_ENTRY" && (
              <div className="soft-notice">
                <strong>Activation required</strong>
                {entryDistance && <p>Current distance from the preferred entry zone: {formatPrice(entryDistance.amount)} ({entryDistance.percent.toFixed(2)}%). Setup expires {formatDate(candidate.expiresAt)}.</p>}
                <ul>{candidate.activationConditions.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
          </article>
          <PositionPlan analysis={analysis} />
        </section>
      )}

      {candidate && (
        <section className="ai-result-grid">
          <article className="section-panel no-hover-effect">
            <p className="eyebrow">Confluence score</p>
            <h2>Setup Quality breakdown</h2>
            <QualityBreakdown score={candidate.scoreBreakdown} weights={analysis.scoreWeights} />
            <p className="muted">This is a confluence score, not a probability of profit.</p>
          </article>
          <article className="section-panel no-hover-effect">
            <p className="eyebrow">Market context</p>
            <h2>{candidate.marketRegime.replace(/_/g, " ")}</h2>
            <dl className="ai-method-list">
              <Metric label="Long score" value={`${candidate.longScore.total}/100`} />
              <Metric label="Short score" value={`${candidate.shortScore.total}/100`} />
              <Metric label="Setup created" value={formatDate(candidate.createdAt)} />
              <Metric label="Entry expires" value={formatDate(candidate.expiresAt)} />
            </dl>
          </article>
        </section>
      )}

      <section className="ai-evidence-grid">
        <EvidenceCard title="Supporting evidence" items={analysis.review?.supporting_factors ?? candidate?.supportingEvidence ?? []} tone="support" />
        <EvidenceCard title="Conflicting evidence" items={analysis.review?.conflicting_factors ?? candidate?.conflictingEvidence ?? []} tone="conflict" />
        <EvidenceCard title="Invalidation" items={candidate?.invalidationConditions ?? candidate?.reasons ?? []} tone="neutral" />
      </section>

      {analysis.review && (
        <section className="section-panel no-hover-effect">
          <p className="eyebrow">Why this setup?</p>
          <h2>{analysis.review.primary_thesis}</h2>
          <p>{analysis.review.market_summary}</p>
          <p>{analysis.review.educational_explanation}</p>
          <div className="soft-notice"><strong>Independent risk notes</strong><ul>{analysis.review.risk_notes.map((note) => <li key={note}>{note}</li>)}</ul></div>
        </section>
      )}

      <FreshnessPanel analysis={analysis} />
    </div>
  );
}

function PositionPlan({ analysis }: { analysis: AiAnalysisResponse }) {
  const plan = analysis.plan;
  return (
    <article className="section-panel no-hover-effect">
      <p className="eyebrow">Personalized plan</p>
      <h2>Isolated-margin sizing</h2>
      {plan ? (
        <dl className="ai-plan-grid">
          <Metric label="Quantity" value={`${plan.quantity} BTC`} />
          <Metric label="Notional" value={formatUsdt(plan.notional)} />
          <Metric label="Leverage" value={`${plan.leverage}x`} />
          <Metric label="Required margin" value={formatUsdt(plan.requiredMargin)} />
          <Metric label="Maximum planned loss" value={formatUsdt(plan.plannedMaximumLoss)} />
          <Metric label="Risk budget" value={formatUsdt(plan.riskBudget)} />
          <Metric label="Estimated liquidation" value={plan.estimatedLiquidation === "unavailable" ? "Unavailable" : `≈ ${formatPrice(Number(plan.estimatedLiquidation))}`} />
          <Metric label="Margin allocation" value={`${plan.marginPercent}%`} />
        </dl>
      ) : <p className="muted">No executable position fits the selected risk limits.</p>}
      {plan?.warnings.map((warning) => <p className="muted" key={warning}>{warning}</p>)}
    </article>
  );
}

function QualityBreakdown({ score, weights }: { score: AiScoreBreakdown; weights: AiScoreWeights }) {
  const rows: Array<[string, number, number]> = [
    ["Multi-timeframe trend", score.multiTimeframeTrend, weights.multiTimeframeTrend],
    ["Market structure", score.marketStructure, weights.marketStructure],
    ["Momentum", score.momentum, weights.momentum],
    ["Volume & volatility", score.volumeVolatility, weights.volumeVolatility],
    ["Futures positioning", score.futuresPositioning, weights.futuresPositioning],
    ["Contextual sentiment", score.sentiment, weights.sentiment],
    ["Entry quality & R:R", score.entryQuality, weights.entryQuality]
  ];
  return <div className="ai-quality-list">{rows.map(([label, value, maximum]) => (
    <div className="ai-quality-row" key={label}>
      <span>{label}</span><meter min={0} max={maximum} value={value}>{value}/{maximum}</meter><strong>{value}/{maximum}</strong>
    </div>
  ))}</div>;
}

function EvidenceCard({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return <article className={`section-panel no-hover-effect ai-evidence-card ${tone}`}><h3>{title}</h3>{items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">No additional items.</p>}</article>;
}

function FreshnessPanel({ analysis }: { analysis: AiAnalysisResponse }) {
  return (
    <section className="section-panel no-hover-effect">
      <div className="section-heading compact-heading">
        <div><p className="eyebrow">Sources and freshness</p><h2>Market-data audit</h2></div><Database size={24} />
      </div>
      <div className="table-scroll"><table className="ai-levels-table"><thead><tr><th>Category</th><th>Source</th><th>Source time</th><th>Freshness</th></tr></thead><tbody>
        {analysis.freshness.map((item) => <tr key={item.category}><td>{item.category.replace(/_/g, " ")}</td><td>{item.source}</td><td>{formatDate(item.sourceAt)}</td><td><span className={item.stale ? "status-pill negative" : "status-pill positive"}>{item.stale ? "Stale" : `${Math.round(item.ageSeconds)}s old`}</span></td></tr>)}
      </tbody></table></div>
      <p className="muted"><Clock3 size={15} /> Analysis generated {formatDate(analysis.analysisTimestamp)} from candle data closed {analysis.dataTimestamp ? formatDate(analysis.dataTimestamp) : "unavailable"}.</p>
      <a href={analysis.sentimentAttribution.url} target="_blank" rel="noreferrer">{analysis.sentimentAttribution.label} <ExternalLink size={14} /></a>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function formatStatus(status: string) { return status.replace(/_/g, " "); }
function formatPrice(value: number) { return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }); }
function formatUsdt(value: string) { return `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT`; }
function formatDate(value: string) { return new Date(value).toLocaleString(); }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function validateRiskDraft(profile: AiRiskProfileInput): string | null {
  const balance = Number(profile.planningBalance);
  const risk = Number(profile.riskPercent);
  const margin = Number(profile.maxMarginPercent);
  if (!Number.isFinite(balance) || balance <= 0 || balance > 10_000_000) return "Planning Balance must be greater than zero and no more than 10,000,000 USDT.";
  if (!Number.isFinite(risk) || risk <= 0 || risk > 3) return "Risk per trade must be greater than zero and no more than 3%.";
  if (!Number.isInteger(profile.maxLeverage) || profile.maxLeverage < 1 || profile.maxLeverage > 10) return "Maximum leverage must be a whole number from 1 to 10.";
  if (!Number.isFinite(margin) || margin <= 0 || margin > 50) return "Maximum margin allocation must be greater than zero and no more than 50%.";
  return null;
}
function distanceFromZone(price: number, zone: { low: number; high: number }) {
  const amount = price < zone.low ? zone.low - price : price > zone.high ? price - zone.high : 0;
  return { amount, percent: price > 0 ? (amount / price) * 100 : 0 };
}
