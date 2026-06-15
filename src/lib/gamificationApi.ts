import { getCurrentPuzzleWindow } from "./puzzleWindows";
import type {
  ReferenceAssetPrices,
  RouteOptimizerXpOutcome,
  RouteResult,
  OptimalRoute,
  UserSelection
} from "./tradeRouteOptimizer";
import type { DailyPuzzle, GuideQuiz, Puzzle } from "../types/content";
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

export type PuzzleSubmissionResult = DailyPuzzleSubmissionResult;

export interface RouteOptimizerCompletionResult {
  completion_id: string;
  xp_awarded: number;
  xp_outcome: RouteOptimizerXpOutcome;
  xp_multiplier: number;
  rounded_profit: number;
  total_xp: number;
  level: number;
  already_completed: boolean;
}

export interface RouteOptimizerCompletionInput {
  puzzleDate: string;
  puzzleSeed: string;
  selectedRoute: UserSelection;
  userResult: RouteResult;
  optimalRoute: OptimalRoute;
  score: number;
  startingBalance: number;
  referencePricesUsed: ReferenceAssetPrices;
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

export async function loadPuzzle(): Promise<Puzzle | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("get_puzzle");

  if (error) {
    console.warn("Puzzle could not be loaded", error);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return normalizePuzzleRow(row);
}

export async function submitPuzzle(
  puzzleId: string,
  submittedAnswer: string
): Promise<PuzzleSubmissionResult> {
  if (!supabase) {
    throw new Error("Supabase is not connected.");
  }

  const { data, error } = await supabase.rpc("submit_puzzle", {
    target_puzzle_id: puzzleId,
    submitted_answer: submittedAnswer
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Puzzle response was empty.");

  return row as DailyPuzzleSubmissionResult;
}

export async function loadDailyPuzzle(): Promise<DailyPuzzle | null> {
  return loadPuzzle();
}

export async function submitDailyPuzzle(
  puzzleId: string,
  submittedAnswer: string
): Promise<DailyPuzzleSubmissionResult> {
  return submitPuzzle(puzzleId, submittedAnswer);
}

export async function submitTradeRouteOptimizerCompletion(
  input: RouteOptimizerCompletionInput
): Promise<RouteOptimizerCompletionResult> {
  if (!supabase) {
    throw new Error("Supabase is not connected.");
  }

  const { data, error } = await supabase.rpc("submit_trade_route_optimizer_completion", {
    target_puzzle_date: input.puzzleDate,
    target_puzzle_seed: input.puzzleSeed,
    selected_route: input.selectedRoute,
    user_result: input.userResult,
    optimal_route: input.optimalRoute,
    target_score: input.score,
    target_starting_balance: input.startingBalance,
    reference_prices_used: input.referencePricesUsed
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Route Optimizer completion response was empty.");

  return row as RouteOptimizerCompletionResult;
}

function normalizePuzzleRow(value: unknown): Puzzle | null {
  if (!value || typeof value !== "object") return null;

  const row = value as Partial<Puzzle>;
  const fallbackWindow = getCurrentPuzzleWindow();

  return {
    id: String(row.id ?? ""),
    puzzle_date: row.puzzle_date,
    puzzle_window_id: row.puzzle_window_id ?? fallbackWindow.id,
    window_start_at: row.window_start_at ?? fallbackWindow.start.toISOString(),
    next_refresh_at: row.next_refresh_at ?? fallbackWindow.nextRefresh.toISOString(),
    title: String(row.title ?? ""),
    prompt: String(row.prompt ?? ""),
    category: String(row.category ?? "crypto puzzle"),
    reward_claimed: Boolean(row.reward_claimed),
    user_completed: Boolean(row.user_completed)
  };
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
