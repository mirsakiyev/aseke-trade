import { BookMarked, Crown, GraduationCap, ShieldCheck, UserCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import type { LessonProgress, Purchase, SavedGuide } from "../types/content";

export function Dashboard() {
  const { user, profile, isPremium, isAdmin } = useAuth();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [savedGuides, setSavedGuides] = useState<SavedGuide[]>([]);
  const [progress, setProgress] = useState<LessonProgress[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    if (!supabase || !user) {
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }

    Promise.all([
      supabase.from("purchases").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase
        .from("saved_guides")
        .select("id,user_id,guide_id,created_at,guides(title,slug,category)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("lesson_progress")
        .select("id,user_id,lesson_id,completed,completed_at,lessons(title)")
        .eq("user_id", user.id)
        .order("completed_at", { ascending: false })
    ]).then(([purchaseResult, savedResult, progressResult]) => {
      if (!mounted) return;

      if (purchaseResult.error || savedResult.error || progressResult.error) {
        setError("Some dashboard data could not be loaded.");
      }

      setPurchases((purchaseResult.data ?? []) as Purchase[]);
      setSavedGuides((savedResult.data ?? []) as SavedGuide[]);
      setProgress((progressResult.data ?? []) as LessonProgress[]);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [user]);

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Learning account</h1>
          <p className="muted">Your profile, access status, saved guides, and course progress.</p>
        </div>
        <span className={isPremium || isAdmin ? "status-pill premium" : "status-pill free"}>
          <Crown size={15} />
          {isAdmin ? "Admin" : isPremium ? "Premium" : "Free"}
        </span>
      </section>

      {error && <p className="warning-box">{error}</p>}

      <section className="dashboard-grid">
        <article className="section-panel">
          <span className="feature-icon">
            <UserCircle2 size={21} />
          </span>
          <h2>Profile</h2>
          <dl className="detail-list">
            <div>
              <dt>Name</dt>
              <dd>{profile?.full_name ?? user?.email ?? "Account"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user?.email}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{profile?.role ?? "user"}</dd>
            </div>
            <div>
              <dt>Premium until</dt>
              <dd>{profile?.premium_until ? new Date(profile.premium_until).toLocaleDateString() : "Not active"}</dd>
            </div>
          </dl>
        </article>

        <article className="section-panel">
          <span className="feature-icon">
            <ShieldCheck size={21} />
          </span>
          <h2>Access</h2>
          <p className="muted">
            Premium content unlocks when Supabase confirms premium profile status, admin role, or a paid
            purchase record.
          </p>
          <Link className="text-link" to="/premium">
            Manage premium
          </Link>
        </article>
      </section>

      {isLoading ? (
        <LoadingState label="Loading dashboard" />
      ) : (
        <section className="dashboard-grid three">
          <article className="section-panel">
            <span className="feature-icon">
              <GraduationCap size={21} />
            </span>
            <h2>Purchased Access</h2>
            {purchases.length ? (
              <ul className="plain-list">
                {purchases.map((purchase) => (
                  <li key={purchase.id}>
                    <strong>{purchase.status}</strong>
                    <span>{purchase.course_id ?? purchase.guide_id ?? "Premium access"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No purchases or manual grants yet.</p>
            )}
          </article>

          <article className="section-panel">
            <span className="feature-icon">
              <BookMarked size={21} />
            </span>
            <h2>Saved Guides</h2>
            {savedGuides.length ? (
              <ul className="plain-list">
                {savedGuides.map((saved) => (
                  <li key={saved.id}>
                    <strong>{saved.guides?.title ?? saved.guide_id}</strong>
                    <span>{saved.guides?.category ?? "Guide"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No saved guides yet.</p>
            )}
          </article>

          <article className="section-panel">
            <span className="feature-icon">
              <Crown size={21} />
            </span>
            <h2>Progress</h2>
            {progress.length ? (
              <ul className="plain-list">
                {progress.map((item) => (
                  <li key={item.id}>
                    <strong>{item.lessons?.title ?? item.lesson_id}</strong>
                    <span>{item.completed ? "Completed" : "In progress"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No lesson progress recorded yet.</p>
            )}
          </article>
        </section>
      )}
    </main>
  );
}
