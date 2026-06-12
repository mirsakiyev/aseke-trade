import { Edit3, Headphones, LineChart, Plus, RefreshCw, SearchCheck, Trash2 } from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchAdminAmlCheckRequests,
  fetchAdminPremiumSupportRequests,
  fetchTradingSignals
} from "../lib/tradingAcademyApi";
import { sanitizePlainText } from "../lib/validation";
import { supabase } from "../lib/supabase";
import type {
  AmlCheckRequest,
  AmlCheckStatus,
  PremiumSupportRequest,
  PremiumSupportStatus,
  TradingSignal,
  TradingSignalDirection,
  TradingSignalStatus
} from "../types/content";

type AcademyAdminTab = "signals" | "aml" | "support";

const signalStatuses: TradingSignalStatus[] = ["draft", "active", "closed", "cancelled", "hit_tp", "hit_sl"];
const signalDirections: TradingSignalDirection[] = ["long", "short", "spot", "update"];
const amlStatuses: AmlCheckStatus[] = ["pending", "in_review", "completed", "rejected", "refunded"];
const supportStatuses: PremiumSupportStatus[] = ["open", "in_review", "answered", "closed"];
const chartImageTypes = ["image/jpeg", "image/png", "image/webp"];
const maxChartImageBytes = 5 * 1024 * 1024;

const blankSignalForm = {
  title: "",
  symbol: "",
  direction: "long" as TradingSignalDirection,
  entry_price: "",
  stop_loss: "",
  take_profit_1: "",
  take_profit_2: "",
  take_profit_3: "",
  additional_take_profits: "",
  price_at_creation: "",
  chart_image_url: "",
  notes: "",
  status: "active" as TradingSignalStatus,
  is_active: true
};

