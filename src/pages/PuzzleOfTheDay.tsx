import { Award, BrainCircuit, CheckCircle2, LockKeyhole, Sparkles, Trophy, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import {
  loadDailyPuzzle,
  submitDailyPuzzle,
  type DailyPuzzleSubmissionResult
} from "../lib/gamificationApi";
import { getProgressToNextLevel } from "../lib/levels";
import type { DailyPuzzle } from "../types/content";

export function PuzzleOfTheDay() {
  const { user, refreshProfile } = useAuth();
  const [puzzle, setPuzzle] = useState<DailyPuzzle | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<DailyPuzzleSubmissionResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    loadDailyPuzzle()
      .then((nextPuzzle) => {
        if (!mounted) return;
        setPuzzle(nextPuzzle);
        setNotice(nextPuzzle ? null : "Connect Supabase and run migrations to load today's puzzle.");
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const submitPuzzle = async () => {
    if (!puzzle || !answer.trim()) return;

    if (!user) {
      setNotice("Login to submit an answer and claim XP if you are first.");
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const nextResult = await submitDailyPuzzle(puzzle.id, answer);
      setResult(nextResult);
      setPuzzle((current) => (current ? { ...current, reward_claimed: current.reward_claimed || nextResult.is_correct } : current));
      await refreshProfile();
    } catch {
      setNotice("Puzzle answer could not be submitted. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="page page-stack">
      <section className="page-title-row puzzle-title-row">
        <div>
          <p className="eyebrow">Puzzle of the Day</p>
          <h1>Daily crypto challenge</h1>
          <p className="muted">
            Solve the daily puzzle. The first correct solver receives 100 XP; everyone else can still
            submit and check their answer.
          </p>
        </div>
        <span className="quiz-title-mark" aria-hidden="true">
          <BrainCircuit size={34} />
        </span>
      </section>

      {notice && <p className="soft-notice">{notice}</p>}

      {isLoading ? (
        <LoadingState label="Loading puzzle" />
      ) : puzzle ? (
        <section className="puzzle-grid">
          <article className="section-panel puzzle-panel">
            <div className="lesson-title-line">
              <div>
                <p className="eyebrow">{formatPuzzleDate(puzzle.puzzle_date)}</p>
                <h2>{puzzle.title}</h2>
              </div>
              <span className={puzzle.reward_claimed ? "status-pill free" : "status-pill premium"}>
                <Trophy size={15} />
                {puzzle.reward_claimed ? "Reward claimed" : "100 XP open"}
              </span>
            </div>

            <div className="puzzle-prompt">
              <Sparkles size={22} aria-hidden="true" />
              <p>{puzzle.prompt}</p>
            </div>

            <label>
              Your answer
              <input
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Type your answer"
                disabled={isSubmitting}
              />
            </label>

            <div className="inline-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!answer.trim() || isSubmitting}
                onClick={() => void submitPuzzle()}
              >
                Submit answer
                <CheckCircle2 size={18} />
              </button>
              {!user && (
                <Link className="ghost-button" to="/login">
                  <LockKeyhole size={17} />
                  Login to earn XP
                </Link>
              )}
            </div>

            {result && <PuzzleResultPanel result={result} />}
          </article>

          <aside className="section-panel puzzle-rules-panel">
            <span className="feature-icon">
              <Award size={21} />
            </span>
            <h2>Reward rules</h2>
            <ul className="check-list">
              <li>
                <CheckCircle2 size={17} />
                <span>One puzzle is shown each day.</span>
              </li>
              <li>
                <CheckCircle2 size={17} />
                <span>The first correct solver receives 100 XP.</span>
              </li>
              <li>
                <CheckCircle2 size={17} />
                <span>Later correct solvers can see their result, but the XP reward stays claimed.</span>
              </li>
            </ul>
          </aside>
        </section>
      ) : (
        <section className="section-panel">
          <h2>Puzzle unavailable</h2>
          <p className="muted">Today's puzzle could not be loaded.</p>
        </section>
      )}
    </main>
  );
}

function PuzzleResultPanel({ result }: { result: DailyPuzzleSubmissionResult }) {
  if (!result.is_correct) {
    return (
      <div className="quiz-explanation incorrect" aria-live="polite">
        <strong>
          <XCircle size={18} />
          Not quite
        </strong>
        <p>No XP was awarded. Try another answer.</p>
      </div>
    );
  }

  const progress = getProgressToNextLevel(result.total_xp);

  return (
    <div className="quiz-explanation correct guide-xp-result" aria-live="polite">
      <strong>
        <CheckCircle2 size={18} />
        {result.is_first_solver ? "First solver - 100 XP awarded" : "Correct answer"}
      </strong>
      <p>
        {result.is_first_solver
          ? "You claimed today's first-solver reward."
          : "Today's XP reward was already claimed by an earlier solver."}
      </p>
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

function formatPuzzleDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "Today";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}
