import { ArrowRight, Clock3, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { cryptoStatusMessages, fetchUserCryptoPayments, formatStableAmount, statusTone } from "../lib/cryptoPayments";
import type { CryptoPayment } from "../types/content";

export function AccountPayments() {
  const { user } = useAuth();
  const [payments, setPayments] = useState<CryptoPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    if (!user) {
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }

    fetchUserCryptoPayments(user.id).then((nextPayments) => {
      if (!mounted) return;
      setPayments(nextPayments);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [user]);

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
          Crypto
        </span>
      </section>

      {isLoading ? (
        <LoadingState label="Loading payments" />
      ) : payments.length ? (
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
                  {payment.asset} {payment.network} - Created {new Date(payment.created_at).toLocaleString()}
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
          <p className="muted">Premium course and guide checkouts will appear here.</p>
          <Link className="primary-button" to="/courses">
            Browse courses
          </Link>
        </section>
      )}
    </main>
  );
}
