import { ArrowRight, BookOpen, CheckCircle2, LockKeyhole, PlayCircle, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { loadCourseBySlug, loadPurchasedCourseIds } from "../lib/contentApi";
import { supabase } from "../lib/supabase";
import { formatMoney } from "../lib/validation";
import type { Course } from "../types/content";

export function CourseDetail() {
  const { slug } = useParams();
  const { user, isAdmin, isPremium } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [purchasedCourseIds, setPurchasedCourseIds] = useState<Set<string>>(new Set());
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

  useEffect(() => {
    let mounted = true;

    if (!user) {
      setPurchasedCourseIds(new Set());
      return () => {
        mounted = false;
      };
    }

    loadPurchasedCourseIds(user.id).then((ids) => {
      if (mounted) setPurchasedCourseIds(ids);
    });

    return () => {
      mounted = false;
    };
  }, [user]);

  const hasAccess = useMemo(() => {
    if (!course) return false;
    return !course.is_premium || isAdmin || isPremium || purchasedCourseIds.has(course.id);
  }, [course, isAdmin, isPremium, purchasedCourseIds]);

  const courseGuides = course?.guides ?? [];

  const markLessonComplete = async (lessonId: string) => {
    if (!supabase || !user) {
      setNotice("Login with Supabase connected to track lesson progress.");
      return;
    }

    const { error } = await supabase.from("lesson_progress").upsert(
      {
        user_id: user.id,
        lesson_id: lessonId,
        completed: true,
        completed_at: new Date().toISOString()
      },
      { onConflict: "user_id,lesson_id" }
    );

    setNotice(error ? "Progress could not be saved." : "Lesson marked complete.");
  };

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
            <span>{formatMoney(course.price_cents)}</span>
            <span>{course.is_premium ? "Premium course" : "Free course"}</span>
          </div>
        </div>

        {!hasAccess && (
          <aside className="access-panel">
            <LockKeyhole size={26} />
            <h2>{user ? "Premium access required" : "Login to continue"}</h2>
            <p>
              {user
                ? "Your account needs premium status or a verified course purchase to unlock the protected guides."
                : "Create an account or sign in to track progress and unlock eligible premium content."}
            </p>
            <div className="inline-actions">
              {user ? (
                <Link className="primary-button" to={`/checkout/course/${course.id}`}>
                  <WalletCards size={17} />
                  Buy with Crypto
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
              <h2>Course guide list</h2>
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
                          {locked ? "Locked" : guide.is_premium ? "Premium" : "Free"}
                        </span>
                      </div>
                      <p>
                        {locked
                          ? "This guide is part of the premium Trading Academy path."
                          : guide.description}
                      </p>
                      <Link className="ghost-button compact" to={`/guides/${guide.slug}`}>
                        {locked ? "View Access" : "Open Guide"}
                        <ArrowRight size={16} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ) : (
          course.modules.map((module) => (
            <article className="module-card" key={module.id}>
              <div className="module-heading">
                <span>Module {module.sort_order}</span>
                <h2>{module.title}</h2>
              </div>
              <div className="lesson-list">
                {module.lessons.map((lesson) => {
                  const locked = lesson.is_premium && !lesson.is_preview && !hasAccess;
                  return (
                    <div className={locked ? "lesson-row locked" : "lesson-row"} key={lesson.id}>
                      <div className="lesson-icon">
                        {locked ? <LockKeyhole size={18} /> : lesson.is_preview ? <PlayCircle size={18} /> : <CheckCircle2 size={18} />}
                      </div>
                      <div>
                        <div className="lesson-title-line">
                          <h3>{lesson.title}</h3>
                          {lesson.is_preview && <span className="status-pill free">Preview</span>}
                          {lesson.is_premium && !lesson.is_preview && <span className="status-pill premium">Premium</span>}
                        </div>
                        <p>
                          {locked
                            ? "This lesson is locked until your account has premium access or a verified purchase."
                            : lesson.content}
                        </p>
                        {!locked && user && (
                          <button
                            className="ghost-button compact"
                            type="button"
                            onClick={() => void markLessonComplete(lesson.id)}
                          >
                            Mark Complete
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
