import {
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  LockKeyhole,
  RotateCcw,
  Timer,
  WalletCards,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { loadGuideBySlug, loadPurchasedCourseIds, loadPurchasedGuideIds } from "../lib/contentApi";
import { loadGuideQuizzes, submitGuideQuiz, type GuideQuizSubmissionResult } from "../lib/gamificationApi";
import { getProgressToNextLevel } from "../lib/levels";
import { premiumCheckoutPath } from "../lib/premiumPlans";
import type { Guide, GuideQuiz } from "../types/content";

export function GuideDetail() {
  const { slug } = useParams();
  const { user, isAdmin, isPremium, refreshProfile } = useAuth();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [purchasedCourseIds, setPurchasedCourseIds] = useState<Set<string>>(new Set());
  const [purchasedGuideIds, setPurchasedGuideIds] = useState<Set<string>>(new Set());
  const [guideQuizzes, setGuideQuizzes] = useState<GuideQuiz[]>([]);
  const [currentQuizQuestionIndex, setCurrentQuizQuestionIndex] = useState(0);
  const [draftQuizAnswers, setDraftQuizAnswers] = useState<Record<string, string>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
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

    setGuideQuizzes([]);
    setCurrentQuizQuestionIndex(0);
    setDraftQuizAnswers({});
    setQuizAnswers({});
    setQuizResult(null);
    setQuizNotice(null);

    if (!guide?.id || !hasAccess) {
      setIsQuizLoading(false);
      return () => {
        mounted = false;
      };
    }

    setIsQuizLoading(true);
    loadGuideQuizzes(guide.id)
      .then((quizzes) => {
        if (!mounted) return;
        setGuideQuizzes(quizzes.slice(0, 5));
      })
      .finally(() => {
        if (mounted) setIsQuizLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [guide?.id, hasAccess]);

  const currentQuizQuestion = guideQuizzes[currentQuizQuestionIndex];
  const selectedCurrentQuizAnswer = currentQuizQuestion
    ? draftQuizAnswers[currentQuizQuestion.id] ?? quizAnswers[currentQuizQuestion.id]
    : undefined;
  const answeredQuizCount = guideQuizzes.filter((quiz) => Boolean(quizAnswers[quiz.id])).length;
  const guideQuizProgress = guideQuizzes.length > 0 ? Math.round((answeredQuizCount / guideQuizzes.length) * 100) : 0;
  const isGuideQuizSubmitted = Boolean(quizResult);
  const isGuideQuizReady = guideQuizzes.length === 5;

  const selectDraftQuizAnswer = (questionId: string, option: string) => {
    if (isGuideQuizSubmitted) return;

    setDraftQuizAnswers((current) => ({
      ...current,
      [questionId]: option
    }));
  };

  const confirmCurrentQuizAnswer = () => {
    if (!currentQuizQuestion || !selectedCurrentQuizAnswer || isGuideQuizSubmitted) return;

    const nextAnswers = {
      ...quizAnswers,
      [currentQuizQuestion.id]: selectedCurrentQuizAnswer
    };

    setQuizAnswers(nextAnswers);
    setDraftQuizAnswers((current) => ({
      ...current,
      [currentQuizQuestion.id]: selectedCurrentQuizAnswer
    }));

    const nextUnansweredIndex = guideQuizzes.findIndex(
      (quiz, index) => index > currentQuizQuestionIndex && !nextAnswers[quiz.id]
    );
    const fallbackUnansweredIndex = guideQuizzes.findIndex((quiz) => !nextAnswers[quiz.id]);

    if (nextUnansweredIndex !== -1) {
      setCurrentQuizQuestionIndex(nextUnansweredIndex);
      return;
    }

    if (fallbackUnansweredIndex !== -1) {
      setCurrentQuizQuestionIndex(fallbackUnansweredIndex);
      return;
    }

    setCurrentQuizQuestionIndex((index) => Math.min(index + 1, guideQuizzes.length - 1));
  };

  const resetGuideQuizAttempt = () => {
    setCurrentQuizQuestionIndex(0);
    setDraftQuizAnswers({});
    setQuizAnswers({});
    setQuizResult(null);
    setQuizNotice(null);
  };

  const submitQuiz = async () => {
    if (!guide || !isGuideQuizReady || answeredQuizCount !== guideQuizzes.length) return;

    if (!user) {
      setQuizNotice("Login to submit the quiz and earn XP.");
      return;
    }

    setIsQuizSubmitting(true);
    setQuizNotice(null);

    try {
      const result = await submitGuideQuiz(guide.id, quizAnswers);
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
          ) : guideQuizzes.length > 0 && currentQuizQuestion ? (
            <>
              <section className="quiz-status-grid guide-quiz-status-grid" aria-label="Guide quiz status">
                <div className="quiz-status-panel">
                  <span className="status-pill">{isGuideQuizReady ? "5 questions" : `${guideQuizzes.length}/5 ready`}</span>
                  <strong>
                    {answeredQuizCount}/{guideQuizzes.length} answered
                  </strong>
                  <div className="quiz-progress-track" aria-hidden="true">
                    <span style={{ width: `${guideQuizProgress}%` }} />
                  </div>
                </div>
              </section>

              <section className="quiz-carousel guide-quiz-carousel" aria-label="Guide quiz carousel">
                <div className="quiz-question-nav guide-quiz-nav" aria-label="Jump to guide quiz question">
                  {guideQuizzes.map((quiz, index) => {
                    const isCurrent = index === currentQuizQuestionIndex;
                    const isAnswered = Boolean(quizAnswers[quiz.id]);
                    const correctAnswer = quizResult?.correct_answers?.[quiz.id];
                    const isCorrect = Boolean(correctAnswer && quizAnswers[quiz.id] === correctAnswer);
                    const className = [
                      "quiz-question-nav-button",
                      isCurrent ? "current" : "",
                      isAnswered ? "answered" : "",
                      quizResult && isAnswered && isCorrect ? "correct" : "",
                      quizResult && isAnswered && !isCorrect ? "incorrect" : ""
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <button
                        className={className}
                        type="button"
                        onClick={() => setCurrentQuizQuestionIndex(index)}
                        aria-current={isCurrent ? "step" : undefined}
                        key={quiz.id}
                      >
                        {index + 1}
                      </button>
                    );
                  })}
                </div>

                <GuideQuizQuestionSlide
                  question={currentQuizQuestion}
                  questionIndex={currentQuizQuestionIndex}
                  totalQuestions={guideQuizzes.length}
                  selectedAnswer={selectedCurrentQuizAnswer}
                  confirmedAnswer={quizAnswers[currentQuizQuestion.id]}
                  submitted={isGuideQuizSubmitted}
                  correctAnswer={quizResult?.correct_answers?.[currentQuizQuestion.id]}
                  explanation={quizResult?.explanations?.[currentQuizQuestion.id]}
                  onSelect={selectDraftQuizAnswer}
                  onConfirm={confirmCurrentQuizAnswer}
                />

                <div className="quiz-carousel-controls">
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={currentQuizQuestionIndex === 0}
                    onClick={() => setCurrentQuizQuestionIndex((index) => Math.max(index - 1, 0))}
                  >
                    <ArrowLeft size={18} />
                    Previous
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={currentQuizQuestionIndex === guideQuizzes.length - 1}
                    onClick={() => setCurrentQuizQuestionIndex((index) => Math.min(index + 1, guideQuizzes.length - 1))}
                  >
                    Next
                    <ArrowRight size={18} />
                  </button>
                </div>
              </section>

              <section className="quiz-submit-panel guide-quiz-submit-panel">
                {!isGuideQuizReady ? (
                  <p>The full 5-question guide quiz is still being prepared. Please try again after the latest content update.</p>
                ) : !quizResult ? (
                  <>
                    <p>
                      Answer all 5 questions, then submit. XP is awarded server-side only after a
                      fully passing guide quiz, once per account.
                    </p>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={!isGuideQuizReady || answeredQuizCount !== guideQuizzes.length || isQuizSubmitting}
                      onClick={() => void submitQuiz()}
                    >
                      Submit quiz
                      <CheckCircle2 size={18} />
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      You can review each question above. Correct answers and explanations are shown
                      after submission.
                    </p>
                    {!quizResult.passed && (
                      <button className="ghost-button" type="button" onClick={resetGuideQuizAttempt}>
                        Try again
                        <RotateCcw size={18} />
                      </button>
                    )}
                  </>
                )}
              </section>

              {quizNotice && <p className="warning-box">{quizNotice}</p>}
              {quizResult && <GuideQuizResultPanel result={quizResult} onRetake={resetGuideQuizAttempt} />}
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

function GuideQuizQuestionSlide({
  question,
  questionIndex,
  totalQuestions,
  selectedAnswer,
  confirmedAnswer,
  submitted,
  correctAnswer,
  explanation,
  onSelect,
  onConfirm
}: {
  question: GuideQuiz;
  questionIndex: number;
  totalQuestions: number;
  selectedAnswer: string | undefined;
  confirmedAnswer: string | undefined;
  submitted: boolean;
  correctAnswer: string | undefined;
  explanation: string | undefined;
  onSelect: (questionId: string, option: string) => void;
  onConfirm: () => void;
}) {
  const answeredCorrectly = Boolean(correctAnswer && confirmedAnswer === correctAnswer);

  return (
    <article className="quiz-question-card guide-quiz-question-card">
      <div className="quiz-question-topline">
        <span className="status-pill">
          Question {questionIndex + 1} of {totalQuestions}
        </span>
      </div>

      <h2>{question.question}</h2>

      <div className="quiz-option-list">
        {question.answer_options.map((option) => {
          const isSelected = selectedAnswer === option;
          const isCorrectAnswer = correctAnswer === option;
          const isIncorrectSelection = submitted && confirmedAnswer === option && !isCorrectAnswer;
          const className = [
            "quiz-option",
            isSelected ? "selected" : "",
            submitted && isCorrectAnswer ? "correct" : "",
            isIncorrectSelection ? "incorrect" : ""
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              className={className}
              type="button"
              disabled={submitted}
              onClick={() => onSelect(question.id, option)}
              key={option}
            >
              <span>{option}</span>
              {submitted && isCorrectAnswer && (
                <span className="quiz-answer-state correct" aria-label="Correct answer">
                  <CheckCircle2 size={18} />
                </span>
              )}
              {isIncorrectSelection && (
                <span className="quiz-answer-state incorrect" aria-label="Your selected answer">
                  <XCircle size={18} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!submitted && (
        <div className="quiz-card-footer">
          <p>
            {confirmedAnswer
              ? "Answer confirmed. You can still change it before submitting."
              : "Choose one option, then confirm to move forward."}
          </p>
          <button className="primary-button" type="button" disabled={!selectedAnswer} onClick={onConfirm}>
            Confirm answer
            <CheckCircle2 size={18} />
          </button>
        </div>
      )}

      {submitted && correctAnswer && (
        <div className={answeredCorrectly ? "quiz-explanation correct" : "quiz-explanation incorrect"}>
          <strong>{answeredCorrectly ? "Correct" : "Review this one"}</strong>
          <p>
            Your answer: {confirmedAnswer}. Correct answer: {correctAnswer}.
          </p>
          {explanation && <p>{explanation}</p>}
        </div>
      )}
    </article>
  );
}

function GuideQuizResultPanel({
  result,
  onRetake
}: {
  result: GuideQuizSubmissionResult;
  onRetake: () => void;
}) {
  const progress = getProgressToNextLevel(result.total_xp);
  const score = result.score ?? 0;
  const totalQuestions = result.total_questions ?? 5;

  if (!result.passed) {
    return (
      <div className="quiz-explanation incorrect" aria-live="polite">
        <strong>
          <XCircle size={18} />
          Not passed yet
        </strong>
        <p>
          You scored {score}/{totalQuestions}. XP was not awarded. Review the guide and try the quiz again
          when you are ready.
        </p>
        <button className="ghost-button compact" type="button" onClick={onRetake}>
          Try again
          <RotateCcw size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="quiz-explanation correct guide-xp-result" aria-live="polite">
      <strong>
        <CheckCircle2 size={18} />
        {result.xp_awarded > 0 ? `Passed - ${result.xp_awarded} XP awarded` : "Passed - XP already awarded"}
      </strong>
      <p>You scored {score}/{totalQuestions} on this guide quiz.</p>
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
