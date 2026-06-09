import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  GraduationCap,
  RotateCcw,
  XCircle
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  cryptoQuizQuestions,
  type CryptoQuizQuestion,
  type QuizDifficulty
} from "../data/cryptoQuizQuestions";
import type { CourseDifficulty } from "../types/content";

type QuizLevel = CourseDifficulty;

type QuizAttemptQuestion = CryptoQuizQuestion & {
  shuffledOptions: string[];
};

type StoredQuizResult = {
  score: number;
  level: QuizLevel;
  takenAt: string;
};

type LevelRecommendation = {
  title: string;
  description: string;
  href: string;
  label: "Course" | "Guide" | "Track";
  level: QuizLevel;
};

const storageKey = "aseke-trade-crypto-quiz-result";
const difficultyLevels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const satisfies readonly QuizDifficulty[];

const questionsByDifficulty = difficultyLevels.reduce(
  (groups, difficulty) => {
    groups[difficulty] = cryptoQuizQuestions.filter((question) => question.difficulty === difficulty);
    return groups;
  },
  {} as Record<QuizDifficulty, CryptoQuizQuestion[]>
);

const levelDetails: Record<
  QuizLevel,
  {
    explanation: string;
    summary: string;
    cta: string;
    href: string;
  }
> = {
  Beginner: {
    explanation:
      "You are building the foundation. Focus on wallet safety, Bitcoin basics, transactions, and the difference between holding assets and trading them.",
    summary:
      "Your next best move is foundation work: custody, seed phrase safety, simple spot-market mechanics, and risk rules before leverage.",
    cta: "Start with the basics",
    href: "/guides"
  },
  Intermediate: {
    explanation:
      "You understand the core ideas and are ready to strengthen your trading structure, DeFi vocabulary, and risk habits before increasing complexity.",
    summary:
      "You are ready for structured trading frameworks, cleaner execution rules, and deeper practice with DeFi and futures vocabulary.",
    cta: "Build your trading foundation",
    href: "/courses"
  },
  Advanced: {
    explanation:
      "You have a strong command of crypto mechanics. Keep refining security, leverage control, protocol risk, and post-trade review.",
    summary:
      "Your priority is precision: leverage discipline, liquidation planning, protocol risk, infrastructure awareness, and consistent review.",
    cta: "Explore advanced strategies",
    href: "/courses"
  },
  Expert: {
    explanation:
      "You are comfortable with advanced protocol, market structure, and security concepts. Keep testing yourself as the space evolves.",
    summary:
      "You are ready for expert-tagged material around rollups, MEV, validator economics, cross-chain security, and advanced tokenomics.",
    cta: "You know your stuff - test yourself again",
    href: "/quiz"
  }
};

const levelRecommendations: Record<QuizLevel, LevelRecommendation[]> = {
  Beginner: [
    {
      title: "Crypto Foundations",
      description: "Start here for wallets, exchanges, spot markets, and the safety habits every learner needs first.",
      href: "/courses/crypto-basics",
      label: "Course",
      level: "Beginner"
    },
    {
      title: "Crypto Safety & Security",
      description: "Reinforce custody basics before moving larger balances or connecting wallets to apps.",
      href: "/guides/crypto-safety-security",
      label: "Guide",
      level: "Beginner"
    }
  ],
  Intermediate: [
    {
      title: "Investing & Market Research",
      description: "Build repeatable trading frameworks around setups, execution rules, journaling, and review.",
      href: "/courses/investing-market-research",
      label: "Course",
      level: "Intermediate"
    },
    {
      title: "Tokenomics & Project Research",
      description: "Practice turning market research into a clearer view of supply, incentives, and project quality.",
      href: "/guides/tokenomics-project-research",
      label: "Guide",
      level: "Intermediate"
    }
  ],
  Advanced: [
    {
      title: "Trading Academy",
      description: "Study liquidation buffers, funding awareness, leverage caps, and exposure control.",
      href: "/courses/trading-academy",
      label: "Course",
      level: "Advanced"
    },
    {
      title: "Risk Management Masterclass",
      description: "Go deeper on correlation, liquidation distance, and risk planning under volatility.",
      href: "/guides/risk-management-masterclass",
      label: "Guide",
      level: "Advanced"
    }
  ],
  Expert: [
    {
      title: "Blockchain Development",
      description: "Use this tag for future courses on rollups, MEV, zero-knowledge proofs, validator economics, and tokenomics.",
      href: "/courses/blockchain-development",
      label: "Course",
      level: "Expert"
    },
    {
      title: "On-Chain Analysis",
      description: "Read wallet behavior, liquidity movements, holder cohorts, and advanced on-chain market signals.",
      href: "/guides/on-chain-analysis",
      label: "Guide",
      level: "Expert"
    }
  ]
};

