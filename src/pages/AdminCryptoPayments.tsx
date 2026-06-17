import { Edit3, Plus, RefreshCw, Save, Search, ShieldCheck } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { LoadingState } from "../components/LoadingState";
import { cryptoStatusMessages, formatStableAmount, statusTone } from "../lib/cryptoPayments";
import { formatPlanDuration, PREMIUM_PRODUCT_LABEL } from "../lib/premiumPlans";
import { formatMoney } from "../lib/validation";
import { supabase } from "../lib/supabase";
import type { CryptoAsset, CryptoNetwork, CryptoPayment, CryptoPaymentMethod, CryptoPaymentStatus } from "../types/content";

type StatusFilter = "all" | CryptoPaymentStatus;
type AssetFilter = "all" | CryptoAsset;
type NetworkFilter = "all" | CryptoNetwork;

const statuses: StatusFilter[] = [
  "all",
  "pending",
  "submitted",
  "detected",
  "confirming",
  "verifying",
  "confirmed",
  "credited",
  "underpaid",
  "overpaid",
  "expired",
  "failed",
  "rejected",
  "duplicate"
];

const blankWalletForm = {
  id: "",
  asset: "USDT" as CryptoAsset,
  network: "TRC20" as CryptoNetwork,
  receive_address: "",
  min_confirmations: "12",
  is_active: false,
  notes: ""
};

