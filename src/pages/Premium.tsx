import { Check, Crown, ShieldCheck, Sparkles, WalletCards, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { formatPremiumPrice, PREMIUM_PLANS, premiumCheckoutPath, type PremiumPlanId } from "../lib/premiumPlans";
import { formatMoney } from "../lib/validation";

const premiumPerks = [
  "Access the ASEKE TRADE Trading Academy",
  "Study advanced trading lessons step by step",
  "Build risk management and trade review habits",
  "Learn trading psychology and execution discipline",
  "Study futures, leverage, liquidation, and derivatives",
  "Review Premium market examples and trading signals",
  "Request individual strategy support",
  "Access 1-on-1 learning guidance when available"
];

const comparisonRows = [
  { feature: "Crypto basics", free: true, premium: true },
  { feature: "Wallet safety and self-custody", free: true, premium: true },
  { feature: "Beginner guides and market foundations", free: true, premium: true },
  { feature: "Limited educational content", free: true, premium: true },
  { feature: "Trading Academy access", free: false, premium: true },
  { feature: "Advanced trading strategies", free: false, premium: true },
  { feature: "Technical analysis education", free: false, premium: true },
  { feature: "Risk management masterclass", free: false, premium: true },
  { feature: "Trading psychology", free: false, premium: true },
  { feature: "Futures and derivatives education", free: false, premium: true },
  { feature: "Premium trading signals", free: false, premium: true },
  { feature: "Individual trading strategy support", free: false, premium: true },
  { feature: "1-on-1 training access", free: false, premium: true }
];

export function Premium() {
  const { user, profile, isPremium, isAdmin } = useAuth();
  const premiumUntil = profile?.premium_until ? new Date(profile.premium_until).toLocaleDateString() : "Not active";

  const planLink = (planId: PremiumPlanId) => (user ? premiumCheckoutPath(planId) : "/register");

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Trading Academy</p>
          <h1>Join the ASEKE TRADE Trading Academy</h1>
          <p className="muted">
            Premium unlocks advanced trading education, risk management frameworks, trading psychology,
            futures and derivatives lessons, Premium signals, individual strategy support, and 1-on-1 guidance.
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
          <h2>Foundation access</h2>
          <p className="price-line">$0</p>
          <p>
            Learn crypto basics, wallet safety, beginner guides, and market foundations before risking capital.
          </p>
          <ul className="check-list">
            <li>
              <Check size={17} />
              Free beginner courses and guides
            </li>
            <li>
              <Check size={17} />
              Crypto basics, wallet safety, and market foundations
            </li>
            <li>
              <X size={17} />
              Trading Academy, signals, strategy support, and 1-on-1 guidance are Premium
            </li>
          </ul>
          <Link className="ghost-button full-width" to="/guides">
            Start Learning Free
          </Link>
        </article>

        {PREMIUM_PLANS.map((plan) => (
          <article className={plan.featured ? "pricing-card featured" : "pricing-card"} key={plan.id}>
            <p className="eyebrow">{plan.badge}</p>
            <h2>Trading Academy</h2>
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
              Join Trading Academy - {plan.durationLabel} / {formatPremiumPrice(plan.priceCents)}
            </Link>
          </article>
        ))}
      </section>

      <section className="section-panel page-stack">
        <div className="lesson-title-line">
          <div>
            <p className="eyebrow">Premium Perks</p>
            <h2>What the Trading Academy includes</h2>
          </div>
          <span className="status-pill premium">
            <Sparkles size={15} />
            Premium education
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
          <h2>Free foundations vs Premium Trading Academy</h2>
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
          <h2>Educational access, verified securely</h2>
        </div>
        <p>
          Premium content is educational only and does not guarantee profits. Access unlocks only after a
          verified on-chain payment or a successful account balance purchase, with expiry tracked on your profile.
        </p>
        <ShieldCheck size={32} aria-hidden="true" />
      </section>
    </main>
  );
}
