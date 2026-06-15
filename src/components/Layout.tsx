import {
  BookOpen,
  BrainCircuit,
  Crown,
  GraduationCap,
  LockKeyhole,
  LogOut,
  Menu,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { BtcTicker } from "./BtcTicker";
import { ScrollMemory } from "./ScrollMemory";
import { useAuth } from "../contexts/AuthContext";
import { useAccountStatus } from "../hooks/useAccountStatus";
import { tradingAcademyNavPath } from "../lib/tradingAcademyAccess";
import { applyRandomHoverCharts } from "../utils/hoverCharts";

const navItems = [
  { to: "/", label: "Home", icon: Sparkles },
  { to: "/courses", label: "Courses", icon: GraduationCap },
  { to: "/guides", label: "Guides", icon: BookOpen },
  { to: "/charts", label: "Charts", icon: TrendingUp },
  { to: "/puzzle", label: "Puzzle", icon: BrainCircuit },
  { to: "/trading-academy", label: "Trading Academy", icon: Crown }
];

export function Layout() {
  const { user, profile, isAdmin, signOut } = useAuth();
  const accountStatus = useAccountStatus();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const resolvedNavItems = navItems.map((item) =>
    item.to === "/trading-academy"
      ? { ...item, to: tradingAcademyNavPath(Boolean(user), profile) }
      : item
  );

  const closeMenu = () => setMenuOpen(false);
  const handleSignOut = () => {
    closeMenu();
    void signOut();
  };

  useEffect(() => {
    return applyRandomHoverCharts();
  }, [location.pathname, location.search]);

  return (
    <div className="app-shell">
      <ScrollMemory />

      <header className="site-header">
        <Link to="/" className="brand" onClick={closeMenu} aria-label="ASEKE TRADE home">
          <span className="brand-mark" aria-hidden="true">
            <img src="/assets/aseke-trade-logo.png" alt="" />
          </span>
          <span>
            <strong>ASEKE TRADE</strong>
            <small>Crypto Education</small>
          </span>
        </Link>

        <BtcTicker />

        <button
          className="icon-button menu-button"
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-controls="primary-navigation"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
          <span className="sr-only">Toggle navigation</span>
        </button>

        <nav
          className={menuOpen ? "primary-nav open" : "primary-nav"}
          id="primary-navigation"
          aria-label="Primary navigation"
        >
          {resolvedNavItems.map((item) => (
            <NavItem item={item} closeMenu={closeMenu} key={item.to} />
          ))}

          {isAdmin && (
            <NavLink to="/admin" onClick={closeMenu}>
              <ShieldCheck size={17} />
              Admin
            </NavLink>
          )}

          <div className="mobile-actions">
            {user ? (
              <>
                <Link to="/dashboard" className="account-chip" onClick={closeMenu}>
                  <AccountSummary accountStatus={accountStatus} />
                </Link>
                <button className="ghost-button compact" type="button" onClick={handleSignOut}>
                  <LogOut size={16} />
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link className="ghost-button compact" to="/login" onClick={closeMenu}>
                  Login
                </Link>
                <Link className="primary-button compact" to="/register" onClick={closeMenu}>
                  Register
                </Link>
              </>
            )}
          </div>
        </nav>

        <div className="account-actions desktop-actions">
          {user ? (
            <>
              <Link to="/dashboard" className="account-chip">
                <AccountSummary accountStatus={accountStatus} />
              </Link>
              <button className="ghost-button compact" type="button" onClick={handleSignOut}>
                <LogOut size={16} />
                Logout
              </button>
            </>
          ) : (
            <>
              <Link className="ghost-button compact" to="/login">
                Login
              </Link>
              <Link className="primary-button compact" to="/register">
                Register
              </Link>
            </>
          )}
        </div>
      </header>

      <Outlet />

      <footer className="site-footer">
        <div>
          <div className="footer-brand-line">
            <img src="/assets/aseke-trade-logo.png" alt="" aria-hidden="true" />
            <strong>ASEKE TRADE</strong>
          </div>
          <p>Crypto trading education built around safety, structure, and discipline.</p>
          <nav className="footer-links" aria-label="Footer links">
            <Link to="/terms">Terms</Link>
            <Link to="/crypto-glossary">Crypto Glossary</Link>
            <Link to="/trading-academy">Trading Academy</Link>
            <Link to="/support">Support</Link>
          </nav>
        </div>
        <p>
          Educational content only. Not financial advice. Crypto markets, leverage, and futures trading
          are volatile and involve risk. Users are responsible for their own decisions.
        </p>
      </footer>
    </div>
  );
}

function AccountSummary({ accountStatus }: { accountStatus: ReturnType<typeof useAccountStatus> }) {
  return (
    <>
      <LockKeyhole size={15} />
      <span className="account-summary-text">
        <span className="account-email">{accountStatus.email}</span>
        <span className="account-summary-meta">Balance: {accountStatus.balanceLabel}</span>
        <span
          className={
            accountStatus.isPremiumActive
              ? "account-plan-tag premium icon-only"
              : "account-plan-tag basic icon-only"
          }
          title={accountStatus.planLabel}
        >
          {accountStatus.isPremiumActive ? (
            <>
              <Crown size={13} aria-hidden="true" />
              <span className="sr-only">{accountStatus.planLabel}</span>
            </>
          ) : (
            <>
              <UserRound size={13} aria-hidden="true" />
              <span className="sr-only">{accountStatus.planLabel}</span>
            </>
          )}
        </span>
      </span>
    </>
  );
}

function NavItem({
  item,
  closeMenu
}: {
  item: (typeof navItems)[number];
  closeMenu: () => void;
}) {
  const Icon = item.icon;

  return (
    <NavLink to={item.to} onClick={closeMenu}>
      <Icon size={17} />
      {item.label}
    </NavLink>
  );
}
