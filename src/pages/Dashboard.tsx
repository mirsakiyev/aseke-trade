import { ArrowUpRight, BookMarked, Crown, GraduationCap, ShieldCheck, UserCircle2, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { useAccountStatus } from "../hooks/useAccountStatus";
import { supabase } from "../lib/supabase";
import type { Guide, Lesson, LessonProgress, Purchase, SavedGuide } from "../types/content";

type MaybeArray<T> = T | T[] | null | undefined;
type SavedGuideRow = Omit<SavedGuide, "guides"> & {
  guides?: MaybeArray<Pick<Guide, "title" | "slug" | "category">>;
};
type LessonProgressRow = Omit<LessonProgress, "lessons"> & {
  lessons?: MaybeArray<Pick<Lesson, "title">>;
};

function firstRelation<T>(relation: MaybeArray<T>): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

function normalizeSavedGuide(row: SavedGuideRow): SavedGuide {
  return {
    ...row,
    guides: firstRelation(row.guides)
  };
}

function normalizeLessonProgress(row: LessonProgressRow): LessonProgress {
  return {
    ...row,
    lessons: firstRelation(row.lessons)
  };
}

export function Dashboard() {
  const { user, profile } = useAuth();
  const accountStatus = useAccountStatus();
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
      setSavedGuides(((savedResult.data ?? []) as SavedGuideRow[]).map(normalizeSavedGuide));
      setProgress(((progressResult.data ?? []) as LessonProgressRow[]).map(normalizeLessonProgress));
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
        <span className={accountStatus.isPremiumActive ? "status-pill premium" : "status-pill free"}>
          <Crown size={15} />
          {accountStatus.planLabel}
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
              <dt>Available Balance</dt>
              <dd>{accountStatus.balanceLabel}</dd>
            </div>
            <div>
              <dt>Current Plan</dt>
              <dd>{accountStatus.planLabel}</dd>
            </div>
            {accountStatus.isPremiumActive && accountStatus.premiumUntilLabel && (
              <div>
                <dt>Premium Expires</dt>
                <dd>{accountStatus.premiumUntilLabel}</dd>
              </div>
            )}
          </dl>
        </article>

        <article className="section-panel">
          <span className="feature-icon">
            <WalletCards size={21} />
          </span>
          <h2>Account access</h2>
          <p className="muted">
            Keep funds ready for Premium purchases and manage your access from one place.
          </p>
          <div className="inline-actions">
            <Link className="primary-button compact" to="/account/payments">
              <ArrowUpRight size={16} />
              Top up balance
            </Link>
            <Link className="ghost-button compact" to="/premium">
              <ShieldCheck size={16} />
              {accountStatus.isPremiumActive ? "Extend Premium" : "Upgrade Premium"}
            </Link>
          </div>
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
