import type { GuideQuiz } from "../types/content";
import { supabase } from "./supabase";

export interface GuideQuizSubmissionResult {
  passed: boolean;
  xp_awarded: number;
  total_xp: number;
  level: number;
  already_awarded: boolean;
  correct_answer: string | null;
  explanation: string | null;
  score?: number;
  total_questions?: number;
  correct_answers?: Record<string, string>;
  explanations?: Record<string, string>;
}

type GuideQuizRow = Omit<GuideQuiz, "answer_options"> & {
  answer_options: unknown;
};

export async function loadGuideQuiz(guideId: string): Promise<GuideQuiz | null> {
  const quizzes = await loadGuideQuizzes(guideId);
  return quizzes[0] ?? null;
}

export async function loadGuideQuizzes(guideId: string): Promise<GuideQuiz[]> {
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("get_guide_quiz", {
    target_guide_id: guideId
  });

  if (error) {
    console.warn("Guide quiz could not be loaded", error);
    return [];
  }

  const rows = Array.isArray(data) ? (data as GuideQuizRow[]) : data ? [data as GuideQuizRow] : [];

  return rows.map((row) => ({
    ...row,
    answer_options: normalizeAnswerOptions(row.answer_options)
  }));
}

export async function submitGuideQuiz(
  guideId: string,
  selectedAnswers: Record<string, string>
): Promise<GuideQuizSubmissionResult> {
  if (!supabase) {
    throw new Error("Supabase is not connected.");
  }

  const { data, error } = await supabase.rpc("submit_guide_quiz", {
    target_guide_id: guideId,
    selected_answers: selectedAnswers
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Quiz response was empty.");

  return normalizeGuideQuizSubmissionResult(row);
}

function normalizeAnswerOptions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return normalizeAnswerOptions(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((record, [key, item]) => {
    if (typeof item === "string") {
      record[key] = item;
    }

    return record;
  }, {});
}

function normalizeGuideQuizSubmissionResult(value: unknown): GuideQuizSubmissionResult {
  const row = value as Partial<GuideQuizSubmissionResult> & {
    correct_answers?: unknown;
    explanations?: unknown;
  };

  return {
    ...row,
    passed: Boolean(row.passed),
    xp_awarded: Number(row.xp_awarded ?? 0),
    total_xp: Number(row.total_xp ?? 0),
    level: Number(row.level ?? 1),
    already_awarded: Boolean(row.already_awarded),
    correct_answer: typeof row.correct_answer === "string" ? row.correct_answer : null,
    explanation: typeof row.explanation === "string" ? row.explanation : null,
    score: typeof row.score === "number" ? row.score : undefined,
    total_questions: typeof row.total_questions === "number" ? row.total_questions : undefined,
    correct_answers: normalizeStringRecord(row.correct_answers),
    explanations: normalizeStringRecord(row.explanations)
  };
}
