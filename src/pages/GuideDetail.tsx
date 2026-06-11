import { ArrowRight, Award, BookOpen, CheckCircle2, LockKeyhole, Timer, WalletCards, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { loadGuideBySlug, loadPurchasedCourseIds, loadPurchasedGuideIds } from "../lib/contentApi";
import { loadGuideQuiz, submitGuideQuiz, type GuideQuizSubmissionResult } from "../lib/gamificationApi";
import { getProgressToNextLevel } from "../lib/levels";
import { premiumCheckoutPath } from "../lib/premiumPlans";
import type { Guide, GuideQuiz } from "../types/content";

export function GuideDetail() {
  const { slug } = useParams();
  const { user, isAdmin, isPremium, refreshProfile } = useAuth();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [purchasedCourseIds, setPurchasedCourseIds] = useState<Set<string>>(new Set());
  const [purchasedGuideIds, setPurchasedGuideIds] = useState<Set<string>>(new Set());
  const [guideQuiz, setGuideQuiz] = useState<GuideQuiz | null>(null);
  const [quizAnswer, setQuizAnswer] = useState("");
  const [quizResult, setQuizResult] = useState<GuideQuizSubmissionResult | null>(null);
  const [isQuizLoading, setIsQuizLoading] = useState(false);
  const [isQuizSubmitting, setIsQuizSubmitting] = useState(false);
  const [quizNotice, setQuizNotice] = useState<string | null>(null);
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

  useEffect(() => {
    let mounted = true;

    setGuideQuiz(null);
    setQuizAnswer("");
    setQuizResult(null);
    setQuizNotice(null);

    if (!guide?.id || !hasAccess) {
      setIsQuizLoading(false);
      return () => {
        mounted = false;
      };
    }

    setIsQuizLoading(true);
    loadGuideQuiz(guide.id)
      .then((quiz) => {
        if (!mounted) return;
        setGuideQuiz(quiz);
      })
      .finally(() => {
        if (mounted) setIsQuizLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [guide?.id, hasAccess]);

  const submitQuiz = async () => {
    if (!guide || !guideQuiz || !quizAnswer) return;

    if (!user) {
      setQuizNotice("Login to submit the quiz and earn XP.");
      return;
    }

    setIsQuizSubmitting(true);
    setQuizNotice(null);

    try {
      const result = await submitGuideQuiz(guide.id, quizAnswer);
      setQuizResult(result);
      await refreshProfile();
    } catch {
      setQuizNotice("Quiz submission could not be saved. Please try again.");
    } finally {
      setIsQuizSubmitting(false);
    }
  };

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
            <span className="meta-with-icon">
              <Award size={15} />
              {guide.xp_reward} XP
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

      {hasAccess && (
        <section className="section-panel guide-quiz-panel">
          <div className="lesson-title-line">
            <div>
              <p className="eyebrow">Completion Quiz</p>
              <h2>Pass to complete this guide</h2>
            </div>
            <span className="status-pill premium">
              <Award size={15} />
              {guide.xp_reward} XP
            </span>
          </div>

          {isQuizLoading ? (
            <LoadingState label="Loading guide quiz" />
          ) : guideQuiz ? (
            <>
              <div className="guide-quiz-question">
                <h3>{guideQuiz.question}</h3>
                <div className="quiz-option-list">
                  {guideQuiz.answer_options.map((option) => (
                    <button
                      className={quizAnswer === option ? "quiz-option selected" : "quiz-option"}
                      type="button"
                      disabled={isQuizSubmitting}
                      onClick={() => setQuizAnswer(option)}
                      key={option}
                    >
                      <span>{option}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="quiz-card-footer">
                <p>
                  XP is awarded server-side after a passing answer, and each guide can only award XP
                  once per account.
                </p>
                <button
                  className="primary-button"
                  type="button"
                  disabled={!quizAnswer || isQuizSubmitting}
                  onClick={() => void submitQuiz()}
                >
                  Submit quiz
                  <CheckCircle2 size={18} />
                </button>
              </div>

              {quizNotice && <p className="warning-box">{quizNotice}</p>}
              {quizResult && <GuideQuizResultPanel result={quizResult} />}
            </>
          ) : (
            <p className="muted">
              This guide is ready to read, but its completion quiz is not available yet.
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function GuideQuizResultPanel({ result }: { result: GuideQuizSubmissionResult }) {
  const progress = getProgressToNextLevel(result.total_xp);

  if (!result.passed) {
    return (
      <div className="quiz-explanation incorrect" aria-live="polite">
        <strong>
          <XCircle size={18} />
          Not passed yet
        </strong>
        <p>XP was not awarded. Review the guide and try the quiz again when you are ready.</p>
      </div>
    );
  }

  return (
    <div className="quiz-explanation correct guide-xp-result" aria-live="polite">
      <strong>
        <CheckCircle2 size={18} />
        {result.xp_awarded > 0 ? `Passed - ${result.xp_awarded} XP awarded` : "Passed - XP already awarded"}
      </strong>
      {result.explanation && <p>{result.explanation}</p>}
      <div className="xp-mini-summary">
        <span className="level-badge">LVL {result.level}</span>
        <span>{result.total_xp} total XP</span>
        <span>{progress.xpRemainingForNextLevel} XP to LVL {result.level + 1}</span>
      </div>
      <div className="xp-progress-track" aria-label={`${progress.progressPercent}% to next level`}>
        <span style={{ width: `${progress.progressPercent}%` }} />
      </div>
    </div>
  );
}
