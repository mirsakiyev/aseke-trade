import { Activity, BrainCircuit, MessageSquarePlus, RefreshCw, Save, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import {
  appendAiSetupAdminNote,
  createAiAdminConfig,
  fetchAiAdminData,
  type AiAdminConfig
} from "../lib/aiFuturesApi";

type AdminData = Awaited<ReturnType<typeof fetchAiAdminData>>;
type AdminTab = "overview" | "configuration" | "failures" | "history" | "snapshot";

export function AdminAiFuturesAnalyst() {
  const [data, setData] = useState<AdminData | null>(null);
  const [draft, setDraft] = useState<AiAdminConfig | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [reason, setReason] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [noteSetupId, setNoteSetupId] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async (clearMessage = true) => {
    setIsLoading(true);
    if (clearMessage) setMessage(null);
    try {
      const next = await fetchAiAdminData();
      setData(next);
      setDraft(next.configs[0] ?? null);
      setSelectedSnapshotId((current) => current || String(next.snapshots[0]?.id ?? ""));
      setNoteSetupId((current) => current || String(next.setups[0]?.id ?? ""));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI Futures monitoring data could not be loaded.");
    } finally { setIsLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveConfiguration = async () => {
    if (!draft || !data?.configs[0]) return;
    if (!reason.trim()) { setMessage("A configuration change reason is required."); return; }
    const current = data.configs[0];
    const safetyChanged = current.feature_enabled !== draft.feature_enabled ||
      current.shadow_mode !== draft.shadow_mode || current.ai_calls_enabled !== draft.ai_calls_enabled ||
      current.emergency_kill_switch !== draft.emergency_kill_switch;
    if (safetyChanged && !window.confirm("Create a new immutable AI Futures configuration version with these safety-state changes?")) return;
    setIsSaving(true);
    setMessage(null);
    try {
      await createAiAdminConfig(current, draft, reason.trim());
      setReason("");
      setMessage("A new AI Futures configuration version was created.");
      await refresh(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI Futures configuration could not be saved.");
    } finally { setIsSaving(false); }
  };

  const appendNote = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setMessage(null);
    try {
      await appendAiSetupAdminNote(noteSetupId, adminNote);
      setAdminNote("");
      setMessage("The correction note was appended without changing the original setup.");
      await refresh(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The admin note could not be appended.");
    } finally { setIsSaving(false); }
  };

  if (isLoading && !data) return <LoadingState label="Loading AI Futures monitoring" />;
  const config = data?.configs[0] ?? null;
  const failures = [
    ...(data?.runs.filter((row) => ["failed", "partial"].includes(String(row.status))) ?? []),
    ...(data?.providerEvents.filter((row) => row.status !== "success") ?? []),
    ...(data?.modelLogs.filter((row) => row.status !== "success") ?? [])
  ];
  const metrics = calculateMonitoringMetrics(data);
  const performanceSlices = calculatePerformanceSlices(data);
  const weightTotal = draft ? Object.values(draft.score_weights).reduce((sum, value) => sum + Number(value), 0) : 0;
  const selectedSnapshot = data?.snapshots.find((row) => row.id === selectedSnapshotId) ?? null;

  return (
    <main className="page page-stack admin-ai-page">
      <section className="page-title-row compact-title-row">
        <div><p className="eyebrow">Admin · AI Futures Analyst</p><h1><BrainCircuit size={34} /> Monitoring and controls</h1><p className="muted">Versioned safety controls, provider health, immutable setup history, and shadow outcomes.</p></div>
        <div className="inline-actions"><Link className="ghost-button compact" to="/admin/trading-academy">Trading Academy admin</Link><button className="ghost-button compact" type="button" onClick={() => void refresh()}><RefreshCw size={16} />Refresh</button></div>
      </section>
      {message && <p className="warning-box">{message}</p>}
      <div className="tab-bar" role="tablist">
        {(["overview", "configuration", "failures", "history", "snapshot"] as const).map((tab) => <button className={activeTab === tab ? "active" : ""} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} key={tab}>{capitalize(tab)}</button>)}
      </div>

      {activeTab === "overview" && config && (<>
        <section className="dashboard-grid">
          <StatusCard label="Feature" value={config.feature_enabled ? "Enabled" : "Disabled"} good={config.feature_enabled} />
          <StatusCard label="Mode" value={config.shadow_mode ? "Shadow" : "Academy live"} good={config.shadow_mode} />
          <StatusCard label="AI calls" value={config.ai_calls_enabled ? "Enabled" : "Disabled"} good={config.ai_calls_enabled} />
          <StatusCard label="Kill switch" value={config.emergency_kill_switch ? "ACTIVE" : "Clear"} good={!config.emergency_kill_switch} />
          <StatusCard label="Provider events" value={String(data?.providerEvents.length ?? 0)} good={(data?.providerEvents.filter((row) => row.status !== "success").length ?? 0) === 0} />
          <StatusCard label="Generated setups" value={String(data?.setups.length ?? 0)} good />
          <StatusCard label="Entry trigger rate" value={metrics.entryTriggerRate} good={metrics.enteredCount > 0} />
          <StatusCard label="Completed win rate" value={metrics.winRate} good={metrics.wins >= metrics.losses} />
          <StatusCard label="Average win" value={metrics.averageWin} good={metrics.averageWinValue > 0} />
          <StatusCard label="Average loss" value={metrics.averageLoss} good={metrics.averageLossValue >= -1} />
          <StatusCard label="Expectancy after costs" value={metrics.expectancy} good={metrics.expectancyValue >= 0} />
          <StatusCard label="TP hit rate" value={metrics.takeProfitRate} good={metrics.takeProfitCount > 0} />
          <StatusCard label="No-trade frequency" value={metrics.noTradeRate} good />
          <StatusCard label="Provider failure rate" value={metrics.providerFailureRate} good={metrics.providerFailureCount === 0} />
          <article className="section-panel no-hover-effect"><p className="eyebrow">Versions</p><h2>{config.model_name}</h2><p>Engine: {config.engine_version}</p><p>Features: {config.feature_version}</p><p>Prompt: {config.prompt_version}</p><p className="muted">Config v{config.version} · {new Date(config.created_at).toLocaleString()}</p></article>
          <article className="section-panel no-hover-effect"><p className="eyebrow">Outcome coverage</p><h2>{data?.outcomes.length ?? 0} tracked setups</h2><p>{data?.outcomes.filter((row) => ["tp_hit", "sl_hit", "expired", "invalidated"].includes(String(row.status))).length ?? 0} complete outcomes</p><p className="muted">Losses and expirations remain in immutable history.</p></article>
        </section>
        <section className="ai-result-grid">
          <RecordTable title="Performance by market regime" rows={performanceSlices.byRegime} empty="No completed regime results." />
          <RecordTable title="Performance by Setup Quality" rows={performanceSlices.byQuality} empty="No completed quality-band results." />
        </section>
        <RecordTable title="Take-profit hit rates" rows={performanceSlices.takeProfits} empty="No entered setup outcomes." />
      </>)}

      {activeTab === "configuration" && draft && (
        <section className="section-panel stack-form no-hover-effect admin-ai-config-form">
          <div className="section-heading"><div><p className="eyebrow">Versioned configuration</p><h2>Safety and scoring</h2></div><ShieldAlert /></div>
          <div className="admin-ai-switch-grid">
            <BooleanControl label="Feature enabled" checked={draft.feature_enabled} onChange={(value) => setDraft({ ...draft, feature_enabled: value })} />
            <BooleanControl label="Shadow mode" checked={draft.shadow_mode} onChange={(value) => setDraft({ ...draft, shadow_mode: value })} />
            <BooleanControl label="AI calls enabled" checked={draft.ai_calls_enabled} onChange={(value) => setDraft({ ...draft, ai_calls_enabled: value })} />
            <BooleanControl label="Allow deterministic only" checked={draft.allow_deterministic_only} onChange={(value) => setDraft({ ...draft, allow_deterministic_only: value })} />
            <BooleanControl label="Emergency kill switch" checked={draft.emergency_kill_switch} onChange={(value) => setDraft({ ...draft, emergency_kill_switch: value })} danger />
          </div>
          <label>Configured symbols<input value={draft.configured_symbols.join(", ")} onChange={(event) => setDraft({ ...draft, configured_symbols: event.target.value.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean) })} /><small>V1 analysis supports BTCUSDT only. Symbols are versioned for future provider profiles.</small></label>
          <div className="form-row"><NumberControl label="Minimum Setup Quality" value={draft.minimum_setup_score} onChange={(value) => setDraft({ ...draft, minimum_setup_score: value })} /><NumberControl label="Minimum score difference" value={draft.minimum_score_difference} onChange={(value) => setDraft({ ...draft, minimum_score_difference: value })} /><NumberControl label="Minimum reward-to-risk" value={draft.minimum_reward_risk} step="0.1" onChange={(value) => setDraft({ ...draft, minimum_reward_risk: value })} /></div>
          <div className="form-row"><NumberControl label="Maximum custom risk %" value={draft.maximum_custom_risk_percent} step="0.1" onChange={(value) => setDraft({ ...draft, maximum_custom_risk_percent: value })} /><NumberControl label="Maximum leverage" value={draft.maximum_leverage} onChange={(value) => setDraft({ ...draft, maximum_leverage: value })} /><NumberControl label="Maximum margin %" value={draft.maximum_margin_percent} onChange={(value) => setDraft({ ...draft, maximum_margin_percent: value })} /></div>
          <h3>Freshness limits</h3><div className="admin-ai-weight-grid"><NumberControl label="15m candle seconds" value={draft.candle_stale_after_seconds} onChange={(value) => setDraft({ ...draft, candle_stale_after_seconds: value })} /><NumberControl label="Live mark seconds" value={draft.live_price_stale_after_seconds} onChange={(value) => setDraft({ ...draft, live_price_stale_after_seconds: value })} /><NumberControl label="Futures metrics seconds" value={draft.futures_metrics_stale_after_seconds} onChange={(value) => setDraft({ ...draft, futures_metrics_stale_after_seconds: value })} /><NumberControl label="Sentiment seconds" value={draft.sentiment_stale_after_seconds} onChange={(value) => setDraft({ ...draft, sentiment_stale_after_seconds: value })} /></div>
          <h3>Rate, lease and provider controls</h3><div className="admin-ai-weight-grid"><NumberControl label="Requests per minute" value={draft.per_user_requests_per_minute} onChange={(value) => setDraft({ ...draft, per_user_requests_per_minute: value })} /><NumberControl label="Minimum refresh seconds" value={draft.per_user_min_refresh_seconds} onChange={(value) => setDraft({ ...draft, per_user_min_refresh_seconds: value })} /><NumberControl label="Generation lease seconds" value={draft.generation_lease_seconds} onChange={(value) => setDraft({ ...draft, generation_lease_seconds: value })} /><NumberControl label="Maximum generation attempts" value={draft.maximum_generation_attempts} onChange={(value) => setDraft({ ...draft, maximum_generation_attempts: value })} /><NumberControl label="Provider timeout ms" value={draft.provider_timeout_ms} onChange={(value) => setDraft({ ...draft, provider_timeout_ms: value })} /><NumberControl label="Provider retry count" value={draft.provider_retry_count} onChange={(value) => setDraft({ ...draft, provider_retry_count: value })} /></div>
          <h3>Score weights <span className={Math.abs(weightTotal - 100) < 0.000001 ? "status-pill positive" : "status-pill negative"}>{weightTotal}/100</span></h3><div className="admin-ai-weight-grid">{Object.entries(draft.score_weights).map(([key, value]) => <NumberControl label={key.replace(/_/g, " ")} value={value} onChange={(next) => setDraft({ ...draft, score_weights: { ...draft.score_weights, [key]: next } })} key={key} />)}</div>
          <div className="form-row"><label>Model<input value={draft.model_name} onChange={(event) => setDraft({ ...draft, model_name: event.target.value })} /></label><label>Prompt version<input value={draft.prompt_version} onChange={(event) => setDraft({ ...draft, prompt_version: event.target.value })} /></label><label>Engine version<input value={draft.engine_version} onChange={(event) => setDraft({ ...draft, engine_version: event.target.value })} /></label><label>Feature version<input value={draft.feature_version} onChange={(event) => setDraft({ ...draft, feature_version: event.target.value })} /></label></div>
          <label>Required change reason<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button className="primary-button" type="button" disabled={isSaving || Math.abs(weightTotal - 100) > 0.000001} onClick={() => void saveConfiguration()}><Save size={17} />{isSaving ? "Creating version" : "Create configuration version"}</button>
        </section>
      )}

      {activeTab === "failures" && <RecordTable title="Recent pipeline and provider failures" rows={failures} empty="No recent failures recorded." />}
      {activeTab === "history" && <>
        <section className="section-panel stack-form no-hover-effect">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Append-only correction</p><h2>Add a timestamped setup note</h2></div><MessageSquarePlus /></div>
          <label>Historical setup<select value={noteSetupId} onChange={(event) => setNoteSetupId(event.target.value)}><option value="">Select a setup</option>{data?.setups.map((setup) => <option value={String(setup.id)} key={String(setup.id)}>{String(setup.verdict ?? "Pending")} · {new Date(String(setup.created_at)).toLocaleString()}</option>)}</select></label>
          <label>Correction or review note<textarea rows={4} maxLength={4000} value={adminNote} onChange={(event) => setAdminNote(event.target.value)} placeholder="Explain the correction without rewriting the original prediction." /></label>
          <button className="primary-button" type="button" disabled={isSaving || !noteSetupId || !adminNote.trim()} onClick={() => void appendNote()}><MessageSquarePlus size={17} />Append note</button>
        </section>
        <RecordTable title="Append-only setup notes" rows={data?.notes ?? []} empty="No correction notes have been added." />
        <RecordTable title="Generated setup history" rows={data?.setups ?? []} empty="No setups generated." />
        <RecordTable title="Complete outcome history" rows={data?.outcomes ?? []} empty="No outcomes tracked." />
      </>}
      {activeTab === "snapshot" && (
        <section className="section-panel no-hover-effect">
          <p className="eyebrow">Read-only snapshot inspector</p><h2>Market source behind a setup</h2>
          <label>Snapshot<select value={selectedSnapshotId} onChange={(event) => setSelectedSnapshotId(event.target.value)}>{data?.snapshots.map((snapshot) => <option value={String(snapshot.id)} key={String(snapshot.id)}>{String(snapshot.symbol)} · {new Date(String(snapshot.candle_close_at)).toLocaleString()}</option>)}</select></label>
          {selectedSnapshot ? <pre className="admin-ai-json">{JSON.stringify(selectedSnapshot, null, 2)}</pre> : <p className="muted">No snapshot selected.</p>}
          <p className="muted">Historical snapshots and predictions cannot be edited. Use append-only admin notes for corrections.</p>
        </section>
      )}
    </main>
  );
}

function StatusCard({ label, value, good }: { label: string; value: string; good: boolean }) { return <article className="section-panel no-hover-effect admin-ai-status-card"><Activity className={good ? "positive" : "negative"} /><p className="eyebrow">{label}</p><h2>{value}</h2></article>; }
function BooleanControl({ label, checked, onChange, danger = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; danger?: boolean }) { return <label className={danger ? "checkbox-row danger-text" : "checkbox-row"}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>; }
function NumberControl({ label, value, onChange, step = "1" }: { label: string; value: number; onChange: (value: number) => void; step?: string }) { return <label>{capitalize(label)}<input type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
function RecordTable({ title, rows, empty }: { title: string; rows: Array<Record<string, unknown>>; empty: string }) { const columns = useMemo(() => rows.length ? Object.keys(rows[0]).filter((key) => !["normalized_market_data", "calculated_features", "deterministic_candidate", "ai_structured_output"].includes(key)).slice(0, 7) : [], [rows]); return <section className="section-panel no-hover-effect"><h2>{title}</h2>{rows.length ? <div className="table-scroll"><table className="ai-levels-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, " ")}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.setup_id ?? index)}>{columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>)}</tbody></table></div> : <p className="muted">{empty}</p>}</section>; }
function formatCell(value: unknown): string { if (value === null || value === undefined) return "—"; if (typeof value === "object") return JSON.stringify(value).slice(0, 120); if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString(); return String(value); }
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }

function calculateMonitoringMetrics(data: AdminData | null) {
  const outcomes = data?.outcomes ?? [];
  const setups = data?.setups ?? [];
  const terminal = outcomes.filter((row) => ["tp_hit", "sl_hit", "expired", "invalidated"].includes(String(row.status)));
  const entered = outcomes.filter((row) => Boolean(row.entry_triggered_at));
  const wins = terminal.filter((row) => Number(row.estimated_result_after_costs_r ?? row.realized_result_r ?? 0) > 0).length;
  const losses = terminal.filter((row) => Number(row.estimated_result_after_costs_r ?? row.realized_result_r ?? 0) < 0).length;
  const winValues = terminal.map((row) => Number(row.estimated_result_after_costs_r ?? row.realized_result_r ?? 0)).filter((value) => value > 0);
  const lossValues = terminal.map((row) => Number(row.estimated_result_after_costs_r ?? row.realized_result_r ?? 0)).filter((value) => value < 0);
  const averageWinValue = average(winValues);
  const averageLossValue = average(lossValues);
  const expectancyValue = terminal.length
    ? terminal.reduce((sum, row) => sum + Number(row.estimated_result_after_costs_r ?? row.realized_result_r ?? 0), 0) / terminal.length
    : 0;
  const takeProfitCount = outcomes.filter((row) => Number(row.highest_tp_hit ?? 0) > 0).length;
  const noTradeCount = setups.filter((row) => String(row.verdict) === "NO_TRADE").length;
  const providerFailureCount = data?.providerEvents.filter((row) => row.status !== "success").length ?? 0;
  return {
    enteredCount: entered.length,
    wins,
    losses,
    averageWinValue,
    averageLossValue,
    expectancyValue,
    takeProfitCount,
    providerFailureCount,
    entryTriggerRate: percent(entered.length, outcomes.length),
    winRate: percent(wins, wins + losses),
    averageWin: `${averageWinValue.toFixed(2)}R`,
    averageLoss: `${averageLossValue.toFixed(2)}R`,
    expectancy: `${expectancyValue.toFixed(2)}R`,
    takeProfitRate: percent(takeProfitCount, entered.length),
    noTradeRate: percent(noTradeCount, setups.length),
    providerFailureRate: percent(providerFailureCount, data?.providerEvents.length ?? 0)
  };
}

function percent(part: number, total: number): string { return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "—"; }
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

function calculatePerformanceSlices(data: AdminData | null) {
  const outcomes = data?.outcomes ?? [];
  const setups = data?.setups ?? [];
  const setupById = new Map(setups.map((setup) => [String(setup.id), setup]));
  const completed = outcomes.filter((row) => ["tp_hit", "sl_hit", "expired", "invalidated"].includes(String(row.status)));
  const summarize = (label: string, rows: Array<Record<string, unknown>>) => {
    const resultValues = rows.map((row) => Number(row.estimated_result_after_costs_r ?? row.realized_result_r ?? 0));
    return {
      segment: label,
      completed: rows.length,
      wins: resultValues.filter((value) => value > 0).length,
      losses_or_expired: resultValues.filter((value) => value <= 0).length,
      expectancy_r: average(resultValues).toFixed(3)
    };
  };
  const regimes = ["trending", "ranging", "high_volatility", "uncertain"];
  const byRegime = regimes.map((regime) => summarize(regime, completed.filter((row) => String(setupById.get(String(row.setup_id))?.market_regime) === regime))).filter((row) => row.completed > 0);
  const qualityBands = [
    { label: "Below 75", match: (score: number) => score < 75 },
    { label: "75–84", match: (score: number) => score >= 75 && score < 85 },
    { label: "85–100", match: (score: number) => score >= 85 }
  ];
  const byQuality = qualityBands.map((band) => summarize(band.label, completed.filter((row) => band.match(Number(setupById.get(String(row.setup_id))?.setup_quality_score ?? 0))))).filter((row) => row.completed > 0);
  const entered = outcomes.filter((row) => Boolean(row.entry_triggered_at));
  const maximumTargets = Math.max(0, ...setups.map((setup) => Array.isArray(setup.take_profits) ? setup.take_profits.length : 0));
  const takeProfits = Array.from({ length: maximumTargets }, (_, index) => ({
    target: `TP${index + 1}`,
    hits: entered.filter((row) => Number(row.highest_tp_hit ?? 0) >= index + 1).length,
    entered_setups: entered.length,
    hit_rate: percent(entered.filter((row) => Number(row.highest_tp_hit ?? 0) >= index + 1).length, entered.length)
  }));
  return { byRegime, byQuality, takeProfits };
}
