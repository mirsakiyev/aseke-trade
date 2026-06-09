import { RefreshCw, Save, Search, ShieldCheck } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { LoadingState } from "../components/LoadingState";
import { cryptoStatusMessages, formatStableAmount, statusTone } from "../lib/cryptoPayments";
import { supabase } from "../lib/supabase";
import type { CryptoAsset, CryptoNetwork, CryptoPayment, CryptoPaymentStatus } from "../types/content";

type StatusFilter = "all" | CryptoPaymentStatus;
type AssetFilter = "all" | CryptoAsset;
type NetworkFilter = "all" | CryptoNetwork;

const statuses: StatusFilter[] = [
  "all",
  "pending",
  "submitted",
  "verifying",
  "confirmed",
  "underpaid",
  "expired",
  "failed",
  "duplicate"
];

export function AdminCryptoPayments() {
  const [payments, setPayments] = useState<CryptoPayment[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>("all");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [message, setMessage] = useState<string | null>(null);

  const refreshPayments = useCallback(async () => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const { data, error } = await supabase
      .from("crypto_payments")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setMessage("Crypto payments could not be loaded.");
      setPayments([]);
    } else {
      const nextPayments = (data ?? []) as CryptoPayment[];
      setPayments(nextPayments);
      setNotes(Object.fromEntries(nextPayments.map((payment) => [payment.id, payment.admin_review_notes ?? ""])));
      setMessage(null);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refreshPayments();
  }, [refreshPayments]);

  const filteredPayments = useMemo(() => {
    const query = search.trim().toLowerCase();

    return payments.filter((payment) => {
      const matchesStatus = statusFilter === "all" || payment.status === statusFilter;
      const matchesAsset = assetFilter === "all" || payment.asset === assetFilter;
      const matchesNetwork = networkFilter === "all" || payment.network === networkFilter;
      const searchable = [
        payment.id,
        payment.user_id,
        payment.course_id,
        payment.guide_id,
        payment.tx_hash,
        payment.receive_address
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesStatus && matchesAsset && matchesNetwork && (!query || searchable.includes(query));
    });
  }, [assetFilter, networkFilter, payments, search, statusFilter]);

  const saveNote = async (event: FormEvent<HTMLFormElement>, paymentId: string) => {
    event.preventDefault();
    if (!supabase) return;

    const { error } = await supabase.rpc("update_crypto_payment_admin_note", {
      target_payment_id: paymentId,
      note: notes[paymentId] ?? ""
    });

    setMessage(error ? "Review note could not be saved." : "Review note saved.");
    if (!error) await refreshPayments();
  };

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Crypto payments</h1>
          <p className="muted">Review on-chain payment attempts, transaction hashes, and admin notes.</p>
        </div>
        <button className="ghost-button" type="button" onClick={() => void refreshPayments()}>
          <RefreshCw size={17} />
          Refresh
        </button>
      </section>

      {!supabase && <p className="warning-box">Supabase is not connected.</p>}
      {message && <p className="soft-notice">{message}</p>}

      <section className="admin-payment-filters">
        <label>
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search user, payment, tx hash"
          />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
          {statuses.map((status) => (
            <option value={status} key={status}>
              {status === "all" ? "All statuses" : status}
            </option>
          ))}
        </select>
        <select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value as AssetFilter)}>
          <option value="all">All assets</option>
          <option value="USDT">USDT</option>
          <option value="USDC">USDC</option>
        </select>
        <select value={networkFilter} onChange={(event) => setNetworkFilter(event.target.value as NetworkFilter)}>
          <option value="all">All networks</option>
          <option value="TRC20">TRC20</option>
          <option value="ERC20">ERC20</option>
        </select>
      </section>

      {isLoading ? (
        <LoadingState label="Loading crypto payments" />
      ) : (
        <section className="admin-payment-list">
          {filteredPayments.map((payment) => (
            <article className="section-panel admin-payment-card" key={payment.id}>
              <div className="admin-payment-card-header">
                <div>
                  <span className={`status-pill ${statusTone(payment.status)}`}>
                    <ShieldCheck size={15} />
                    {cryptoStatusMessages[payment.status]}
                  </span>
                  <h2>{formatStableAmount(payment.expected_amount, payment.asset)}</h2>
                </div>
                <span className="status-pill premium">
                  {payment.asset} {payment.network}
                </span>
              </div>

              <dl className="payment-admin-details">
                <div>
                  <dt>User</dt>
                  <dd>{payment.user_id}</dd>
                </div>
                <div>
                  <dt>Course</dt>
                  <dd>{payment.course_id ?? "-"}</dd>
                </div>
                <div>
                  <dt>Guide</dt>
                  <dd>{payment.guide_id ?? "-"}</dd>
                </div>
                <div>
                  <dt>Expected</dt>
                  <dd>{formatStableAmount(payment.expected_amount, payment.asset)}</dd>
                </div>
                <div>
                  <dt>Received</dt>
                  <dd>{payment.received_amount ? formatStableAmount(payment.received_amount, payment.asset) : "-"}</dd>
                </div>
                <div>
                  <dt>TX Hash</dt>
                  <dd>{payment.tx_hash ?? "-"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(payment.created_at).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{new Date(payment.expires_at).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Confirmed</dt>
                  <dd>{payment.confirmed_at ? new Date(payment.confirmed_at).toLocaleString() : "-"}</dd>
                </div>
              </dl>

              <form className="stack-form" onSubmit={(event) => void saveNote(event, payment.id)}>
                <label>
                  Manual review notes
                  <textarea
                    value={notes[payment.id] ?? ""}
                    onChange={(event) =>
                      setNotes((current) => ({
                        ...current,
                        [payment.id]: event.target.value
                      }))
                    }
                    rows={3}
                  />
                </label>
                <button className="ghost-button compact" type="submit">
                  <Save size={16} />
                  Save note
                </button>
              </form>
            </article>
          ))}

          {!filteredPayments.length && (
            <article className="section-panel">
              <h2>No matching payments</h2>
              <p className="muted">Adjust filters or refresh after new checkout activity.</p>
            </article>
          )}
        </section>
      )}
    </main>
  );
}
