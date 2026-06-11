import {
  ArrowUpRight,
  Award,
  BookMarked,
  Camera,
  Crown,
  GraduationCap,
  ShieldCheck,
  UserCircle2,
  WalletCards
} from "lucide-react";
import { useEffect, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { useAccountStatus } from "../hooks/useAccountStatus";
import { getProgressToNextLevel } from "../lib/levels";
import { supabase } from "../lib/supabase";
import type { Guide, Lesson, LessonProgress, Purchase, SavedGuide, XPTransaction } from "../types/content";

type MaybeArray<T> = T | T[] | null | undefined;
type SavedGuideRow = Omit<SavedGuide, "guides"> & {
  guides?: MaybeArray<Pick<Guide, "title" | "slug" | "category">>;
};
type LessonProgressRow = Omit<LessonProgress, "lessons"> & {
  lessons?: MaybeArray<Pick<Lesson, "title">>;
};

const avatarTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const maxAvatarSizeBytes = 2 * 1024 * 1024;

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
  const { user, profile, refreshProfile } = useAuth();
  const accountStatus = useAccountStatus();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [savedGuides, setSavedGuides] = useState<SavedGuide[]>([]);
  const [progress, setProgress] = useState<LessonProgress[]>([]);
  const [xpTransactions, setXPTransactions] = useState<XPTransaction[]>([]);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const totalXP = profile?.total_xp ?? 0;
  const levelProgress = getProgressToNextLevel(totalXP);

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
        .order("completed_at", { ascending: false }),
      supabase
        .from("xp_transactions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5)
    ]).then(([purchaseResult, savedResult, progressResult, xpResult]) => {
      if (!mounted) return;

      if (purchaseResult.error || savedResult.error || progressResult.error || xpResult.error) {
        setError("Some dashboard data could not be loaded.");
      }

      setPurchases((purchaseResult.data ?? []) as Purchase[]);
      setSavedGuides(((savedResult.data ?? []) as SavedGuideRow[]).map(normalizeSavedGuide));
      setProgress(((progressResult.data ?? []) as LessonProgressRow[]).map(normalizeLessonProgress));
      setXPTransactions((xpResult.data ?? []) as XPTransaction[]);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [user]);

  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!supabase || !user) {
      setAvatarMessage("Login with Supabase connected to change your avatar.");
      return;
    }

    if (!avatarTypes.includes(file.type)) {
      setAvatarMessage("Use a JPG, PNG, WEBP, or GIF image.");
      return;
    }

    if (file.size > maxAvatarSizeBytes) {
      setAvatarMessage("Avatar images must be 2 MB or smaller.");
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase();
    const safeExtension = extension && /^[a-z0-9]+$/.test(extension) ? extension : "png";
    const avatarPath = `${user.id}/avatar-${Date.now()}.${safeExtension}`;

    setIsAvatarUploading(true);
    setAvatarMessage(null);

    const uploadResult = await supabase.storage.from("avatars").upload(avatarPath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false
    });

    if (uploadResult.error) {
      setAvatarMessage("Avatar upload failed. Check the avatars storage bucket and policies.");
      setIsAvatarUploading(false);
      return;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(avatarPath);
    const updateResult = await supabase.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", user.id);

    if (updateResult.error) {
      setAvatarMessage("Avatar uploaded, but your profile could not be updated.");
    } else {
      setAvatarMessage("Avatar updated.");
      await refreshProfile();
    }

    setIsAvatarUploading(false);
  };

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Learning account</h1>
          <p className="muted">
            Continue your trading education, manage your balance, and track your Trading Academy access.
          </p>
        </div>
        <span className={accountStatus.isPremiumActive ? "status-pill premium" : "status-pill free"}>
          <Crown size={15} />
          {accountStatus.planLabel}
        </span>
      </section>

      {error && <p className="warning-box">{error}</p>}

      <section className="dashboard-grid three profile-overview-grid">
        <article className="section-panel">
          <div className="avatar-profile-row">
            <div className="dashboard-avatar" aria-label="Profile avatar">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" />
              ) : (
                <UserCircle2 size={74} aria-hidden="true" />
              )}
            </div>
            <div>
              <span className="feature-icon compact-icon">
                <UserCircle2 size={21} />
              </span>
              <h2>Profile</h2>
              <label className="ghost-button compact avatar-upload-button">
                <Camera size={16} />
                {isAvatarUploading ? "Uploading" : "Change avatar"}
                <input type="file" accept={avatarTypes.join(",")} onChange={(event) => void uploadAvatar(event)} />
              </label>
            </div>
          </div>
          {avatarMessage && <p className="soft-notice">{avatarMessage}</p>}
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
                <dt>Trading Academy Access Expires</dt>
                <dd>{accountStatus.premiumUntilLabel}</dd>
              </div>
            )}
          </dl>
        </article>

        <article className="section-panel level-panel">
          <span className="feature-icon">
            <Award size={21} />
          </span>
          <h2>Learning Level</h2>
          <div className="level-hero-line">
            <span className="level-badge large">LVL {levelProgress.level}</span>
            <span>{totalXP} total XP</span>
          </div>
          <div className="xp-progress-track" aria-label={`${levelProgress.progressPercent}% to next level`}>
            <span style={{ width: `${levelProgress.progressPercent}%` }} />
          </div>
          <div className="xp-stat-row">
            <span>{levelProgress.xpIntoLevel}/{levelProgress.xpRequiredForNextLevel} XP</span>
            <span>{levelProgress.xpRemainingForNextLevel} XP to LVL {levelProgress.level + 1}</span>
          </div>
        </article>

        <article className="section-panel">
          <span className="feature-icon">
            <WalletCards size={21} />
          </span>
          <h2>Account access</h2>
          <p className="muted">
            {accountStatus.isPremiumActive
              ? "Your Trading Academy access is active. Continue advanced lessons, review Trading Academy materials, study trading strategies, or extend your access."
              : "You are on the Basic plan. Join Trading Academy to unlock advanced trading education, strategy lessons, signals, and 1-on-1 learning."}
          </p>
          <div className="inline-actions">
            <Link className="primary-button compact" to="/account/payments">
              <ArrowUpRight size={16} />
              Top up balance
            </Link>
            <Link className="ghost-button compact" to="/trading-academy">
              <ShieldCheck size={16} />
              {accountStatus.isPremiumActive ? "Extend Trading Academy Access" : "Join Trading Academy"}
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
            <h2>Recent Payments & Access</h2>
            {purchases.length ? (
              <ul className="plain-list">
                {purchases.map((purchase) => (
                  <li key={purchase.id}>
                    <strong>{purchase.status}</strong>
                    <span>{purchase.course_id ?? purchase.guide_id ?? "Trading Academy access"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                You have no payments yet. Top up your balance or join the Trading Academy when you are ready.
              </p>
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
              <p className="muted">No saved guides yet. Start with Crypto Foundations, then save the guides you want to revisit.</p>
            )}
          </article>

          <article className="section-panel">
            <span className="feature-icon">
              <Crown size={21} />
            </span>
            <h2>Recent XP</h2>
            {xpTransactions.length ? (
              <ul className="plain-list">
                {xpTransactions.map((transaction) => (
                  <li key={transaction.id}>
                    <strong>+{transaction.amount} XP</strong>
                    <span>{transaction.description ?? transaction.source_type}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Pass guide quizzes and solve the daily puzzle to build your XP history.
              </p>
            )}
          </article>

          <article className="section-panel">
            <span className="feature-icon">
              <Crown size={21} />
            </span>
            <h2>Lesson Progress</h2>
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
              <p className="muted">
                You have not started any lessons yet. Begin with foundations, then move toward Trading Academy topics when ready.
              </p>
            )}
          </article>
        </section>
      )}
    </main>
  );
}
