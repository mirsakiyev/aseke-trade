import { ArrowRight, BookOpen, LockKeyhole, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { loadCourseBySlug } from "../lib/contentApi";
import { premiumCheckoutPath } from "../lib/premiumPlans";
import type { Course } from "../types/content";

export function CourseDetail() {
  const { slug } = useParams();
  const { user, isAdmin, isPremium } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    loadCourseBySlug(slug ?? "").then((result) => {
      if (!mounted) return;
      setCourse(result.data);
      setNotice(result.error);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [slug]);

  const hasAccess = useMemo(() => {
    if (!course) return false;
    return !course.is_premium || isAdmin || isPremium;
  }, [course, isAdmin, isPremium]);

  const courseGuides = course?.guides ?? [];

  if (isLoading) {
    return (
      <main className="page">
        <LoadingState label="Loading course" />
      </main>
    );
  }

  if (!course) {
    return (
      <main className="page narrow-page">
        <section className="section-panel">
          <p className="eyebrow">Not Found</p>
          <h1>Course unavailable</h1>
          <p className="muted">This course may be private, unpublished, or unavailable to your account.</p>
          <Link className="primary-button" to="/courses">
            Back to courses
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page page-stack">
      <section className="course-hero">
        <div>
          <p className="eyebrow">Course Detail</p>
          <h1>{course.title}</h1>
          <p>{course.description}</p>
          <div className="card-meta">
            <span>{course.difficulty}</span>
            <span>{course.is_premium ? "Trading Academy access" : "Free course"}</span>
            <span>{courseGuides.length > 0 ? `${courseGuides.length} guides` : "No guides yet"}</span>
          </div>
        </div>

        {!hasAccess && (
          <aside className="access-panel">
            <LockKeyhole size={26} />
            <h2>{user ? "Trading Academy required" : "Login to continue"}</h2>
            <p>
              {user
                ? "Join Trading Academy to unlock advanced trading education for this path."
                : "Create an account or sign in to track progress and unlock eligible Trading Academy education."}
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

      <section className="module-list">
        {courseGuides.length > 0 ? (
          <article className="module-card">
            <div className="module-heading">
              <span>{courseGuides.length} guides</span>
              <h2>Learning guides</h2>
            </div>
            <div className="lesson-list">
              {courseGuides.map((guide) => {
                const locked = (guide.is_premium || course.is_premium) && !hasAccess;
                return (
                  <div className={locked ? "lesson-row locked" : "lesson-row"} key={guide.id}>
                    <div className="lesson-icon">
                      {locked ? <LockKeyhole size={18} /> : <BookOpen size={18} />}
                    </div>
                    <div>
                      <div className="lesson-title-line">
                        <h3>{guide.title}</h3>
                        <span className={locked || guide.is_premium ? "status-pill premium" : "status-pill free"}>
                          {locked ? "Requires Trading Academy" : guide.is_premium ? "Trading Academy" : "Free"}
                        </span>
                      </div>
                      <p>
                        {locked
                          ? "This guide is part of the Trading Academy path."
                          : guide.description}
                      </p>
                      <Link className="ghost-button compact" to={`/guides/${guide.slug}`}>
                        {locked ? "View access" : "Open guide"}
                        <ArrowRight size={16} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ) : (
          <article className="module-card">
            <div className="module-heading">
              <span>Course guides</span>
              <h2>No guides added yet</h2>
            </div>
            <p className="muted">This course is ready for guides to be attached from the admin dashboard.</p>
          </article>
        )}
      </section>
    </main>
  );
}
