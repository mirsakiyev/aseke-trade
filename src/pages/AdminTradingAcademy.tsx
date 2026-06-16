import {
  CheckCircle2,
  Edit3,
  Flag,
  LineChart,
  Plus,
  RefreshCw,
  SearchCheck,
  StickyNote,
  Trash2,
  XCircle
} from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchAdminAmlCheckRequests,
  fetchTradingSignals
} from "../lib/tradingAcademyApi";
import {
  TRADING_SIGNAL_DIRECTIONS,
  TRADING_SIGNAL_FINAL_STATUSES,
  appendSignalUpdate,
  calculateSignalFinalRoi,
  calculateTpPercentTotal,
  calculateWeightedRoi,
  formatPercent,
  formatSignalStatus,
  generateSignalTitle,
  getSignalDisplayTitle,
  getSignalTakeProfits,
  getSignalUpdates,
  normalizeLeverage,
  normalizePercent,
  normalizePositiveDecimal,
  splitTakeProfitPercentages,
  validateTakeProfits
} from "../lib/tradingSignals";
import { sanitizePlainText } from "../lib/validation";
import { supabase } from "../lib/supabase";
import type {
  AmlCheckRequest,
  AmlCheckStatus,
  TradingSignal,
  TradingSignalDirection,
  TradingSignalOriginalSnapshot,
  TradingSignalStatus,
  TradingSignalTakeProfit,
  TradingSignalUpdate
} from "../types/content";

type AcademyAdminTab = "signals" | "aml";

interface SignalTakeProfitForm {
  id: string;
  price: string;
  positionSizePercent: string;
  isHit: boolean;
  hitAt: string | null;
}

interface SignalFormState {
  symbol: string;
  direction: TradingSignalDirection;
  leverage: string;
  entry_price: string;
  stop_loss: string;
  take_profits: SignalTakeProfitForm[];
  chart_image_url: string;
  notes: string;
}

const amlStatuses: AmlCheckStatus[] = ["pending", "in_review", "completed", "rejected", "refunded"];
const chartImageTypes = ["image/jpeg", "image/png", "image/webp"];
const maxChartImageBytes = 5 * 1024 * 1024;
const leverageOptions = Array.from({ length: 100 }, (_, index) => index + 1);

