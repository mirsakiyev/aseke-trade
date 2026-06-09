import { AlertTriangle, ArrowRight, LockKeyhole, WalletCards } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { useAccountStatus } from "../hooks/useAccountStatus";
import {
  createCryptoPayment,
  cryptoPaymentMethods,
  fetchCheckoutItem,
  spendAccountBalance,
  type CheckoutItem
} from "../lib/cryptoPayments";
import { formatUsd } from "../lib/accountStatus";
import { PREMIUM_PRODUCT_LABEL } from "../lib/premiumPlans";
import { formatMoney } from "../lib/validation";

export function CryptoCheckout() {
  const { itemType, itemId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const accountStatus = useAccountStatus();
  const [item, setItem] = useState<CheckoutItem | null>(null);
  const [selectedMethod, setSelectedMethod] = useState(cryptoPaymentMethods[0]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isPayingWithBalance, setIsPayingWithBalance] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    fetchCheckoutItem(itemType, itemId).then((nextItem) => {
      if (!mounted) return;
      setItem(nextItem);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [itemId, itemType]);

  const checkoutType = useMemo(() => {
    if (itemType === "premium") return "premium";
    return itemType === "guide" ? "guide" : "course";
  }, [itemType]);
  const availableBalance = accountStatus.balanceCents;
  const canPayWithBalance = Boolean(item && item.price_cents > 0 && availableBalance >= item.price_cents);
  const isPremiumCheckout = item?.itemType === "premium";

  const createPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!item || !user) return;

    setIsCreating(true);
    setMessage(null);

    try {
      const response = await createCryptoPayment({
        itemType: checkoutType,
        itemId: item.itemType === "premium" ? undefined : item.id,
        planId: item.plan_id,
        asset: selectedMethod.asset,
        network: selectedMethod.network
      });
      navigate(`/payment/${response.payment.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Crypto checkout could not be started.");
    } finally {
      setIsCreating(false);
    }
  };

  const payWithBalance = async () => {
    if (!item || !user) return;

    setIsPayingWithBalance(true);
    setMessage(null);

    try {
      await spendAccountBalance({
        itemType: checkoutType,
        itemId: item.itemType === "premium" ? undefined : item.id,
        planId: item.plan_id
      });
      navigate("/account/payments");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Balance payment could not be completed.");
    } finally {
      setIsPayingWithBalance(false);
    }
  };

  if (isLoading) {
    return (
      <main className="page">
        <LoadingState label="Loading checkout" />
      </main>
    );
  }

  if (!item) {
    return (
      <main className="page narrow-page">
        <section className="section-panel">
          <p className="eyebrow">Checkout</p>
          <h1>Item unavailable</h1>
          <p className="muted">This course or guide cannot be prepared for checkout.</p>
          <Link className="primary-button" to="/courses">
            Back to courses
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Crypto Checkout</p>
          <h1>{isPremiumCheckout ? PREMIUM_PRODUCT_LABEL : item.title}</h1>
          <p className="muted">
            {isPremiumCheckout
              ? `Product: ${PREMIUM_PRODUCT_LABEL}. Duration: ${item.duration_label}. Price: ${formatMoney(item.price_cents)}.`
              : item.description}
          </p>
        </div>
        <span className="status-pill premium">
          <WalletCards size={15} />
          {formatMoney(item.price_cents)}
        </span>
      </section>

      {message && <p className="warning-box">{message}</p>}

      {!user ? (
        <section className="section-panel checkout-auth-panel">
          <LockKeyhole size={28} />
          <div>
            <h2>Login to continue</h2>
            <p className="muted">Crypto payment intents are attached to your ASEKE TRADE account.</p>
          </div>
          <div className="inline-actions">
            <Link className="primary-button" to="/login">
              Login
            </Link>
            <Link className="ghost-button" to="/register">
              Register
            </Link>
          </div>
        </section>
      ) : (
        <form className="checkout-grid" onSubmit={createPayment}>
          <section className="section-panel checkout-method-panel">
            <div>
              <p className="eyebrow">Select Network</p>
              <h2>{isPremiumCheckout ? "Pay for Premium with crypto" : "Buy with crypto"}</h2>
            </div>

            <div className="payment-method-grid" role="radiogroup" aria-label="Payment method">
              {cryptoPaymentMethods.map((method) => (
                <label className="payment-method-option" key={`${method.asset}-${method.network}`}>
                  <input
                    type="radio"
                    name="payment-method"
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
          </section>

          <aside className="section-panel checkout-summary-panel">
            <p className="eyebrow">Payment Summary</p>
            <dl className="detail-list">
              <div>
                <dt>Product</dt>
                <dd>{isPremiumCheckout ? PREMIUM_PRODUCT_LABEL : item.title}</dd>
              </div>
              {isPremiumCheckout && (
                <div>
                  <dt>Duration</dt>
                  <dd>{item.duration_label}</dd>
                </div>
              )}
              <div>
                <dt>Price</dt>
                <dd>{formatMoney(item.price_cents)}</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>{selectedMethod.label}</dd>
              </div>
              <div>
                <dt>Account balance</dt>
                <dd>{formatUsd(availableBalance)}</dd>
              </div>
            </dl>

            <div className="payment-warning-list">
              <p>
                <AlertTriangle size={16} />
                Sending on the wrong network may result in lost funds.
              </p>
              <p>
                <AlertTriangle size={16} />
                {isPremiumCheckout
                  ? "Premium starts or extends only after blockchain verification."
                  : "Access unlocks only after blockchain verification."}
              </p>
              <p>
                <AlertTriangle size={16} />
                Crypto payments may be irreversible.
              </p>
            </div>

            <button className="primary-button full-width" type="submit" disabled={isCreating || item.price_cents <= 0}>
              {isCreating ? "Creating payment" : "Continue"}
              <ArrowRight size={17} />
            </button>
            <button
              className="ghost-button full-width"
              type="button"
              disabled={!canPayWithBalance || isPayingWithBalance}
              onClick={() => void payWithBalance()}
            >
              {isPayingWithBalance ? "Processing balance" : "Pay with Balance"}
            </button>
          </aside>
        </form>
      )}
    </main>
  );
}
