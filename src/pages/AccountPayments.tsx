import { ArrowRight, BookOpen, Clock3, Copy, Hash, HelpCircle, Plus, ShieldAlert, WalletCards } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { useAccountStatus } from "../hooks/useAccountStatus";
import {
  createCryptoDeposit,
  cryptoPaymentMethods,
  cryptoStatusMessages,
  fetchAccountBalanceTransactions,
  fetchUserCryptoPayments,
  formatStableAmount,
  statusTone
} from "../lib/cryptoPayments";
import { formatUsd } from "../lib/accountStatus";
import { formatPlanDuration, PREMIUM_PRODUCT_LABEL } from "../lib/premiumPlans";
import { formatMoney } from "../lib/validation";
import type { AccountBalanceTransaction, CryptoPayment } from "../types/content";

const MIN_DEPOSIT_USD = 10;
const DEFAULT_DEPOSIT_AMOUNT = "10.00";

export function AccountPayments() {
  const { user } = useAuth();
  const accountStatus = useAccountStatus();
  const navigate = useNavigate();
  const [payments, setPayments] = useState<CryptoPayment[]>([]);
  const [transactions, setTransactions] = useState<AccountBalanceTransaction[]>([]);
  const [selectedMethod, setSelectedMethod] = useState(cryptoPaymentMethods[0]);
  const [depositAmount, setDepositAmount] = useState(DEFAULT_DEPOSIT_AMOUNT);
  const [showDepositGuide, setShowDepositGuide] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingDeposit, setIsCreatingDeposit] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    if (!user) {
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }

    Promise.all([
      fetchUserCryptoPayments(user.id),
      fetchAccountBalanceTransactions(user.id)
    ]).then(([nextPayments, nextTransactions]) => {
      if (!mounted) return;
      setPayments(nextPayments);
      setTransactions(nextTransactions);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [user]);

  const createDeposit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;

    setIsCreatingDeposit(true);
    setMessage(null);

    try {
      const numericAmount = Number(depositAmount);
      if (!Number.isFinite(numericAmount) || numericAmount < MIN_DEPOSIT_USD) {
        throw new Error("Minimum deposit is 10 USD.");
      }

      const response = await createCryptoDeposit({
        amount: depositAmount,
        asset: selectedMethod.asset,
        network: selectedMethod.network
      });
      navigate(`/payment/${response.payment.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not start this deposit. Please try again.");
    } finally {
      setIsCreatingDeposit(false);
    }
  };

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Balance and payment history</h1>
          <p className="muted">
            Top up your account, review crypto deposits, and track verified Premium access.
          </p>
        </div>
        <span className="status-pill premium">
          <WalletCards size={15} />
          {accountStatus.balanceLabel}
        </span>
      </section>

      {message && <p className="warning-box">{message}</p>}

      {isLoading ? (
        <LoadingState label="Loading payments" />
      ) : (
        <>
          <section className="checkout-grid">
            <article className="section-panel">
              <p className="eyebrow">Available Balance</p>
              <h2>{accountStatus.balanceLabel}</h2>
              <p className="muted">
                Plan: {accountStatus.planLabel}. Verified deposits credit this balance. Balance purchases deduct from it
                and create a payment history entry.
              </p>
            </article>

            <form className="section-panel stack-form" onSubmit={createDeposit}>
              <div>
                <p className="eyebrow">Deposit Crypto</p>
                <h2>Top up balance</h2>
                <p className="muted">
                  Minimum deposit: $10.00. The QR code and copy button show the receiving address only.
                </p>
              </div>

              <label>
                Amount
                <input
                  type="number"
                  inputMode="decimal"
                  min={MIN_DEPOSIT_USD}
                  step="0.01"
                  value={depositAmount}
                  onChange={(event) => setDepositAmount(event.target.value)}
                  placeholder={DEFAULT_DEPOSIT_AMOUNT}
                  aria-describedby="deposit-minimum"
                  required
                />
              </label>
              <p className="form-hint" id="deposit-minimum">
                Enter at least $10.00. Send the exact stablecoin amount shown on the payment page.
              </p>

              <div className="payment-method-grid" role="radiogroup" aria-label="Deposit method">
                {cryptoPaymentMethods.map((method) => (
                  <label className="payment-method-option" key={`${method.asset}-${method.network}`}>
                    <input
                      type="radio"
                      name="deposit-method"
                      checked={method.asset === selectedMethod.asset && method.network === selectedMethod.network}
                      onChange={() => setSelectedMethod(method)}
                    />
                    <span>
                      <strong>{method.label}</strong>
                      <small>{method.warning}</small>
                    </span>
                  </label>
                ))}
              </div>

              <button className="primary-button full-width" type="submit" disabled={isCreatingDeposit}>
                <Plus size={17} />
                {isCreatingDeposit ? "Creating deposit" : "Create deposit request"}
              </button>
              <button
                className="ghost-button full-width"
                type="button"
                onClick={() => setShowDepositGuide((open) => !open)}
                aria-controls="crypto-deposit-guide"
                aria-expanded={showDepositGuide}
              >
                <HelpCircle size={17} />
                {showDepositGuide ? "Hide deposit guide" : "How to deposit with crypto"}
              </button>
            </form>
          </section>

          {showDepositGuide && <CryptoDepositGuide />}

          {payments.length ? (
            <section className="payment-history-list">
              {payments.map((payment) => (
                <article className="section-panel payment-history-card" key={payment.id}>
                  <div>
                    <span className={`status-pill ${statusTone(payment.status)}`}>
                      <Clock3 size={15} />
                      {cryptoStatusMessages[payment.status]}
                    </span>
                    <h2>
                      {payment.product_type === "premium"
                        ? `${PREMIUM_PRODUCT_LABEL} - ${formatPlanDuration(payment.plan_duration_months)}`
                        : formatStableAmount(payment.expected_amount, payment.asset)}
                    </h2>
                    <p className="muted">
                      {paymentDisplayLabel(payment)} - {payment.asset} {payment.network} -
                      Created {new Date(payment.created_at).toLocaleString()}
                    </p>
                    {payment.product_type === "premium" && (
                      <p className="muted">
                        Price {formatMoney(payment.fiat_amount_cents ?? Math.round(Number(payment.expected_amount) * 100))}
                        {payment.premium_expires_at
                          ? ` - Premium until ${new Date(payment.premium_expires_at).toLocaleDateString()}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <div className="inline-actions">
                    <Link className="ghost-button compact" to={`/payment/${payment.id}`}>
                      View payment
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <section className="section-panel">
              <p className="eyebrow">No Payments</p>
              <h2>No crypto payments yet</h2>
              <p className="muted">
                You have no payments yet. Top up your balance or join the Trading Academy when you are ready.
              </p>
              <Link className="primary-button" to="/premium">
                Join Trading Academy
              </Link>
            </section>
          )}

          {transactions.length > 0 && (
            <section className="section-panel">
              <p className="eyebrow">Balance Ledger</p>
              <h2>Account balance activity</h2>
              <ul className="plain-list">
                {transactions.map((transaction) => (
                  <li key={transaction.id}>
                    <strong>{transaction.description ?? transaction.transaction_type}</strong>
                    <span>
                      {formatLedgerAmount(transaction.amount_cents)} - {new Date(transaction.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function CryptoDepositGuide() {
  const steps = [
    "Choose a deposit amount of $10.00 or more.",
    "Choose the exact asset and network you will send from your wallet or exchange.",
    "Create the payment request, then copy or scan the receiving address.",
    "Paste the address into your wallet or exchange withdrawal screen.",
    "Send only the selected asset on the selected network shown by ASEKE TRADE.",
    "After sending, copy the transaction hash, transaction ID, or TxID from your withdrawal details.",
    "Paste that transaction hash on the ASEKE TRADE payment page so the server can verify the transfer on-chain."
  ];

  return (
    <section className="section-panel deposit-guide-panel" id="crypto-deposit-guide">
      <div>
        <p className="eyebrow">Deposit Guide</p>
        <h2>How to deposit with crypto</h2>
        <p className="muted">
          Use only the supported asset and network shown on your invoice. The address QR and copy button contain only
          the receiving address; confirm amount, asset, and network separately before sending.
        </p>
      </div>

      <div className="guide-step-grid">
        {steps.map((step, index) => (
          <article className="guide-step-card" key={step}>
            <span>{index + 1}</span>
            <p>{step}</p>
          </article>
        ))}
      </div>

      <div className="guide-visual-grid" aria-label="Crypto deposit visual placeholders">
        <article>
          <Copy size={18} />
          <strong>Screenshot: Copy address from ASEKE TRADE</strong>
        </article>
        <article>
          <BookOpen size={18} />
          <strong>Screenshot: Paste address in wallet or exchange</strong>
        </article>
        <article>
          <Hash size={18} />
          <strong>Screenshot: Find transaction hash after sending</strong>
        </article>
      </div>

      <div className="payment-warning-list deposit-guide-warnings">
        <p>
          <ShieldAlert size={16} />
          USDT TRC20 must be sent on TRON/TRC20. USDT ERC20 and USDC ERC20 must be sent on Ethereum/ERC20.
        </p>
        <p>
          <ShieldAlert size={16} />
          Sending the wrong asset or network may result in lost funds. Never paste a seed phrase or private key.
        </p>
        <p>
          <ShieldAlert size={16} />
          Crypto transfers usually cannot be reversed. If a payment is delayed, wait for confirmations and refresh the
          payment page, then paste the transaction hash again if needed.
        </p>
      </div>

      <p className="soft-notice">
        A transaction hash, also called transaction ID or TxID, is the unique blockchain receipt for your transfer. Most
        wallets and exchanges show it after withdrawal under transaction details, withdrawal history, or activity.
      </p>
    </section>
  );
}

function formatLedgerAmount(cents: number): string {
  const prefix = cents > 0 ? "+" : "-";
  return `${prefix}${formatUsd(Math.abs(cents))}`;
}

function paymentDisplayLabel(payment: CryptoPayment): string {
  if (payment.payment_type === "deposit") return "Deposit";
  if (payment.product_type === "premium") {
    return `${PREMIUM_PRODUCT_LABEL} ${formatPlanDuration(payment.plan_duration_months)}`.trim();
  }
  return payment.product_label ?? "Purchase";
}