export function AdminCryptoPayments() {
  const [payments, setPayments] = useState<CryptoPayment[]>([]);
  const [wallets, setWallets] = useState<CryptoPaymentMethod[]>([]);
  const [walletForm, setWalletForm] = useState(blankWalletForm);
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
    const [paymentResult, walletResult] = await Promise.all([
      supabase.from("crypto_payments").select("*").order("created_at", { ascending: false }),
      supabase
        .from("crypto_payment_methods")
        .select("*")
        .order("asset", { ascending: true })
        .order("network", { ascending: true })
    ]);

    if (paymentResult.error || walletResult.error) {
      setMessage("Crypto payments could not be loaded.");
      setPayments([]);
      setWallets([]);
    } else {
      const nextPayments = (paymentResult.data ?? []) as CryptoPayment[];
      setPayments(nextPayments);
      setWallets((walletResult.data ?? []) as CryptoPaymentMethod[]);
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
        payment.product_label,
        payment.product_type,
        payment.plan_id,
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

  const saveWallet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;

    const payload = {
      asset: walletForm.asset,
      network: walletForm.network,
      receive_address: walletForm.receive_address.trim(),
      min_confirmations: Number(walletForm.min_confirmations),
      is_active: walletForm.is_active,
      notes: walletForm.notes.trim() || null
    };

    const result = walletForm.id
      ? await supabase.from("crypto_payment_methods").update(payload).eq("id", walletForm.id)
      : await supabase.from("crypto_payment_methods").insert(payload);

    setMessage(
      result.error
        ? "Wallet could not be saved. Check admin access and make sure only one active wallet exists per asset/network."
        : "Wallet saved."
    );

    if (!result.error) {
      setWalletForm(blankWalletForm);
      await refreshPayments();
    }
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

      <section className="admin-grid">
        <form className="section-panel stack-form no-hover-effect" onSubmit={saveWallet}>
          <div>
            <p className="eyebrow">Receiving Wallets</p>
            <h2>{walletForm.id ? "Edit wallet" : "Add wallet"}</h2>
          </div>

          <div className="form-row">
            <label>
              Asset
              <select
                value={walletForm.asset}
                onChange={(event) => setWalletForm((form) => ({ ...form, asset: event.target.value as CryptoAsset }))}
              >
                <option value="USDT">USDT</option>
                <option value="USDC">USDC</option>
              </select>
            </label>
            <label>
              Network
              <select
                value={walletForm.network}
                onChange={(event) => setWalletForm((form) => ({ ...form, network: event.target.value as CryptoNetwork }))}
              >
                <option value="TRC20">TRC20</option>
                <option value="ERC20">ERC20</option>
              </select>
            </label>
          </div>

          <label>
            Receive address
            <input
              value={walletForm.receive_address}
              onChange={(event) => setWalletForm((form) => ({ ...form, receive_address: event.target.value }))}
              required
            />
          </label>

          <div className="form-row">
            <label>
              Confirmations
              <input
                type="number"
                min={1}
                value={walletForm.min_confirmations}
                onChange={(event) => setWalletForm((form) => ({ ...form, min_confirmations: event.target.value }))}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={walletForm.is_active}
                onChange={(event) => setWalletForm((form) => ({ ...form, is_active: event.target.checked }))}
              />
              Active
            </label>
          </div>

          <label>
            Notes
            <textarea
              value={walletForm.notes}
              onChange={(event) => setWalletForm((form) => ({ ...form, notes: event.target.value }))}
              rows={3}
            />
          </label>

          <button className="primary-button full-width" type="submit">
            <Plus size={17} />
            Save Wallet
          </button>
        </form>

        <article className="section-panel no-hover-effect">
          <h2>Configured wallets</h2>
          <ul className="admin-list">
            {wallets.map((wallet) => (
              <li key={wallet.id}>
                <div>
                  <strong>
                    {wallet.asset} {wallet.network}
                  </strong>
                  <span>
                    {wallet.is_active ? "Active" : "Inactive"} - {wallet.receive_address}
                  </span>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() =>
                    setWalletForm({
                      id: wallet.id,
                      asset: wallet.asset,
                      network: wallet.network,
                      receive_address: wallet.receive_address,
                      min_confirmations: String(wallet.min_confirmations),
                      is_active: wallet.is_active,
                      notes: wallet.notes ?? ""
                    })
                  }
                >
                  <Edit3 size={16} />
                  <span className="sr-only">Edit wallet</span>
                </button>
              </li>
            ))}
            {!wallets.length && (
              <li>
                <div>
                  <strong>No wallets configured</strong>
                  <span>Add active receiving addresses before users create payments.</span>
                </div>
              </li>
            )}
          </ul>
        </article>
      </section>

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
            <article className="section-panel admin-payment-card no-hover-effect" key={payment.id}>
              <div className="admin-payment-card-header">
                <div>
                  <span className={`status-pill ${statusTone(payment.status)}`}>
                    <ShieldCheck size={15} />
                    {cryptoStatusMessages[payment.status]}
                  </span>
                  <h2>{formatStableAmount(payment.expected_amount, payment.asset)}</h2>
                </div>
                <span className="status-pill premium">
                  {payment.product_type === "premium" ? PREMIUM_PRODUCT_LABEL : `${payment.asset} ${payment.network}`}
                </span>
              </div>

              <dl className="payment-admin-details">
                <div>
                  <dt>Product</dt>
                  <dd>{payment.product_type === "premium" ? PREMIUM_PRODUCT_LABEL : payment.product_label ?? payment.product_type}</dd>
                </div>
                <div>
                  <dt>Plan</dt>
                  <dd>{payment.plan_id ? `${payment.plan_id} (${formatPlanDuration(payment.plan_duration_months)})` : "-"}</dd>
                </div>
                <div>
                  <dt>Price</dt>
                  <dd>{payment.fiat_amount_cents ? formatMoney(payment.fiat_amount_cents) : "-"}</dd>
                </div>
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
                <div>
                  <dt>Trading Academy starts</dt>
                  <dd>{payment.premium_starts_at ? new Date(payment.premium_starts_at).toLocaleString() : "-"}</dd>
                </div>
                <div>
                  <dt>Trading Academy expires</dt>
                  <dd>{payment.premium_expires_at ? new Date(payment.premium_expires_at).toLocaleString() : "-"}</dd>
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
            <article className="section-panel no-hover-effect">
              <h2>No matching payments</h2>
              <p className="muted">Adjust filters or refresh after new checkout activity.</p>
            </article>
          )}
        </section>
      )}
    </main>
  );
}
