import { ArrowRight, BookOpen, BrainCircuit, Crown, GraduationCap, ShieldAlert, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";

const learningAreas = [
  {
    title: "Free Foundations",
    text: "Start with crypto basics, wallet safety, exchanges, and self-custody before risking real capital.",
    icon: BookOpen
  },
  {
    title: "Trading Academy",
    text: "Move into market structure, chart reading, technical analysis, futures, leverage, and derivatives education.",
    icon: TrendingUp
  },
  {
    title: "Strategy Frameworks",
    text: "Turn support, resistance, execution rules, journaling, and review into a repeatable trading process.",
    icon: GraduationCap
  },
  {
    title: "Academy Support",
    text: "Unlock Trading Academy signals, individual strategy support, and 1-on-1 guidance for serious learners.",
    icon: Crown
  }
];

const whyItems = [
  {
    title: "Trading-focused education",
    text: "The main path is built around chart reading, market structure, technical analysis, and risk management.",
    icon: TrendingUp
  },
  {
    title: "Beginner-to-advanced structure",
    text: "Learn the foundations first, then progress toward advanced Trading Academy materials at a realistic pace.",
    icon: GraduationCap
  },
  {
    title: "Risk before capital",
    text: "Every trading topic is framed around position sizing, liquidation awareness, discipline, and account safety.",
    icon: ShieldAlert
  },
  {
    title: "No profit promises",
    text: "ASEKE TRADE provides educational examples and support, not hype, result promises, or get-rich-quick claims.",
    icon: BrainCircuit
  }
];

export function Home() {
  return (
    <main>
      <section className="hero">
        <div className="hero-overlay" />
        <div className="page hero-content">
          <p className="eyebrow">Structured Crypto Trading Education</p>
          <h1>From Zero to Disciplined Trader</h1>
          <p className="hero-lede">
            ASEKE TRADE helps you learn crypto from the ground up: wallet safety, market foundations,
            chart reading, technical analysis, risk management, trading psychology, futures,
            derivatives, and practical strategy development.
          </p>
          <div className="hero-actions" aria-label="Primary actions">
            <Link className="primary-button" to="/trading-academy">
              Join Trading Academy
              <ArrowRight size={18} />
            </Link>
            <Link className="ghost-button" to="/guides">
              Start Learning Free
            </Link>
            <Link className="ghost-button" to="/quiz">
              Take the Crypto Level Quiz
              <BrainCircuit size={18} />
            </Link>
          </div>
        </div>
      </section>

      <section className="page market-showcase">
        <div className="market-image">
          <img src="/assets/aseke-trade-hero.png" alt="Crypto market desk representing Trading Academy signals" />
        </div>
        <div className="market-copy">
          <p className="eyebrow">Trading Academy Signals</p>
          <h2>Get educational trade signals with Academy access</h2>
          <p>
            Join Trading Academy to review active ASEKE TRADE signals with entry zones, leverage,
            take-profit targets, stop-loss updates, and completed trade history in one dashboard.
          </p>
          <div className="market-tags" aria-label="Market focus areas">
            <span>Active Signals</span>
            <span>TP / SL Updates</span>
            <span>Past Trades</span>
          </div>
          <Link className="primary-button compact market-signal-cta" to="/trading-academy">
            Join Trading Academy
            <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      <section className="page section-grid">
        <div className="section-heading">
          <p className="eyebrow">Why ASEKE TRADE?</p>
          <h2>Practical crypto trading education without hype</h2>
        </div>
        <div className="feature-grid">
          {whyItems.map((item) => {
            const Icon = item.icon;
            return (
              <article className="feature-card" key={item.title}>
                <span className="feature-icon">
                  <Icon size={20} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="page section-grid">
        <div className="section-heading">
          <p className="eyebrow">Curriculum</p>
          <h2>Free foundations first, Trading Academy when you are ready</h2>
        </div>
        <div className="feature-grid">
          {learningAreas.map((area) => {
            const Icon = area.icon;
            return (
              <article className="feature-card" key={area.title}>
                <span className="feature-icon">
                  <Icon size={20} />
                </span>
                <h3>{area.title}</h3>
                <p>{area.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="page">
        <div className="risk-band">
          <div>
            <p className="eyebrow">Risk Standard</p>
            <h2>Master risk before chasing profit.</h2>
          </div>
          <p>
            ASEKE TRADE content is educational only and is not financial advice. Crypto and futures
            trading can cause substantial losses. Every learner is responsible for their own decisions,
            risk limits, and account security.
          </p>
          <ShieldAlert size={32} aria-hidden="true" />
        </div>
      </section>
    </main>
  );
}
