import { ArrowRight, Clock3, Plus, WalletCards } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import {
  createCryptoDeposit,
  cryptoPaymentMethods,
  cryptoStatusMessages,
  fetchAccountBalance,
  fetchAccountBalanceTransactions,
  fetchUserCryptoPayments,
  formatStableAmount,
  statusTone
} from "../lib/cryptoPayments";
import { formatMoney } from "../lib/validation";
import type { AccountBalance, AccountBalanceTransaction, CryptoPayment } from "../types/content";

export function AccountPayments() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [payments, setPayments] = useState<CryptoPayment[]>([]);
  const [balance, setBalance] = useState<AccountBalance | null>(null);
  const [transactions, setTransactions] = useState<AccountBalanceTransaction[]>([]);
  const [selectedMethod, setSelectedMethod] = useState(cryptoPaymentMethods[0]);
  const [depositAmount, setDepositAmount] = useState("50.00");
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
      fetchAccountBalance(user.id),
      fetchAccountBalanceTransactions(user.id)
    ]).then(([nextPayments, nextBalance, nextTransactions]) => {
      if (!mounted) return;
      setPayments(nextPayments);
      setBalance(nextBalance);
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
      const response = await createCryptoDeposit({
        amount: depositAmount,
        asset: selectedMethod.asset,
        network: selectedMethod.network
      });
      navigate(`/payment/${response.payment.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deposit invoice could not be created.");
    } finally {
      setIsCreatingDeposit(false);
    }
  };

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Crypto payment history</h1>
          <p className="muted">Track pending invoices, submitted transactions, and confirmed premium access.</p>
        </div>
        <span className="status-pill premium">
          <WalletCards size={15} />
          {formatMoney(balance?.balance_cents ?? 0)}
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
              <h2>{formatMoney(balance?.balance_cents ?? 0)}</h2>
              <p className="muted">
                Verified deposits credit this balance. Balance purchases deduct from it and create an audit entry.
              </p>
            </article>

            <form className="section-panel stack-form" onSubmit={createDeposit}>
              <div>
                <p className="eyebrow">Deposit Crypto</p>
                <h2>Create deposit invoice</h2>
              </div>

              <label>
                Amount
                <input
                  inputMode="decimal"
                  value={depositAmount}
                  onChange={(event) => setDepositAmount(event.target.value)}
                  placeholder="50.00"
                  required
                />
              </label>

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
                {isCreatingDeposit ? "Creating deposit" : "Create Deposit"}
              </button>
            </form>
          </section>

          {payments.length ? (
            <section className="payment-history-list">
              {payments.map((payment) => (
                <article className="section-panel payment-history-card" key={payment.id}>
                  <div>
                    <span className={`status-pill ${statusTone(payment.status)}`}>
                      <Clock3 size={15} />
                      {cryptoStatusMessages[payment.status]}
                    </span>
                    <h2>{formatStableAmount(payment.expected_amount, payment.asset)}</h2>
                    <p className="muted">
                      {payment.payment_type === "deposit" ? "Deposit" : "Purchase"} - {payment.asset} {payment.network} -
                      Created {new Date(payment.created_at).toLocaleString()}
                    </p>
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
              <p className="muted">Premium purchases and balance deposits will appear here.</p>
              <Link className="primary-button" to="/courses">
                Browse courses
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

function formatLedgerAmount(cents: number): string {
  const prefix = cents > 0 ? "+" : "-";
  return `${prefix}${formatMoney(Math.abs(cents))}`;
}
