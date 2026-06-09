import { ArrowRight, BookOpen, LockKeyhole, Timer, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { loadGuideBySlug, loadPurchasedCourseIds, loadPurchasedGuideIds } from "../lib/contentApi";
import { premiumCheckoutPath } from "../lib/premiumPlans";
import type { Guide } from "../types/content";

export function GuideDetail() {
  const { slug } = useParams();
  const { user, isAdmin, isPremium } = useAuth();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [purchasedCourseIds, setPurchasedCourseIds] = useState<Set<string>>(new Set());
  const [purchasedGuideIds, setPurchasedGuideIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    loadGuideBySlug(slug ?? "").then((result) => {
      if (!mounted) return;
      setGuide(result.data);
      setNotice(result.error);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [slug]);

  useEffect(() => {
    let mounted = true;

    if (!user) {
      setPurchasedCourseIds(new Set());
      setPurchasedGuideIds(new Set());
      return () => {
        mounted = false;
      };
    }

    Promise.all([loadPurchasedCourseIds(user.id), loadPurchasedGuideIds(user.id)]).then(([courseIds, guideIds]) => {
      if (!mounted) return;
      setPurchasedCourseIds(courseIds);
      setPurchasedGuideIds(guideIds);
    });

    return () => {
      mounted = false;
    };
  }, [user]);

  const hasAccess = useMemo(() => {
    if (!guide) return false;
    const courseIsPremium = Boolean(guide.course?.is_premium);
    return (
      (!guide.is_premium && !courseIsPremium) ||
      isAdmin ||
      isPremium ||
      purchasedGuideIds.has(guide.id) ||
      (guide.course_id ? purchasedCourseIds.has(guide.course_id) : false)
    );
  }, [guide, isAdmin, isPremium, purchasedCourseIds, purchasedGuideIds]);

  if (isLoading) {
    return (
      <main className="page">
        <LoadingState label="Loading guide" />
      </main>
    );
  }

  if (!guide) {
    return (
      <main className="page narrow-page">
        <section className="section-panel">
          <p className="eyebrow">Not Found</p>
          <h1>Guide unavailable</h1>
          <p className="muted">This guide may be private, archived, or unavailable to your account.</p>
          <Link className="primary-button" to="/guides">
            Back to guides
          </Link>
        </section>
      </main>
    );
  }

  const paragraphs = guide.content.split(/\n{2,}/).filter(Boolean);

  return (
    <main className="page page-stack">
      <section className="course-hero">
        <div>
          <p className="eyebrow">Guide</p>
          <h1>{guide.title}</h1>
          <p>{guide.description}</p>
          <div className="card-meta">
            <span>{guide.category}</span>
            <span>{guide.difficulty}</span>
            <span className="meta-with-icon">
              <Timer size={15} />
              {guide.estimated_read_time} min
            </span>
            <span>{guide.is_premium || guide.course?.is_premium ? "Trading Academy" : "Free"}</span>
          </div>
        </div>

        {!hasAccess && (
          <aside className="access-panel">
            <LockKeyhole size={26} />
            <h2>{user ? "Trading Academy guide locked" : "Login to continue"}</h2>
            <p>
              {user
                ? "This guide belongs to the Trading Academy path. Join to unlock advanced trading education until your access expires."
                : "Create an account or sign in to unlock eligible Trading Academy education and track your progress."}
            </p>
            <div className="inline-actions">
              {user ? (
                <Link className="primary-button" to={premiumCheckoutPath("premium_1_month")}>
                  <WalletCards size={17} />
                  Join Trading Academy
                  <ArrowRight size={17} />
                </Link>
              ) : (
                <>
                  <Link className="primary-button" to="/login">
                    Login
                  </Link>
                  <Link className="ghost-button" to="/register">
                    Register
                  </Link>
                </>
              )}
            </div>
          </aside>
        )}
      </section>

      {notice && <p className="soft-notice">{notice}</p>}

      <section className="section-panel page-stack">
        <div className="lesson-title-line">
          <h2>{hasAccess ? "Guide content" : "Locked preview"}</h2>
          <span className={hasAccess ? "status-pill free" : "status-pill premium"}>
            {hasAccess ? "Available" : "Trading Academy"}
          </span>
        </div>

        {hasAccess ? (
          paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)
        ) : (
          <p className="muted">
            {guide.description} Full content is available after Trading Academy access is verified.
          </p>
        )}

        <div className="inline-actions">
          {guide.course && (
            <Link className="ghost-button compact" to={`/courses/${guide.course.slug}`}>
              <BookOpen size={16} />
              Back to {guide.course.title}
            </Link>
          )}
          <Link className="ghost-button compact" to="/guides">
            All Guides
          </Link>
        </div>
      </section>
    </main>
  );
}