export function CryptoQuiz() {
  const [attempt, setAttempt] = useState<QuizAttemptQuestion[]>(createQuizAttempt);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [previousResult, setPreviousResult] = useState<StoredQuizResult | null>(null);

  const currentQuestion = attempt[currentQuestionIndex];
  const selectedCurrentAnswer = draftAnswers[currentQuestion.id] ?? answers[currentQuestion.id];
  const answeredCount = attempt.filter((question) => Boolean(answers[question.id])).length;
  const score = scoreAttempt(attempt, answers);
  const level = getQuizLevel(score);
  const progress = Math.round((answeredCount / attempt.length) * 100);
  const resultDetails = levelDetails[level];
  const recommendations = levelRecommendations[level];

  useEffect(() => {
    setPreviousResult(readStoredResult());
  }, []);

  const selectDraftAnswer = (questionId: string, option: string) => {
    if (submitted) {
      return;
    }

    setDraftAnswers((current) => ({
      ...current,
      [questionId]: option
    }));
  };

  const confirmCurrentAnswer = () => {
    if (!selectedCurrentAnswer || submitted) {
      return;
    }

    const nextAnswers = {
      ...answers,
      [currentQuestion.id]: selectedCurrentAnswer
    };

    setAnswers(nextAnswers);
    setDraftAnswers((current) => ({
      ...current,
      [currentQuestion.id]: selectedCurrentAnswer
    }));

    const nextUnansweredIndex = attempt.findIndex(
      (question, index) => index > currentQuestionIndex && !nextAnswers[question.id]
    );
    const fallbackUnansweredIndex = attempt.findIndex((question) => !nextAnswers[question.id]);

    if (nextUnansweredIndex !== -1) {
      setCurrentQuestionIndex(nextUnansweredIndex);
      return;
    }

    if (fallbackUnansweredIndex !== -1) {
      setCurrentQuestionIndex(fallbackUnansweredIndex);
      return;
    }

    setCurrentQuestionIndex((index) => Math.min(index + 1, attempt.length - 1));
  };

  const submitQuiz = () => {
    if (answeredCount !== attempt.length) {
      return;
    }

    const finalScore = scoreAttempt(attempt, answers);
    const finalLevel = getQuizLevel(finalScore);
    const storedResult = {
      score: finalScore,
      level: finalLevel,
      takenAt: new Date().toISOString()
    } satisfies StoredQuizResult;

    setSubmitted(true);
    setPreviousResult(storedResult);
    saveStoredResult(storedResult);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const retakeQuiz = () => {
    setAttempt(createQuizAttempt());
    setCurrentQuestionIndex(0);
    setDraftAnswers({});
    setAnswers({});
    setSubmitted(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="page page-stack quiz-page">
      <section className="page-title-row quiz-title-row">
        <div>
          <p className="eyebrow">Crypto Knowledge Quiz</p>
          <h1>Test your market knowledge</h1>
          <p>
            Answer 10 randomized questions, moving from beginner concepts to expert-level crypto
            mechanics.
          </p>
        </div>
        <span className="quiz-title-mark" aria-hidden="true">
          <BrainCircuit size={34} />
        </span>
      </section>

      <section className="quiz-status-grid" aria-label="Quiz status">
        <div className="quiz-status-panel">
          <span className="status-pill">10 questions</span>
          <strong>{answeredCount}/10 answered</strong>
          <div className="quiz-progress-track" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>

        {previousResult && (
          <div className="quiz-status-panel previous-result-panel">
            <span className="status-pill">Previous result</span>
            <strong>
              {previousResult.score}/10 - {previousResult.level}
            </strong>
            <p>{formatStoredDate(previousResult.takenAt)}</p>
          </div>
        )}
      </section>

      {submitted && (
        <section className="quiz-result-panel" aria-live="polite">
          <div>
            <p className="eyebrow">Result</p>
            <h2>You scored {score}/10</h2>
            <p>{resultDetails.explanation}</p>
            <div className="quiz-level-summary">
              <span className="status-pill">Recommended level tag: {level}</span>
              <p>{resultDetails.summary}</p>
            </div>
          </div>
          <div className="quiz-result-score">
            <span>{level}</span>
          </div>
          <div className="quiz-recommendations">
            <div>
              <p className="eyebrow">Suggested next courses</p>
              <h3>Recommended for your level</h3>
            </div>
            <div className="quiz-recommendation-grid">
              {recommendations.map((recommendation) => {
                const Icon = recommendation.label === "Course" ? GraduationCap : BookOpen;

                return (
                  <Link className="quiz-recommendation-card" to={recommendation.href} key={recommendation.title}>
                    <span className="feature-icon">
                      <Icon size={18} />
                    </span>
                    <span className="status-pill">{recommendation.level}</span>
                    <h4>{recommendation.title}</h4>
                    <p>{recommendation.description}</p>
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="quiz-actions">
            {level === "Expert" ? (
              <button className="primary-button" type="button" onClick={retakeQuiz}>
                {resultDetails.cta}
                <RotateCcw size={18} />
              </button>
            ) : (
              <Link className="primary-button" to={resultDetails.href}>
                {resultDetails.cta}
                <ArrowRight size={18} />
              </Link>
            )}
            <button className="ghost-button" type="button" onClick={retakeQuiz}>
              Retake quiz
              <RotateCcw size={18} />
            </button>
          </div>
        </section>
      )}

      <section className="quiz-carousel" aria-label="Quiz carousel">
        <div className="quiz-question-nav" aria-label="Jump to question">
          {attempt.map((question, index) => {
            const isCurrent = index === currentQuestionIndex;
            const isAnswered = Boolean(answers[question.id]);
            const isCorrect = answers[question.id] === question.correctAnswer;
            const className = [
              "quiz-question-nav-button",
              isCurrent ? "current" : "",
              isAnswered ? "answered" : "",
              submitted && isAnswered && isCorrect ? "correct" : "",
              submitted && isAnswered && !isCorrect ? "incorrect" : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                className={className}
                type="button"
                onClick={() => setCurrentQuestionIndex(index)}
                aria-current={isCurrent ? "step" : undefined}
                key={question.id}
              >
                {index + 1}
              </button>
            );
          })}
        </div>

        <QuizQuestionSlide
          question={currentQuestion}
          questionIndex={currentQuestionIndex}
          selectedAnswer={selectedCurrentAnswer}
          confirmedAnswer={answers[currentQuestion.id]}
          submitted={submitted}
          onSelect={selectDraftAnswer}
          onConfirm={confirmCurrentAnswer}
        />

        <div className="quiz-carousel-controls">
          <button
            className="ghost-button"
            type="button"
            disabled={currentQuestionIndex === 0}
            onClick={() => setCurrentQuestionIndex((index) => Math.max(index - 1, 0))}
          >
            <ArrowLeft size={18} />
            Previous
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={currentQuestionIndex === attempt.length - 1}
            onClick={() => setCurrentQuestionIndex((index) => Math.min(index + 1, attempt.length - 1))}
          >
            Next
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      <section className="quiz-submit-panel">
        {!submitted ? (
          <>
            <p>
              Answer all 10 questions, then submit to see your score, level, correct answers, and
              explanations.
            </p>
            <button
              className="primary-button"
              type="button"
              disabled={answeredCount !== attempt.length}
              onClick={submitQuiz}
            >
              See my level
              <CheckCircle2 size={18} />
            </button>
          </>
        ) : (
          <>
            <p>Want a fresh mix? Retake the quiz to pull a new question from every difficulty level.</p>
            <button className="ghost-button" type="button" onClick={retakeQuiz}>
              Retake quiz
              <RotateCcw size={18} />
            </button>
          </>
        )}
      </section>
    </main>
  );
}

function QuizQuestionSlide({
  question,
  questionIndex,
  selectedAnswer,
  confirmedAnswer,
  submitted,
  onSelect,
  onConfirm
}: {
  question: QuizAttemptQuestion;
  questionIndex: number;
  selectedAnswer: string | undefined;
  confirmedAnswer: string | undefined;
  submitted: boolean;
  onSelect: (questionId: string, option: string) => void;
  onConfirm: () => void;
}) {
  const answeredCorrectly = confirmedAnswer === question.correctAnswer;

  return (
    <article className="quiz-question-card">
      <div className="quiz-question-topline">
        <span className="status-pill">Question {questionIndex + 1} of 10</span>
        <span className="quiz-difficulty">Difficulty {question.difficulty}/10</span>
      </div>

      <h2>{question.question}</h2>

      <div className="quiz-option-list">
        {question.shuffledOptions.map((option) => {
          const isSelected = selectedAnswer === option;
          const isCorrectAnswer = question.correctAnswer === option;
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
          <p>{confirmedAnswer ? "Answer confirmed. You can still change it before submitting." : "Choose one option, then confirm to move forward."}</p>
          <button className="primary-button" type="button" disabled={!selectedAnswer} onClick={onConfirm}>
            Confirm answer
            <CheckCircle2 size={18} />
          </button>
        </div>
      )}

      {submitted && (
        <div className={answeredCorrectly ? "quiz-explanation correct" : "quiz-explanation incorrect"}>
          <strong>{answeredCorrectly ? "Correct" : "Review this one"}</strong>
          <p>
            Your answer: {confirmedAnswer}. Correct answer: {question.correctAnswer}.
          </p>
          <p>{question.explanation}</p>
        </div>
      )}
    </article>
  );
}

function createQuizAttempt(): QuizAttemptQuestion[] {
  return difficultyLevels.map((difficulty) => {
    const questionPool = questionsByDifficulty[difficulty];
    const question = questionPool[Math.floor(Math.random() * questionPool.length)];

    return {
      ...question,
      shuffledOptions: shuffleArray(question.options)
    };
  });
}

function shuffleArray<T>(items: readonly T[]): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function scoreAttempt(attempt: QuizAttemptQuestion[], answers: Record<string, string>) {
  return attempt.reduce((total, question) => {
    return answers[question.id] === question.correctAnswer ? total + 1 : total;
  }, 0);
}

function getQuizLevel(score: number): QuizLevel {
  if (score <= 2) {
    return "Beginner";
  }

  if (score <= 5) {
    return "Intermediate";
  }

  if (score <= 8) {
    return "Advanced";
  }

  return "Expert";
}

function readStoredResult(): StoredQuizResult | null {
  try {
    const rawResult = window.localStorage.getItem(storageKey);

    if (!rawResult) {
      return null;
    }

    const parsedResult = JSON.parse(rawResult) as Partial<StoredQuizResult>;

    if (
      typeof parsedResult.score === "number" &&
      isQuizLevel(parsedResult.level) &&
      typeof parsedResult.takenAt === "string"
    ) {
      return {
        score: parsedResult.score,
        level: parsedResult.level,
        takenAt: parsedResult.takenAt
      };
    }
  } catch {
    return null;
  }

  return null;
}

function saveStoredResult(result: StoredQuizResult) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(result));
  } catch {
    // Local result history is optional; the quiz should still work if storage is unavailable.
  }
}

function isQuizLevel(value: unknown): value is QuizLevel {
  return value === "Beginner" || value === "Intermediate" || value === "Advanced" || value === "Expert";
}

function formatStoredDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Saved locally";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}