export function AdminTradingAcademy() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AcademyAdminTab>("signals");
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [amlRequests, setAmlRequests] = useState<AmlCheckRequest[]>([]);
  const [supportRequests, setSupportRequests] = useState<PremiumSupportRequest[]>([]);
  const [signalForm, setSignalForm] = useState(blankSignalForm);
  const [editingSignalId, setEditingSignalId] = useState<string | null>(null);
  const [chartFile, setChartFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [message, setMessage] = useState<string | null>(null);

  const refreshAdminData = useCallback(async () => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const [nextSignals, nextAmlRequests, nextSupportRequests] = await Promise.all([
        fetchTradingSignals({ includeInactive: true }),
        fetchAdminAmlCheckRequests(),
        fetchAdminPremiumSupportRequests()
      ]);
      setSignals(nextSignals);
      setAmlRequests(nextAmlRequests);
      setSupportRequests(nextSupportRequests);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Trading Academy admin data could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAdminData();
  }, [refreshAdminData]);

  const saveSignal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !user) return;

    const symbol = sanitizePlainText(signalForm.symbol, 40).toUpperCase();
    const title = sanitizePlainText(signalForm.title, 120);
    const entryPrice = normalizeDecimal(signalForm.entry_price);
    const stopLoss = normalizeDecimal(signalForm.stop_loss);
    const tp1 = normalizeDecimal(signalForm.take_profit_1);
    const tp2 = normalizeDecimal(signalForm.take_profit_2);
    const tp3 = normalizeDecimal(signalForm.take_profit_3);
    const priceAtCreation = normalizeDecimal(signalForm.price_at_creation);
    const additionalTakeProfits = parseAdditionalTakeProfits(signalForm.additional_take_profits);

    if (!symbol) {
      setMessage("Signal symbol is required.");
      return;
    }

    if (!entryPrice || !stopLoss || !tp1 || !tp2 || !tp3 || !priceAtCreation || !additionalTakeProfits.ok) {
      setMessage("Enter valid decimal prices for entry, stop loss, take profits, and creation price.");
      return;
    }

    let chartImageUrl = sanitizePlainText(signalForm.chart_image_url, 700) || null;
    if (chartFile) {
      const uploadedUrl = await uploadSignalChart(chartFile, user.id);
      if (!uploadedUrl) return;
      chartImageUrl = uploadedUrl;
    }

    const payload = {
      title: title || null,
      symbol,
      direction: signalForm.direction,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit_1: tp1,
      take_profit_2: tp2,
      take_profit_3: tp3,
      additional_take_profits: additionalTakeProfits.values,
      price_at_creation: priceAtCreation,
      chart_image_url: chartImageUrl,
      notes: sanitizePlainText(signalForm.notes, 2000) || null,
      status: signalForm.status,
      is_active: signalForm.is_active,
      created_by_admin_id: user.id
    };

    const result = editingSignalId
      ? await supabase.from("trading_signals").update(payload).eq("id", editingSignalId)
      : await supabase.from("trading_signals").insert(payload);

    setMessage(result.error ? "Trading signal could not be saved." : "Trading signal saved.");
    if (!result.error) {
      resetSignalForm();
      await refreshAdminData();
    }
  };

  const uploadSignalChart = async (file: File, userId: string): Promise<string | null> => {
    if (!supabase) return null;

    if (!chartImageTypes.includes(file.type)) {
      setMessage("Use a JPG, PNG, or WEBP chart image.");
      return null;
    }

    if (file.size > maxChartImageBytes) {
      setMessage("Chart images must be 5 MB or smaller.");
      return null;
    }

    const extension = file.name.split(".").pop()?.toLowerCase();
    const safeExtension = extension && /^[a-z0-9]+$/.test(extension) ? extension : "png";
    const path = `${userId}/${Date.now()}-${crypto.randomUUID()}.${safeExtension}`;
    const uploadResult = await supabase.storage.from("trading-signal-charts").upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false
    });

    if (uploadResult.error) {
      setMessage("Chart image upload failed. Check the trading-signal-charts bucket and policies.");
      return null;
    }

    const { data } = supabase.storage.from("trading-signal-charts").getPublicUrl(path);
    return data.publicUrl;
  };

  const deleteSignal = async (signalId: string) => {
    if (!supabase) return;
    if (!window.confirm("Delete this trading signal?")) return;

    const { error } = await supabase.from("trading_signals").delete().eq("id", signalId);
    setMessage(error ? "Trading signal could not be deleted." : "Trading signal deleted.");
    if (!error) await refreshAdminData();
  };

  const editSignal = (signal: TradingSignal) => {
    setEditingSignalId(signal.id);
    setChartFile(null);
    setSignalForm({
      title: signal.title ?? "",
      symbol: signal.symbol,
      direction: signal.direction,
      entry_price: String(signal.entry_price),
      stop_loss: String(signal.stop_loss),
      take_profit_1: String(signal.take_profit_1),
      take_profit_2: String(signal.take_profit_2),
      take_profit_3: String(signal.take_profit_3),
      additional_take_profits: signal.additional_take_profits?.join(", ") ?? "",
      price_at_creation: String(signal.price_at_creation),
      chart_image_url: signal.chart_image_url ?? "",
      notes: signal.notes ?? "",
      status: signal.status,
      is_active: signal.is_active
    });
  };

  const resetSignalForm = () => {
    setSignalForm(blankSignalForm);
    setEditingSignalId(null);
    setChartFile(null);
  };

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Admin Panel</p>
          <h1>Trading Academy tools</h1>
          <p className="muted">Manage Academy signals, AML check requests, and premium support tickets.</p>
        </div>
        <div className="inline-actions">
          <Link className="ghost-button" to="/admin">
            Content admin
          </Link>
          <button className="ghost-button" type="button" onClick={() => void refreshAdminData()}>
            <RefreshCw size={17} />
            Refresh
          </button>
        </div>
      </section>

      {!supabase && (
        <div className="warning-box">Supabase is not connected. Add environment variables before using admin features.</div>
      )}

      {message && <p className="soft-notice">{message}</p>}

      <section className="tab-bar" aria-label="Trading Academy admin sections">
        {(["signals", "aml", "support"] as AcademyAdminTab[]).map((tab) => (
          <button
            className={activeTab === tab ? "filter-pill active" : "filter-pill"}
            type="button"
            onClick={() => setActiveTab(tab)}
            key={tab}
          >
            {tab}
          </button>
        ))}
      </section>

      {isLoading ? (
        <LoadingState label="Loading Trading Academy admin" />
      ) : (
        <>
          {activeTab === "signals" && (
            <section className="admin-grid">
              <form className="section-panel stack-form" onSubmit={saveSignal}>
                <h2>{editingSignalId ? "Edit trading signal" : "Create trading signal"}</h2>
                <div className="form-row">
                  <label>
                    Symbol / pair
                    <input
                      value={signalForm.symbol}
                      onChange={(event) => setSignalForm((form) => ({ ...form, symbol: event.target.value }))}
                      placeholder="BTC/USDT"
                      required
                    />
                  </label>
                  <label>
                    Direction
                    <select
                      value={signalForm.direction}
                      onChange={(event) =>
                        setSignalForm((form) => ({ ...form, direction: event.target.value as TradingSignalDirection }))
                      }
                    >
                      {signalDirections.map((direction) => (
                        <option key={direction} value={direction}>
                          {direction}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Title
                  <input
                    value={signalForm.title}
                    onChange={(event) => setSignalForm((form) => ({ ...form, title: event.target.value }))}
                    maxLength={120}
                  />
                </label>
                <div className="form-row">
                  <label>
                    Entry price
                    <input
                      inputMode="decimal"
                      value={signalForm.entry_price}
                      onChange={(event) => setSignalForm((form) => ({ ...form, entry_price: event.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    Exact creation price
                    <input
                      inputMode="decimal"
                      value={signalForm.price_at_creation}
                      onChange={(event) =>
                        setSignalForm((form) => ({ ...form, price_at_creation: event.target.value }))
                      }
                      required
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Stop loss
                    <input
                      inputMode="decimal"
                      value={signalForm.stop_loss}
                      onChange={(event) => setSignalForm((form) => ({ ...form, stop_loss: event.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    TP1
                    <input
                      inputMode="decimal"
                      value={signalForm.take_profit_1}
                      onChange={(event) =>
                        setSignalForm((form) => ({ ...form, take_profit_1: event.target.value }))
                      }
                      required
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    TP2
                    <input
                      inputMode="decimal"
                      value={signalForm.take_profit_2}
                      onChange={(event) =>
                        setSignalForm((form) => ({ ...form, take_profit_2: event.target.value }))
                      }
                      required
                    />
                  </label>
                  <label>
                    TP3
                    <input
                      inputMode="decimal"
                      value={signalForm.take_profit_3}
                      onChange={(event) =>
                        setSignalForm((form) => ({ ...form, take_profit_3: event.target.value }))
                      }
                      required
                    />
                  </label>
                </div>
                <label>
                  Additional take profits
                  <input
                    value={signalForm.additional_take_profits}
                    onChange={(event) =>
                      setSignalForm((form) => ({ ...form, additional_take_profits: event.target.value }))
                    }
                    placeholder="Comma separated"
                  />
                </label>
                <div className="form-row">
                  <label>
                    Status
                    <select
                      value={signalForm.status}
                      onChange={(event) =>
                        setSignalForm((form) => ({ ...form, status: event.target.value as TradingSignalStatus }))
                      }
                    >
                      {signalStatuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={signalForm.is_active}
                      onChange={(event) => setSignalForm((form) => ({ ...form, is_active: event.target.checked }))}
                    />
                    Visible to Academy
                  </label>
                </div>
                <label>
                  Chart image URL
                  <input
                    value={signalForm.chart_image_url}
                    onChange={(event) => setSignalForm((form) => ({ ...form, chart_image_url: event.target.value }))}
                  />
                </label>
                <label>
                  Upload chart image
                  <input
                    type="file"
                    accept={chartImageTypes.join(",")}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setChartFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    value={signalForm.notes}
                    onChange={(event) => setSignalForm((form) => ({ ...form, notes: event.target.value }))}
                    rows={4}
                    maxLength={2000}
                  />
                </label>
                <div className="inline-actions">
                  <button className="primary-button" type="submit">
                    <Plus size={17} />
                    Save Signal
                  </button>
                  {editingSignalId && (
                    <button className="ghost-button" type="button" onClick={resetSignalForm}>
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>

              <AdminList title="Trading Signals">
                {signals.length ? (
                  signals.map((signal) => (
                    <li key={signal.id}>
                      <div>
                        <strong>{signal.title || signal.symbol}</strong>
                        <span>
                          {signal.direction} - {signal.status} - {signal.is_active ? "visible" : "hidden"}
                        </span>
                      </div>
                      <div className="row-actions">
                        <button className="icon-button" type="button" onClick={() => editSignal(signal)}>
                          <Edit3 size={16} />
                          <span className="sr-only">Edit signal</span>
                        </button>
                        <button className="icon-button danger" type="button" onClick={() => void deleteSignal(signal.id)}>
                          <Trash2 size={16} />
                          <span className="sr-only">Delete signal</span>
                        </button>
                      </div>
                    </li>
                  ))
                ) : (
                  <li>
                    <div>
                      <strong>No signals yet</strong>
                      <span>Create the first Trading Academy signal.</span>
                    </div>
                    <LineChart size={18} />
                  </li>
                )}
              </AdminList>
            </section>
          )}

          {activeTab === "aml" && (
            <AdminList title="AML Check Requests">
              {amlRequests.length ? (
                amlRequests.map((request) => (
                  <AmlRequestAdminRow request={request} onUpdated={refreshAdminData} key={request.id} />
                ))
              ) : (
                <li>
                  <div>
                    <strong>No AML requests</strong>
                    <span>Paid AML checks will appear here.</span>
                  </div>
                  <SearchCheck size={18} />
                </li>
              )}
            </AdminList>
          )}

          {activeTab === "support" && (
            <AdminList title="Premium Support Requests">
              {supportRequests.length ? (
                supportRequests.map((request) => (
                  <SupportRequestAdminRow request={request} onUpdated={refreshAdminData} key={request.id} />
                ))
              ) : (
                <li>
                  <div>
                    <strong>No support requests</strong>
                    <span>Premium support tickets will appear here.</span>
                  </div>
                  <Headphones size={18} />
                </li>
              )}
            </AdminList>
          )}
        </>
      )}
    </main>
  );
}

function AmlRequestAdminRow({ request, onUpdated }: { request: AmlCheckRequest; onUpdated: () => Promise<void> }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<AmlCheckStatus>(request.status);
  const [adminResult, setAdminResult] = useState(request.admin_result ?? "");
  const [adminNotes, setAdminNotes] = useState(request.admin_notes ?? "");
  const [isSaving, setIsSaving] = useState(false);

  const updateRequest = async () => {
    if (!supabase || !user || isSaving) return;

    setIsSaving(true);
    const { error } = await supabase
      .from("aml_check_requests")
      .update({
        status,
        admin_result: sanitizePlainText(adminResult, 2000) || null,
        admin_notes: sanitizePlainText(adminNotes, 2000) || null,
        reviewed_by_admin_id: user.id,
        completed_at: status === "completed" ? new Date().toISOString() : request.completed_at
      })
      .eq("id", request.id);

    setIsSaving(false);
    if (!error) await onUpdated();
  };

  return (
    <li className="admin-review-row">
      <div>
        <strong>{request.network} - {shortenAddress(request.address)}</strong>
        <span>
          User {request.user_id.slice(0, 8)} - {request.status.replace("_", " ")} - {formatDateTime(request.created_at)}
        </span>
        {request.notes && <span>{request.notes}</span>}
      </div>
      <div className="admin-inline-form">
        <select value={status} onChange={(event) => setStatus(event.target.value as AmlCheckStatus)}>
          {amlStatuses.map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>
        <input value={adminResult} onChange={(event) => setAdminResult(event.target.value)} placeholder="Result" />
        <input value={adminNotes} onChange={(event) => setAdminNotes(event.target.value)} placeholder="Admin notes" />
        <button className="ghost-button compact" type="button" onClick={() => void updateRequest()} disabled={isSaving}>
          {isSaving ? "Saving" : "Update"}
        </button>
      </div>
    </li>
  );
}

function SupportRequestAdminRow({
  request,
  onUpdated
}: {
  request: PremiumSupportRequest;
  onUpdated: () => Promise<void>;
}) {
  const { user } = useAuth();
  const [status, setStatus] = useState<PremiumSupportStatus>(request.status);
  const [response, setResponse] = useState(request.admin_response ?? "");
  const [adminNotes, setAdminNotes] = useState(request.admin_notes ?? "");
  const [isSaving, setIsSaving] = useState(false);

  const updateRequest = async () => {
    if (!supabase || !user || isSaving) return;

    setIsSaving(true);
    const { error } = await supabase
      .from("premium_support_requests")
      .update({
        status,
        admin_response: sanitizePlainText(response, 2000) || null,
        admin_notes: sanitizePlainText(adminNotes, 2000) || null,
        reviewed_by_admin_id: user.id
      })
      .eq("id", request.id);

    setIsSaving(false);
    if (!error) await onUpdated();
  };

  return (
    <li className="admin-review-row">
      <div>
        <strong>{request.subject}</strong>
        <span>
          User {request.user_id.slice(0, 8)} - {request.priority} - {request.status.replace("_", " ")} -{" "}
          {formatDateTime(request.created_at)}
        </span>
        <span>{request.message}</span>
      </div>
      <div className="admin-inline-form">
        <select value={status} onChange={(event) => setStatus(event.target.value as PremiumSupportStatus)}>
          {supportStatuses.map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>
        <input value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Response" />
        <input value={adminNotes} onChange={(event) => setAdminNotes(event.target.value)} placeholder="Admin notes" />
        <button className="ghost-button compact" type="button" onClick={() => void updateRequest()} disabled={isSaving}>
          {isSaving ? "Saving" : "Update"}
        </button>
      </div>
    </li>
  );
}

function AdminList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="section-panel">
      <h2>{title}</h2>
      <ul className="admin-list">{children}</ul>
    </article>
  );
}

function normalizeDecimal(value: string): string | null {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,10})?$/.test(normalized)) return null;
  if (Number(normalized) <= 0) return null;

  return normalized;
}

function parseAdditionalTakeProfits(value: string): { ok: true; values: string[] } | { ok: false; values: [] } {
  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!parts.length) return { ok: true, values: [] };

  const values = parts.map(normalizeDecimal);
  if (values.some((item) => item === null)) return { ok: false, values: [] };

  return { ok: true, values: values as string[] };
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
