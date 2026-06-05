import {
  BookOpen,
  BrainCircuit,
  Crown,
  GraduationCap,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { BtcTicker } from "./BtcTicker";
import { useAuth } from "../contexts/AuthContext";
import { applyRandomHoverCharts } from "../utils/hoverCharts";

const navItems = [
  { to: "/", label: "Home", icon: Sparkles },
  { to: "/guides", label: "Guides", icon: BookOpen },
  { to: "/courses", label: "Courses", icon: GraduationCap },
  { to: "/charts", label: "Charts", icon: TrendingUp },
  { to: "/quiz", label: "Quiz", icon: BrainCircuit },
  { to: "/premium", label: "Premium", icon: Crown },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }
];

export function Layout() {
  const { user, profile, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

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
      <header className="site-header">
        <Link to="/" className="brand" onClick={closeMenu} aria-label="ASEKE TRADE home">
          <span className="brand-mark">AT</span>
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
          {navItems.map((item) => (
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
                  <LockKeyhole size={15} />
                  <span>{profile?.role ?? "user"}</span>
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
                <LockKeyhole size={15} />
                <span>{profile?.role ?? "user"}</span>
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
          <strong>ASEKE TRADE</strong>
          <p>Founded by Aslan Mirsakiyev, aka Aseke.</p>
        </div>
        <p>
          Educational content only. Not financial advice. Crypto and futures trading are risky, and users
          are responsible for their own decisions.
        </p>
      </footer>
    </div>
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
