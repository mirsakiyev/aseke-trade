import { ArrowRight, BookOpen, BrainCircuit, Crown, GraduationCap, ShieldAlert, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";

const learningAreas = [
  {
    title: "Beginner Guides",
    text: "Start with wallets, exchanges, Bitcoin basics, and security habits before moving capital.",
    icon: BookOpen
  },
  {
    title: "Advanced Trading",
    text: "Study higher-timeframe structure, leverage limits, liquidation awareness, and execution review.",
    icon: TrendingUp
  },
  {
    title: "Strategies",
    text: "Turn support, resistance, scalping, and swing trading concepts into planned decision frameworks.",
    icon: GraduationCap
  },
  {
    title: "Premium Courses",
    text: "Unlock deeper modules, premium guides, and structured learning paths for committed traders.",
    icon: Crown
  }
];

export function Home() {
  return (
    <main>
      <section className="hero">
        <div className="hero-overlay" />
        <div className="page hero-content">
          <p className="eyebrow">Premium Crypto Education Platform</p>
          <h1>ASEKE TRADE</h1>
          <p className="hero-lede">
            Learn crypto markets with a clean, disciplined framework for tutorials, trading strategy,
            risk management, futures education, and premium courses.
          </p>
          <p className="founder-line">Founded by Aslan Mirsakiyev, aka Aseke.</p>

          <div className="hero-actions" aria-label="Primary actions">
            <Link className="primary-button" to="/guides">
              Start Learning
              <ArrowRight size={18} />
            </Link>
            <Link className="ghost-button" to="/courses">
              View Courses
            </Link>
            <Link className="ghost-button" to="/quiz">
              Take Quiz
              <BrainCircuit size={18} />
            </Link>
            <Link className="platinum-button" to="/premium">
              Join Premium
            </Link>
          </div>
        </div>
      </section>

      <section className="page market-showcase">
        <div className="market-image">
          <img src="/assets/aseke-trade-hero.png" alt="Crypto market desk with Bitcoin and Ethereum coins" />
        </div>
        <div className="market-copy">
          <p className="eyebrow">Market Discipline</p>
          <h2>Read the setup before risking the trade</h2>
          <p>
            Study crypto markets through security, structure, leverage control, and repeatable review.
          </p>
          <div className="market-tags" aria-label="Market focus areas">
            <span>BTC</span>
            <span>ETH</span>
            <span>RISK</span>
          </div>
        </div>
      </section>

      <section className="page section-grid">
        <div className="section-heading">
          <p className="eyebrow">Curriculum</p>
          <h2>Structured education for safer market decisions</h2>
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
            <h2>Education first. Risk always visible.</h2>
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
