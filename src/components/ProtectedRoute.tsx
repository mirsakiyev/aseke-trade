import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { LoadingState } from "./LoadingState";

export function ProtectedRoute({
  children,
  requireAdmin = false,
  requireTradingAcademy = false
}: {
  children: ReactNode;
  requireAdmin?: boolean;
  requireTradingAcademy?: boolean;
}) {
  const { isLoading, user, isAdmin, isTradingAcademyMember } = useAuth();
  const location = useLocation();

  if (isLoading) return <LoadingState label="Checking account" />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (requireAdmin && !isAdmin) {
    return (
      <main className="page narrow-page">
        <section className="section-panel">
          <p className="eyebrow">Restricted</p>
          <h1>Admin access required</h1>
          <p className="muted">
            This area is protected for ASEKE TRADE administrators. Content and account changes are also
            enforced by Supabase Row Level Security.
          </p>
        </section>
      </main>
    );
  }

  if (requireTradingAcademy && !isTradingAcademyMember) {
    return <Navigate to="/trading-academy" replace />;
  }

  return <>{children}</>;
}
