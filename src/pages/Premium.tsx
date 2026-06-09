import { Check, Crown, ShieldCheck, Sparkles, WalletCards, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { formatPremiumPrice, PREMIUM_PLANS, premiumCheckoutPath, type PremiumPlanId } from "../lib/premiumPlans";
import { formatMoney } from "../lib/validation";

const premiumPerks = [
  "Access to Premium courses/guides",
  "Premium trading signals",
  "Individual strategy creation for Premium users",
  "1-on-1 training sessions",
  "Advanced trading education",
  "Risk management lessons",
  "Futures and derivatives education",
  "Priority updates for new Premium materials"
];

const comparisonRows = [
  { feature: "Beginner crypto education", free: true, premium: true },
  { feature: "Crypto Foundations", free: true, premium: true },
  { feature: "Crypto Safety & Security", free: true, premium: true },
  { feature: "Limited guides", free: true, premium: true },
  { feature: "Trading Academy access", free: false, premium: true },
  { feature: "Premium trading signals", free: false, premium: true },
  { feature: "Individual trading strategy help", free: false, premium: true },
  { feature: "1-on-1 training", free: false, premium: true },
  { feature: "Advanced trading guides", free: false, premium: true },
  { feature: "Futures, leverage, liquidation, and derivatives education", free: false, premium: true },
  { feature: "Risk management masterclass", free: false, premium: true },
  { feature: "Trading psychology content", free: false, premium: true }
];

export function Premium() {
  const { user, profile, isPremium, isAdmin } = useAuth();
  const premiumUntil = profile?.premium_until ? new Date(profile.premium_until).toLocaleDateString() : "Not active";

  const planLink = (planId: PremiumPlanId) => (user ? premiumCheckoutPath(planId) : "/register");

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Premium Access</p>
          <h1>Premium crypto education with time-based access</h1>
          <p className="muted">
            Choose a Premium subscription, pay with verified crypto or account balance, and keep access until
            the subscription expiry date.
          </p>
        </div>
        <span className="status-pill premium">
          <Crown size={15} />
          {isAdmin ? "Admin" : isPremium ? `Active until ${premiumUntil}` : "Premium"}
        </span>
      </section>

      <section className="pricing-grid premium-plan-grid">
        <article className="pricing-card">
          <p className="eyebrow">Free</p>
          <h2>Starter access</h2>
          <p className="price-line">$0</p>
          <p>Beginner education, crypto basics, basic market education, and limited free content.</p>
          <ul className="check-list">
            <li>
              <Check size={17} />
              Access to free beginner courses/guides
            </li>
            <li>
              <Check size={17} />
              Crypto basics and safety foundations
            </li>
            <li>
              <X size={17} />
              No Premium signals, strategy support, or 1-on-1 training
            </li>
          </ul>
          <Link className="ghost-button full-width" to="/guides">
            Browse Free Guides
          </Link>
        </article>

        {PREMIUM_PLANS.map((plan) => (
          <article className={plan.featured ? "pricing-card featured" : "pricing-card"} key={plan.id}>
            <p className="eyebrow">{plan.badge}</p>
            <h2>{plan.productLabel}</h2>
            <p className="price-line">
              {formatMoney(plan.priceCents)}
              <span> / {plan.durationLabel}</span>
            </p>
            <p>{plan.description}</p>
            <ul className="check-list">
              {premiumPerks.slice(0, 5).map((item) => (
                <li key={item}>
                  <Check size={17} />
                  {item}
                </li>
              ))}
            </ul>
            <Link className="primary-button full-width" to={planLink(plan.id)}>
              <WalletCards size={17} />
              Get Premium - {plan.durationLabel} / {formatPremiumPrice(plan.priceCents)}
            </Link>
          </article>
        ))}
      </section>

      <section className="section-panel page-stack">
        <div className="lesson-title-line">
          <div>
            <p className="eyebrow">Premium Perks</p>
            <h2>What Premium includes</h2>
          </div>
          <span className="status-pill premium">
            <Sparkles size={15} />
            Placeholder perks
          </span>
        </div>
        <div className="premium-perk-grid">
          {premiumPerks.map((perk) => (
            <div className="premium-perk" key={perk}>
              <Check size={17} />
              <span>{perk}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section-panel page-stack">
        <div>
          <p className="eyebrow">Comparison</p>
          <h2>Free vs Premium</h2>
        </div>
        <div className="comparison-table" role="table" aria-label="Free and Premium comparison">
          <div className="comparison-row comparison-head" role="row">
            <span role="columnheader">Feature</span>
            <span role="columnheader">Free</span>
            <span role="columnheader">Premium</span>
          </div>
          {comparisonRows.map((row) => (
            <div className="comparison-row" role="row" key={row.feature}>
              <span role="cell">{row.feature}</span>
              <span role="cell">{row.free ? <Check size={17} /> : <X size={17} />}</span>
              <span role="cell">{row.premium ? <Check size={17} /> : <X size={17} />}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="risk-band">
        <div>
          <p className="eyebrow">Payment Security</p>
          <h2>Verified access only</h2>
        </div>
        <p>
          Premium unlocks only after verified on-chain payment or a successful account balance purchase.
          Expiry is tracked on your ASEKE TRADE profile.
        </p>
        <ShieldCheck size={32} aria-hidden="true" />
      </section>
    </main>
  );
}
