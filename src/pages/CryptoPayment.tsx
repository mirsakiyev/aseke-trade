import { CheckCircle2, Clipboard, Clock3, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import {
  addressFormatWarning,
  cryptoStatusMessages,
  fetchCryptoPayment,
  formatStableAmount,
  paymentAddress,
  paymentQrUrl,
  statusTone,
  submitCryptoTx
} from "../lib/cryptoPayments";
import { formatPlanDuration, PREMIUM_PRODUCT_LABEL } from "../lib/premiumPlans";
import { formatMoney } from "../lib/validation";
import type { CryptoPayment as CryptoPaymentRecord } from "../types/content";

export function CryptoPayment() {
  const { paymentId } = useParams();
  const { refreshProfile } = useAuth();
  const [payment, setPayment] = useState<CryptoPaymentRecord | null>(null);
  const [txHash, setTxHash] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refreshPayment = useCallback(async () => {
    if (!paymentId) return;
    const nextPayment = await fetchCryptoPayment(paymentId);
    setPayment(nextPayment);
    setTxHash((current) => current || nextPayment?.tx_hash || "");
    setIsLoading(false);
  }, [paymentId]);

  useEffect(() => {
    void refreshPayment();
  }, [refreshPayment]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (payment?.status === "confirmed") {
      void refreshProfile();
    }
  }, [payment?.status, refreshProfile]);

  const expiresIn = useMemo(() => {
    if (!payment) return "";
    const remaining = Math.max(0, new Date(payment.expires_at).getTime() - now);
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }, [now, payment]);
  const statusMessage = useMemo(() => {
    if (!payment) return "";
    if (payment.status === "confirmed") {
      return payment.payment_type === "deposit"
        ? "Deposit confirmed. Account balance credited."
        : payment.product_type === "premium"
          ? "Premium subscription confirmed."
          : "Payment confirmed. Content access unlocked.";
    }

    return cryptoStatusMessages[payment.status];
  }, [payment]);

  const submitHash = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!payment || !txHash.trim() || isTerminalPaymentStatus(payment.status)) return;

    setIsSubmitting(true);
    setMessage(null);

    try {
      const nextPayment = await submitCryptoTx(payment.id, txHash);
      setPayment(nextPayment);
      setTxHash(nextPayment.tx_hash ?? txHash);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Transaction could not be submitted.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const productLabel =
    payment?.product_type === "premium"
      ? PREMIUM_PRODUCT_LABEL
      : payment?.payment_type === "deposit"
        ? "Account balance deposit"
        : payment?.product_label ?? "Premium content purchase";
  const durationLabel = payment?.product_type === "premium" ? formatPlanDuration(payment.plan_duration_months) : "";
  const rawAddress = payment ? paymentAddress(payment) : "";
  const addressWarning = payment ? addressFormatWarning(payment) : null;

  const copyAddress = async () => {
    if (!payment) return;
    await navigator.clipboard.writeText(paymentAddress(payment));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const recheckPayment = async () => {
    if (!payment) return;

    setIsSubmitting(true);
    setMessage(null);
    try {
      if (payment.tx_hash) {
        setPayment(await submitCryptoTx(payment.id, payment.tx_hash));
      } else {
        await refreshPayment();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment status could not be refreshed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <main className="page">
        <LoadingState label="Loading payment" />
      </main>
    );
  }

  if (!payment) {
    return (
      <main className="page narrow-page">
        <section className="section-panel">
          <p className="eyebrow">Payment</p>
          <h1>Payment unavailable</h1>
          <p className="muted">This payment could not be found for your account.</p>
          <Link className="primary-button" to="/account/payments">
            Payment history
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Crypto Payment</p>
          <h1>{formatStableAmount(payment.expected_amount, payment.asset)}</h1>
          <p className="muted">
            {payment.product_type === "premium"
              ? `Product: ${PREMIUM_PRODUCT_LABEL}. Duration: ${durationLabel}. Price: ${formatMoney(payment.fiat_amount_cents ?? Math.round(Number(payment.expected_amount) * 100))}.`
              : `${productLabel} - ${payment.asset} on ${payment.network}.`}{" "}
            Use the exact network and token shown here.
          </p>
        </div>
        <span className={`status-pill ${statusTone(payment.status)}`}>
          {payment.status === "confirmed" ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
          {statusMessage}
        </span>
      </section>

      {message && <p className="warning-box">{message}</p>}

      <section className="payment-grid">
        <article className="section-panel payment-instructions-panel">
          <div className="payment-qr-frame">
            <img src={paymentQrUrl(payment)} alt={`${payment.asset} ${payment.network} payment QR code`} />
          </div>
          <p className="soft-notice">
            Scan or copy the address only. Confirm the amount, asset, and network separately before sending.
          </p>

          <dl className="detail-list">
            <div>
              <dt>Product</dt>
              <dd>{productLabel}</dd>
            </div>
            {payment.product_type === "premium" && (
              <div>
                <dt>Duration</dt>
                <dd>{durationLabel}</dd>
              </div>
            )}
            <div>
              <dt>Amount</dt>
              <dd>{formatStableAmount(payment.expected_amount, payment.asset)}</dd>
            </div>
            <div>
              <dt>Asset</dt>
              <dd>{payment.asset}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{formatMoney(payment.fiat_amount_cents ?? Math.round(Number(payment.expected_amount) * 100))}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{payment.network}</dd>
            </div>
            {payment.premium_expires_at && (
              <div>
                <dt>Premium until</dt>
                <dd>{new Date(payment.premium_expires_at).toLocaleDateString()}</dd>
              </div>
            )}
            <div>
              <dt>Expires in</dt>
              <dd>{payment.status === "confirmed" ? "Confirmed" : expiresIn}</dd>
            </div>
          </dl>
        </article>

        <article className="section-panel payment-action-panel">
          <div>
            <p className="eyebrow">Receive Address</p>
            <div className="address-copy-box">
              <code>{rawAddress}</code>
              <button className="icon-button" type="button" onClick={() => void copyAddress()}>
                <Clipboard size={16} />
                <span className="sr-only">Copy address</span>
              </button>
            </div>
            {copied && <p className="form-success">Address copied.</p>}
            {addressWarning && <p className="warning-box">{addressWarning}</p>}
          </div>

          <div className="payment-warning-list">
            <p>
              <ShieldAlert size={16} />
              Do not send ETH, TRX, or any unsupported token to this invoice.
            </p>
            <p>
              <ShieldAlert size={16} />
              Wrong-network transfers may be lost and cannot unlock access.
            </p>
            <p>
              <ShieldAlert size={16} />
              Confirmation happens only after on-chain verification.
            </p>
          </div>

          <div className="manual-tx-details">
            <div>
              <p className="eyebrow">Transaction verification</p>
              <h2>Paste transaction ID after sending</h2>
              <p className="muted">
                ASEKE TRADE verifies the exact blockchain transaction before crediting balance or activating Premium.
              </p>
            </div>
            <form className="stack-form" onSubmit={submitHash}>
              <label>
                Transaction hash
                <input
                  value={txHash}
                  onChange={(event) => setTxHash(event.target.value)}
                  placeholder={payment.network === "ERC20" ? "0x..." : "TRON transaction ID"}
                  disabled={isTerminalPaymentStatus(payment.status)}
                />
              </label>
              <div className="inline-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={isSubmitting || isTerminalPaymentStatus(payment.status)}
                >
                  <Send size={17} />
                  {isSubmitting ? "Checking" : "Verify transaction"}
                </button>
                <button className="ghost-button" type="button" onClick={() => void recheckPayment()} disabled={isSubmitting}>
                  <RefreshCw size={17} />
                  Refresh status
                </button>
              </div>
            </form>
          </div>
        </article>
      </section>
    </main>
  );
}

function isTerminalPaymentStatus(status: CryptoPaymentRecord["status"]): boolean {
  return ["confirmed", "underpaid", "overpaid", "expired", "failed", "duplicate"].includes(status);
}
