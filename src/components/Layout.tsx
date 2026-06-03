import {
  BookOpen,
  Crown,
  GraduationCap,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  ShieldCheck,
  Sparkles,
  X
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const navItems = [
  { to: "/", label: "Home", icon: Sparkles },
  { to: "/guides", label: "Guides", icon: BookOpen },
  { to: "/courses", label: "Courses", icon: GraduationCap },
  { to: "/premium", label: "Premium", icon: Crown },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }
];

export function Layout() {
  const { user, profile, isAdmin, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

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

        <button className="icon-button menu-button" type="button" onClick={() => setMenuOpen((open) => !open)}>
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
          <span className="sr-only">Toggle navigation</span>
        </button>

        <nav className={menuOpen ? "primary-nav open" : "primary-nav"} aria-label="Primary navigation">
          {navItems.map((item) => (
            <NavItem item={item} closeMenu={closeMenu} key={item.to} />
          ))}

          {isAdmin && (
            <NavLink to="/admin" onClick={closeMenu}>
              <ShieldCheck size={17} />
              Admin
            </NavLink>
          )}
        </nav>

        <div className="account-actions">
          {user ? (
            <>
              <Link to="/dashboard" className="account-chip">
                <LockKeyhole size={15} />
                <span>{profile?.role ?? "user"}</span>
              </Link>
              <button className="ghost-button compact" type="button" onClick={() => void signOut()}>
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