export function AdminTradingAcademy() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AcademyAdminTab>("signals");
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [amlRequests, setAmlRequests] = useState<AmlCheckRequest[]>([]);
  const [signalForm, setSignalForm] = useState<SignalFormState>(() => createBlankSignalForm());
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
      const [nextSignals, nextAmlRequests] = await Promise.all([
        fetchTradingSignals({ includeInactive: true }),
        fetchAdminAmlCheckRequests()
      ]);
      setSignals(nextSignals);
      setAmlRequests(nextAmlRequests);
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

    const existingSignal = editingSignalId ? signals.find((signal) => signal.id === editingSignalId) ?? null : null;
    const symbol = sanitizePlainText(signalForm.symbol, 40).toUpperCase();
    const leverage = normalizeLeverage(signalForm.leverage);
    const entryPrice = normalizePositiveDecimal(signalForm.entry_price);
    const stopLoss = normalizePositiveDecimal(signalForm.stop_loss);
    const validation = validateTakeProfits(signalForm.take_profits);

    if (!symbol) {
      setMessage("Signal symbol is required.");
      return;
    }

    if (!leverage) {
      setMessage("Choose leverage from 1X to 100X.");
      return;
    }

    if (!entryPrice || !stopLoss) {
      setMessage("Enter valid decimal prices for entry and stop loss.");
      return;
    }

    if (!validation.ok) {
      setMessage(validation.message);
      return;
    }

    const takeProfits = normalizeTakeProfitForm(signalForm.take_profits);
    const generatedTitle = generateSignalTitle(signalForm.direction, leverage);
    const notes = sanitizePlainText(signalForm.notes, 2000) || null;
    const now = new Date().toISOString();

    let chartImageUrl = sanitizePlainText(signalForm.chart_image_url, 700) || null;
    if (chartFile) {
      const uploadedUrl = await uploadSignalChart(chartFile, user.id);
      if (!uploadedUrl) return;
      chartImageUrl = uploadedUrl;
    }

    const status = existingSignal?.status ?? "active";
    let updates: TradingSignalUpdate[] = existingSignal ? getSignalUpdates(existingSignal) : [];

    if (!existingSignal) {
      updates = appendSignalUpdate(updates, {
        type: "signal_created",
        message: "Signal created",
        createdAt: now,
        metadata: { title: generatedTitle }
      });
    } else {
      const previousFingerprint = signalDetailsFingerprint(existingSignal);
      const nextFingerprint = signalDetailsFingerprint({
        generated_title: generatedTitle,
        symbol,
        direction: signalForm.direction,
        leverage,
        entry_price: entryPrice,
        stop_loss: stopLoss,
        take_profits: takeProfits
      });

      if (previousFingerprint !== nextFingerprint) {
        updates = appendSignalUpdate(updates, {
          type: "signal_edited",
          message: "Signal details updated",
          metadata: { title: generatedTitle }
        });
      }

      if (notes && notes !== existingSignal.notes) {
        updates = appendSignalUpdate(updates, {
          type: "note",
          message: `Admin note: ${notes}`,
          metadata: null
        });
      }
    }

    const payload: Record<string, unknown> = {
      title: generatedTitle,
      generated_title: generatedTitle,
      symbol,
      direction: signalForm.direction,
      leverage,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profits: takeProfits,
      take_profit_1: takeProfits[0]?.price ?? null,
      take_profit_2: takeProfits[1]?.price ?? null,
      take_profit_3: takeProfits[2]?.price ?? null,
      additional_take_profits: takeProfits.slice(3).map((takeProfit) => takeProfit.price),
      price_at_creation: entryPrice,
      chart_image_url: chartImageUrl,
      notes,
      status,
      updates,
      final_roi: TRADING_SIGNAL_FINAL_STATUSES.includes(status)
        ? calculateSignalFinalRoi({
            ...existingSignal!,
            direction: signalForm.direction,
            leverage,
            entry_price: entryPrice,
            stop_loss: stopLoss,
            take_profits: takeProfits
          })
        : null
    };

    if (!existingSignal) {
      payload.created_by_admin_id = user.id;
      payload.original_signal = buildOriginalSnapshot({
        generatedTitle,
        symbol,
        direction: signalForm.direction,
        leverage,
        entryPrice,
        stopLoss,
        takeProfits,
        notes,
        createdAt: now
      });
    } else if (!existingSignal.original_signal) {
      payload.original_signal = buildOriginalSnapshotFromSignal(existingSignal);
    }

    const result = existingSignal
      ? await supabase.from("trading_signals").update(payload).eq("id", existingSignal.id)
      : await supabase.from("trading_signals").insert(payload);

    setMessage(result.error ? "Trading signal could not be saved." : "Trading signal saved. Premium users will be notified.");
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
      symbol: signal.symbol,
      direction: signal.direction,
      leverage: String(signal.leverage ?? 1),
      entry_price: String(signal.entry_price),
      stop_loss: String(signal.stop_loss),
      take_profits: getSignalTakeProfits(signal).map((takeProfit) => ({
        id: takeProfit.id,
        price: String(takeProfit.price),
        positionSizePercent: String(takeProfit.positionSizePercent),
        isHit: takeProfit.isHit,
        hitAt: takeProfit.hitAt
      })),
      chart_image_url: signal.chart_image_url ?? "",
      notes: signal.notes ?? ""
    });
  };

  const resetSignalForm = () => {
    setSignalForm(createBlankSignalForm());
    setEditingSignalId(null);
    setChartFile(null);
  };

  const addTakeProfit = () => {
    setSignalForm((form) => ({
      ...form,
      take_profits: applyDefaultTakeProfitSplit([
        ...form.take_profits,
        {
          id: createTakeProfitId(),
          price: "",
          positionSizePercent: "0",
          isHit: false,
          hitAt: null
        }
      ])
    }));
  };

  const removeTakeProfit = (takeProfitId: string) => {
    setSignalForm((form) => {
      if (form.take_profits.length === 1) return form;

      return {
        ...form,
        take_profits: applyDefaultTakeProfitSplit(form.take_profits.filter((takeProfit) => takeProfit.id !== takeProfitId))
      };
    });
  };

  const updateTakeProfit = (takeProfitId: string, field: "price" | "positionSizePercent", value: string) => {
    setSignalForm((form) => ({
      ...form,
      take_profits: form.take_profits.map((takeProfit) =>
        takeProfit.id === takeProfitId ? { ...takeProfit, [field]: value } : takeProfit
      )
    }));
  };

  const generatedTitle = generateSignalTitle(signalForm.direction, normalizeLeverage(signalForm.leverage) ?? 1);
  const takeProfitValidation = validateTakeProfits(signalForm.take_profits);
  const tpTotal = calculateTpPercentTotal(signalForm.take_profits);

  return (
    <main className="page page-stack">
      <section className="page-title-row compact-title-row">
        <div>
          <p className="eyebrow">Admin Panel</p>
          <h1>Trading Academy tools</h1>
          <p className="muted">Manage Academy signals and AML check requests.</p>
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
        {(["signals", "aml"] as AcademyAdminTab[]).map((tab) => (
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
            <section className="admin-grid signal-admin-grid">
              <form className="section-panel stack-form signal-admin-form" onSubmit={saveSignal}>
                <div className="compact-panel-header">
                  <div>
                    <h2>{editingSignalId ? "Edit trading signal" : "Create trading signal"}</h2>
                    <p className="muted">Generated title: {generatedTitle}</p>
                  </div>
                  {editingSignalId && (
                    <button className="ghost-button compact" type="button" onClick={resetSignalForm}>
                      Cancel
                    </button>
                  )}
                </div>

                <div className="signal-form-grid">
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
                      {TRADING_SIGNAL_DIRECTIONS.map((direction) => (
                        <option key={direction} value={direction}>
                          {direction.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Leverage
                    <select
                      value={signalForm.leverage}
                      onChange={(event) => setSignalForm((form) => ({ ...form, leverage: event.target.value }))}
                    >
                      {leverageOptions.map((leverage) => (
                        <option key={leverage} value={leverage}>
                          {leverage}X
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Entry
                    <input
                      inputMode="decimal"
                      value={signalForm.entry_price}
                      onChange={(event) => setSignalForm((form) => ({ ...form, entry_price: event.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    SL
                    <input
                      inputMode="decimal"
                      value={signalForm.stop_loss}
                      onChange={(event) => setSignalForm((form) => ({ ...form, stop_loss: event.target.value }))}
                      required
                    />
                  </label>
                </div>

                <div className="tp-editor">
                  <div className="compact-panel-header">
                    <div>
                      <h3>Take Profits</h3>
                      <p className={takeProfitValidation.ok ? "allocation-line" : "allocation-line invalid"}>
                        Total allocation: {formatPercent(tpTotal)}%
                      </p>
                    </div>
                    <button className="ghost-button compact" type="button" onClick={addTakeProfit}>
                      <Plus size={15} />
                      Add TP
                    </button>
                  </div>
                  <div className="tp-editor-list">
                    {signalForm.take_profits.map((takeProfit, index) => (
                      <div className="tp-editor-row" key={takeProfit.id}>
                        <strong>TP{index + 1}</strong>
                        <label>
                          Price
                          <input
                            inputMode="decimal"
                            value={takeProfit.price}
                            onChange={(event) => updateTakeProfit(takeProfit.id, "price", event.target.value)}
                            required
                          />
                        </label>
                        <label>
                          Position %
                          <input
                            inputMode="decimal"
                            value={takeProfit.positionSizePercent}
                            onChange={(event) =>
                              updateTakeProfit(takeProfit.id, "positionSizePercent", event.target.value)
                            }
                            required
                          />
                        </label>
                        <button
                          className="icon-button danger"
                          type="button"
                          onClick={() => removeTakeProfit(takeProfit.id)}
                          disabled={signalForm.take_profits.length === 1}
                        >
                          <Trash2 size={15} />
                          <span className="sr-only">Remove TP{index + 1}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                  {!takeProfitValidation.ok && <p className="form-error">{takeProfitValidation.message}</p>}
                </div>

                <div className="signal-form-grid">
                  <label>
                    Chart image URL
                    <input
                      value={signalForm.chart_image_url}
                      onChange={(event) => setSignalForm((form) => ({ ...form, chart_image_url: event.target.value }))}
                    />
                  </label>
                  <label>
                    Upload chart
                    <input
                      type="file"
                      accept={chartImageTypes.join(",")}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => setChartFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>

                <label>
                  Notes / update
                  <textarea
                    value={signalForm.notes}
                    onChange={(event) => setSignalForm((form) => ({ ...form, notes: event.target.value }))}
                    rows={3}
                    maxLength={2000}
                  />
                </label>

                <button className="primary-button compact" type="submit" disabled={!takeProfitValidation.ok}>
                  <Plus size={17} />
                  Save Signal
                </button>
              </form>

              <AdminList title="Trading Signals">
                {signals.length ? (
                  signals.map((signal) => (
                    <AdminSignalRow
                      signal={signal}
                      onEdit={editSignal}
                      onDelete={deleteSignal}
                      onUpdated={refreshAdminData}
                      setMessage={setMessage}
                      key={signal.id}
                    />
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
        </>
      )}
    </main>
  );
}

function AdminSignalRow({
  signal,
  onEdit,
  onDelete,
  onUpdated,
  setMessage
}: {
  signal: TradingSignal;
  onEdit: (signal: TradingSignal) => void;
  onDelete: (signalId: string) => void;
  onUpdated: () => Promise<void>;
  setMessage: (message: string | null) => void;
}) {
  const takeProfits = getSignalTakeProfits(signal);
  const updates = getSignalUpdates(signal);
  const isFinal = TRADING_SIGNAL_FINAL_STATUSES.includes(signal.status);
  const title = getSignalDisplayTitle(signal);
  const [updateNote, setUpdateNote] = useState("");
  const [manualClosePrice, setManualClosePrice] = useState("");
  const [manualCloseNote, setManualCloseNote] = useState("");
  const [isSavingAction, setIsSavingAction] = useState(false);

  const updateSignal = async (payload: Record<string, unknown>, successMessage: string) => {
    if (!supabase || isSavingAction) return;

    setIsSavingAction(true);
    const { error } = await supabase.from("trading_signals").update(payload).eq("id", signal.id);
    setIsSavingAction(false);

    if (error) {
      setMessage("Trading signal update could not be saved.");
      return;
    }

    setMessage(`${successMessage} Premium users will be notified.`);
    await onUpdated();
  };

  const addUpdateNote = async () => {
    const note = sanitizePlainText(updateNote, 2000);
    if (!note) {
      setMessage("Enter an update note first.");
      return;
    }

    await updateSignal(
      {
        updates: appendSignalUpdate(updates, {
          type: "note",
          message: `Admin note: ${note}`,
          metadata: null
        })
      },
      "Signal update added."
    );
    setUpdateNote("");
  };

  const markTakeProfitHit = async (takeProfitId: string) => {
    const now = new Date().toISOString();
    const nextTakeProfits = takeProfits.map((takeProfit) =>
      takeProfit.id === takeProfitId ? { ...takeProfit, isHit: true, hitAt: takeProfit.hitAt ?? now } : takeProfit
    );
    const hitTakeProfit = nextTakeProfits.find((takeProfit) => takeProfit.id === takeProfitId);
    if (!hitTakeProfit) return;

    const allTpsHit = nextTakeProfits.every((takeProfit) => takeProfit.isHit);
    const nextStatus: TradingSignalStatus = allTpsHit ? "hit_tp" : "active";
    const finalRoi = allTpsHit
      ? calculateWeightedRoi({
          direction: signal.direction,
          entryPrice: signal.entry_price,
          leverage: signal.leverage ?? 1,
          takeProfits: nextTakeProfits
        })
      : null;

    await updateSignal(
      {
        take_profits: nextTakeProfits,
        status: nextStatus,
        closed_at: allTpsHit ? signal.closed_at ?? now : signal.closed_at,
        final_price: allTpsHit ? hitTakeProfit.price : signal.final_price,
        final_roi: finalRoi,
        updates: appendSignalUpdate(updates, {
          type: "tp_hit",
          message: `TP${nextTakeProfits.findIndex((takeProfit) => takeProfit.id === takeProfitId) + 1} hit at ${formatSignalPrice(hitTakeProfit.price)}`,
          metadata: {
            takeProfitId,
            price: hitTakeProfit.price,
            positionSizePercent: hitTakeProfit.positionSizePercent
          }
        })
      },
      allTpsHit ? "Final TP marked hit. Trade moved to Past Trades." : "TP marked hit."
    );
  };

  const markStopLossHit = async () => {
    const now = new Date().toISOString();
    const finalRoi = calculateWeightedRoi({
      direction: signal.direction,
      entryPrice: signal.entry_price,
      leverage: signal.leverage ?? 1,
      takeProfits,
      fallbackExitPrice: signal.stop_loss
    });

    await updateSignal(
      {
        status: "hit_sl",
        closed_at: signal.closed_at ?? now,
        final_price: signal.stop_loss,
        final_roi: finalRoi,
        updates: appendSignalUpdate(updates, {
          type: "sl_hit",
          message: `Stop Loss hit at ${formatSignalPrice(signal.stop_loss)}`,
          metadata: { price: signal.stop_loss }
        })
      },
      "Stop Loss marked hit. Trade moved to Past Trades."
    );
  };

  const manuallyCloseSignal = async () => {
    const closePrice = normalizePositiveDecimal(manualClosePrice);
    if (!closePrice) {
      setMessage("Enter a valid manual close price.");
      return;
    }

    const note = sanitizePlainText(manualCloseNote, 1000);
    const now = new Date().toISOString();
    const finalRoi = calculateWeightedRoi({
      direction: signal.direction,
      entryPrice: signal.entry_price,
      leverage: signal.leverage ?? 1,
      takeProfits,
      fallbackExitPrice: closePrice
    });

    await updateSignal(
      {
        status: "manually_closed",
        closed_at: signal.closed_at ?? now,
        manual_close_price: closePrice,
        final_price: closePrice,
        final_roi: finalRoi,
        updates: appendSignalUpdate(updates, {
          type: "manual_close",
          message: note
            ? `Signal manually closed at ${formatSignalPrice(closePrice)}: ${note}`
            : `Signal manually closed at ${formatSignalPrice(closePrice)}`,
          metadata: { price: closePrice, note: note || null }
        })
      },
      "Signal manually closed. Trade moved to Past Trades."
    );
    setManualClosePrice("");
    setManualCloseNote("");
  };

  return (
    <li className="admin-signal-row">
      <div className="admin-signal-summary">
        <div>
          <strong>{title}</strong>
          <span>
            {signal.symbol} - {formatSignalStatus(signal.status)} - {signal.direction.toUpperCase()} {signal.leverage ?? 1}X
          </span>
          <span>
            Entry {formatSignalPrice(signal.entry_price)} - SL {formatSignalPrice(signal.stop_loss)}
          </span>
          {signal.final_roi !== null && signal.final_roi !== undefined && (
            <span>Final ROI {formatRoi(signal.final_roi)}</span>
          )}
        </div>
        <div className="row-actions">
          <button className="icon-button" type="button" onClick={() => onEdit(signal)}>
            <Edit3 size={16} />
            <span className="sr-only">Edit signal</span>
          </button>
          <button className="icon-button danger" type="button" onClick={() => void onDelete(signal.id)}>
            <Trash2 size={16} />
            <span className="sr-only">Delete signal</span>
          </button>
        </div>
      </div>

      <div className="admin-signal-tps">
        {takeProfits.map((takeProfit, index) => (
          <button
            className={takeProfit.isHit ? "signal-tp-chip hit" : "signal-tp-chip"}
            type="button"
            onClick={() => void markTakeProfitHit(takeProfit.id)}
            disabled={isFinal || takeProfit.isHit || isSavingAction}
            key={takeProfit.id}
          >
            {takeProfit.isHit ? <CheckCircle2 size={14} /> : <Flag size={14} />}
            TP{index + 1} {formatSignalPrice(takeProfit.price)} - {formatPercent(takeProfit.positionSizePercent)}%
          </button>
        ))}
      </div>

      <div className="admin-signal-actions">
        <div className="admin-inline-form signal-action-form">
          <input
            value={updateNote}
            onChange={(event) => setUpdateNote(event.target.value)}
            placeholder="Add timeline update"
            maxLength={2000}
            disabled={isSavingAction}
          />
          <button className="ghost-button compact" type="button" onClick={() => void addUpdateNote()} disabled={isSavingAction}>
            <StickyNote size={15} />
            Add note
          </button>
        </div>
        <div className="admin-inline-form signal-action-form signal-close-form">
          <input
            inputMode="decimal"
            value={manualClosePrice}
            onChange={(event) => setManualClosePrice(event.target.value)}
            placeholder="Close price"
            disabled={isFinal || isSavingAction}
          />
          <input
            value={manualCloseNote}
            onChange={(event) => setManualCloseNote(event.target.value)}
            placeholder="Optional close note"
            maxLength={1000}
            disabled={isFinal || isSavingAction}
          />
          <button
            className="ghost-button compact"
            type="button"
            onClick={() => void manuallyCloseSignal()}
            disabled={isFinal || isSavingAction}
          >
            <XCircle size={15} />
            Close
          </button>
          <button
            className="ghost-button compact danger-text"
            type="button"
            onClick={() => void markStopLossHit()}
            disabled={isFinal || isSavingAction}
          >
            SL hit
          </button>
        </div>
      </div>
    </li>
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

function AdminList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="section-panel">
      <h2>{title}</h2>
      <ul className="admin-list">{children}</ul>
    </article>
  );
}

function createBlankSignalForm(): SignalFormState {
  return {
    symbol: "",
    direction: "long",
    leverage: "1",
    entry_price: "",
    stop_loss: "",
    take_profits: [
      {
        id: createTakeProfitId(),
        price: "",
        positionSizePercent: "100",
        isHit: false,
        hitAt: null
      }
    ],
    chart_image_url: "",
    notes: ""
  };
}

function createTakeProfitId(): string {
  return `tp-${crypto.randomUUID()}`;
}

function applyDefaultTakeProfitSplit(takeProfits: SignalTakeProfitForm[]): SignalTakeProfitForm[] {
  const percentages = splitTakeProfitPercentages(takeProfits.length);

  return takeProfits.map((takeProfit, index) => ({
    ...takeProfit,
    positionSizePercent: String(percentages[index] ?? 0)
  }));
}

function normalizeTakeProfitForm(takeProfits: SignalTakeProfitForm[]): TradingSignalTakeProfit[] {
  return takeProfits.map((takeProfit, index) => ({
    id: takeProfit.id || `tp-${index + 1}`,
    price: normalizePositiveDecimal(takeProfit.price) ?? takeProfit.price.trim(),
    positionSizePercent: normalizePercent(takeProfit.positionSizePercent) ?? 0,
    isHit: takeProfit.isHit,
    hitAt: takeProfit.hitAt
  }));
}

function buildOriginalSnapshot(input: {
  generatedTitle: string;
  symbol: string;
  direction: TradingSignalDirection;
  leverage: number;
  entryPrice: string | number;
  stopLoss: string | number;
  takeProfits: TradingSignalTakeProfit[];
  notes: string | null;
  createdAt: string;
}): TradingSignalOriginalSnapshot {
  return {
    generatedTitle: input.generatedTitle,
    symbol: input.symbol,
    direction: input.direction,
    leverage: input.leverage,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    takeProfits: input.takeProfits,
    notes: input.notes,
    createdAt: input.createdAt
  };
}

function buildOriginalSnapshotFromSignal(signal: TradingSignal): TradingSignalOriginalSnapshot {
  return buildOriginalSnapshot({
    generatedTitle: signal.generated_title || signal.title || generateSignalTitle(signal.direction, signal.leverage ?? 1),
    symbol: signal.symbol,
    direction: signal.direction,
    leverage: signal.leverage ?? 1,
    entryPrice: signal.entry_price,
    stopLoss: signal.stop_loss,
    takeProfits: getSignalTakeProfits(signal),
    notes: signal.notes,
    createdAt: signal.created_at
  });
}

function signalDetailsFingerprint(
  signal:
    | TradingSignal
    | {
        generated_title: string | null;
        symbol: string;
        direction: TradingSignalDirection;
        leverage: number;
        entry_price: string | number;
        stop_loss: string | number;
        take_profits: TradingSignalTakeProfit[];
      }
): string {
  const takeProfits = "id" in signal ? getSignalTakeProfits(signal) : signal.take_profits;

  return JSON.stringify({
    title: signal.generated_title,
    symbol: signal.symbol,
    direction: signal.direction,
    leverage: Number(signal.leverage ?? 1),
    entryPrice: Number(signal.entry_price),
    stopLoss: Number(signal.stop_loss),
    takeProfits: takeProfits.map((takeProfit) => ({
      price: Number(takeProfit.price),
      positionSizePercent: Number(takeProfit.positionSizePercent)
    }))
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
  if (!Number.isFinite(numericValue)) return "N/A";

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
