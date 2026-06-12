import { Award, BrainCircuit, CheckCircle2, LockKeyhole, Sparkles, Trophy, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import {
  loadPuzzle,
  submitPuzzle as submitPuzzleAnswer,
  type PuzzleSubmissionResult
} from "../lib/gamificationApi";
import { getProgressToNextLevel } from "../lib/levels";
import { getNextPuzzleRefreshTime } from "../lib/puzzleWindows";
import type { Puzzle } from "../types/content";

export function PuzzleOfTheDay() {
  const { user, refreshProfile } = useAuth();
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<PuzzleSubmissionResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let mounted = true;

    loadPuzzle()
      .then((nextPuzzle) => {
        if (!mounted) return;
        setPuzzle(nextPuzzle);
        setNotice(nextPuzzle ? null : "Connect Supabase and run migrations to load the current puzzle.");
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
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
      const nextResult = await submitPuzzleAnswer(puzzle.id, answer);
      setResult(nextResult);
      setPuzzle((current) =>
        current
          ? {
              ...current,
              reward_claimed: current.reward_claimed || nextResult.is_correct,
              user_completed: current.user_completed || nextResult.is_correct
            }
          : current
      );
      await refreshProfile();
    } catch {
      setNotice("Puzzle answer could not be submitted. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const nextRefresh = puzzle?.next_refresh_at ? new Date(puzzle.next_refresh_at) : getNextPuzzleRefreshTime(now);
  const refreshCountdown = formatRefreshCountdown(nextRefresh, now);

  return (
    <main className="page page-stack">
      <section className="page-title-row puzzle-title-row">
        <div>
          <p className="eyebrow">Puzzle</p>
          <h1>Crypto challenge</h1>
          <p className="muted">
            Solve the current puzzle window. A new challenge refreshes every 4 hours at 00:00, 04:00,
            08:00, 12:00, 16:00, and 20:00 UTC.
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
                <p className="eyebrow">{formatPuzzleWindow(puzzle.window_start_at)}</p>
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
                disabled={isSubmitting || puzzle.user_completed}
              />
            </label>

            <div className="inline-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!answer.trim() || isSubmitting || puzzle.user_completed}
                onClick={() => void submitPuzzle()}
              >
                {puzzle.user_completed ? "Puzzle completed" : "Submit answer"}
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
                <span>A new puzzle appears every 4 hours on a UTC schedule.</span>
              </li>
              <li>
                <CheckCircle2 size={17} />
                <span>The first correct solver receives 100 XP.</span>
              </li>
              <li>
                <CheckCircle2 size={17} />
                <span>Later correct solvers can see their result, but the XP reward stays claimed.</span>
              </li>
              <li>
                <CheckCircle2 size={17} />
                <span>Next refresh: {refreshCountdown}.</span>
              </li>
            </ul>
          </aside>
        </section>
      ) : (
        <section className="section-panel">
          <h2>Puzzle unavailable</h2>
          <p className="muted">The current puzzle could not be loaded.</p>
          <p className="muted">Next refresh: {refreshCountdown}.</p>
        </section>
      )}
    </main>
  );
}

function PuzzleResultPanel({ result }: { result: PuzzleSubmissionResult }) {
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
          ? "You claimed this window's first-solver reward."
          : "This window's XP reward was already claimed by an earlier solver."}
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

function formatPuzzleWindow(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Current window";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function formatRefreshCountdown(refreshAt: Date, now: Date): string {
  const remainingMs = Math.max(0, refreshAt.getTime() - now.getTime());
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
