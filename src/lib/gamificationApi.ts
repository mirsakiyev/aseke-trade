import type { DailyPuzzle, GuideQuiz } from "../types/content";
import { supabase } from "./supabase";

export interface GuideQuizSubmissionResult {
  passed: boolean;
  xp_awarded: number;
  total_xp: number;
  level: number;
  already_awarded: boolean;
  correct_answer: string | null;
  explanation: string | null;
}

export interface DailyPuzzleSubmissionResult {
  is_correct: boolean;
  is_first_solver: boolean;
  xp_awarded: number;
  reward_already_claimed: boolean;
  total_xp: number;
  level: number;
}

type GuideQuizRow = Omit<GuideQuiz, "answer_options"> & {
  answer_options: unknown;
};

export async function loadGuideQuiz(guideId: string): Promise<GuideQuiz | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("get_guide_quiz", {
    target_guide_id: guideId
  });

  if (error) {
    console.warn("Guide quiz could not be loaded", error);
    return null;
  }

  const row = Array.isArray(data) ? (data[0] as GuideQuizRow | undefined) : (data as GuideQuizRow | null);
  if (!row) return null;

  return {
    ...row,
    answer_options: normalizeAnswerOptions(row.answer_options)
  };
}

export async function submitGuideQuiz(
  guideId: string,
  selectedAnswer: string
): Promise<GuideQuizSubmissionResult> {
  if (!supabase) {
    throw new Error("Supabase is not connected.");
  }

  const { data, error } = await supabase.rpc("submit_guide_quiz", {
    target_guide_id: guideId,
    selected_answer: selectedAnswer
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Quiz response was empty.");

  return row as GuideQuizSubmissionResult;
}

export async function loadDailyPuzzle(): Promise<DailyPuzzle | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("get_daily_puzzle");

  if (error) {
    console.warn("Daily puzzle could not be loaded", error);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return (row as DailyPuzzle | null) ?? null;
}

export async function submitDailyPuzzle(
  puzzleId: string,
  submittedAnswer: string
): Promise<DailyPuzzleSubmissionResult> {
  if (!supabase) {
    throw new Error("Supabase is not connected.");
  }

  const { data, error } = await supabase.rpc("submit_daily_puzzle", {
    target_puzzle_id: puzzleId,
    submitted_answer: submittedAnswer
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Puzzle response was empty.");

  return row as DailyPuzzleSubmissionResult;
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
