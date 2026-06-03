import { Check, Crown, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const premiumItems = [
  "Premium guides and advanced strategies",
  "Protected course lessons after verified access",
  "Risk management and futures education modules",
  "Dashboard tracking for purchases, saves, and progress"
];

export function Premium() {
  const { user, isPremium, isAdmin } = useAuth();

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Premium Access</p>
          <h1>Secure access structure for paid education</h1>
          <p className="muted">
            Payments are intentionally prepared as a provider-ready placeholder. Access is granted only
            through verified database records, premium profile status, or admin role.
          </p>
        </div>
        <span className="status-pill premium">
          <Crown size={15} />
          {isAdmin ? "Admin" : isPremium ? "Premium Active" : "Premium"}
        </span>
      </section>

      <section className="pricing-grid">
        <article className="pricing-card">
          <p className="eyebrow">Starter</p>
          <h2>Free</h2>
          <p className="price-line">$0</p>
          <p>Basic guides, free course previews, account dashboard, and educational risk disclaimers.</p>
          <Link className="ghost-button full-width" to="/guides">
            Browse Guides
          </Link>
        </article>

        <article className="pricing-card featured">
          <p className="eyebrow">Premium</p>
          <h2>Full Education Access</h2>
          <p className="price-line">Provider ready</p>
          <ul className="check-list">
            {premiumItems.map((item) => (
              <li key={item}>
                <Check size={17} />
                {item}
              </li>
            ))}
          </ul>
          {/* TODO: Connect this action to a trusted payment provider checkout session created server-side. */}
          <button className="primary-button full-width" type="button" disabled>
            Secure checkout pending
          </button>
        </article>

        <article className="pricing-card">
          <p className="eyebrow">Course</p>
          <h2>Individual Access</h2>
          <p className="price-line">Per course</p>
          <p>
            Designed for one-time verified purchases. The frontend reads purchase records but does not
            create paid access records directly.
          </p>
          <Link className="platinum-button full-width" to={user ? "/courses" : "/register"}>
            {user ? "View Courses" : "Create Account"}
          </Link>
        </article>
      </section>

      <section className="risk-band">
        <div>
          <p className="eyebrow">Payment Security</p>
          <h2>No fake checkout, no client-side granting</h2>
        </div>
        <p>
          Future Stripe or payment provider integration should create checkout sessions from a secure
          serverless function, validate webhooks with provider signatures, then insert or update purchases
          through a server-side service role key.
        </p>
        <ShieldCheck size={32} aria-hidden="true" />
      </section>
    </main>
  );
}
