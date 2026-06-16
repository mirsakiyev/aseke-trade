import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const guideDetailSource = await readFile(new URL("../src/pages/GuideDetail.tsx", import.meta.url), "utf8");
const gamificationApiSource = await readFile(new URL("../src/lib/gamificationApi.ts", import.meta.url), "utf8");
const migrationSource = await readFile(
  new URL("../supabase/migrations/202606150003_guide_quiz_carousel.sql", import.meta.url),
  "utf8"
);
const repairMigrationSource = await readFile(
  new URL("../supabase/migrations/202606150004_repair_guide_quiz_carousel.sql", import.meta.url),
  "utf8"
);

test("guide detail renders a five-question quiz carousel", () => {
  assert.match(guideDetailSource, /loadGuideQuizzes\(guide\.id\)/);
  assert.match(guideDetailSource, /setGuideQuizzes\(quizzes\.slice\(0,\s*5\)\)/);
  assert.match(guideDetailSource, /className="quiz-question-nav guide-quiz-nav"/);
  assert.match(guideDetailSource, /aria-label="Guide quiz carousel"/);
  assert.match(guideDetailSource, /Question \{questionIndex \+ 1\} of \{totalQuestions\}/);
  assert.match(guideDetailSource, /Answer all 5 questions/);
  assert.match(guideDetailSource, /const isGuideQuizReady = guideQuizzes\.length === 5/);
  assert.match(guideDetailSource, /!isGuideQuizReady \|\| answeredQuizCount !== guideQuizzes\.length/);
  assert.match(guideDetailSource, /answeredQuizCount !== guideQuizzes\.length/);
  assert.match(guideDetailSource, /submitGuideQuiz\(guide\.id,\s*quizAnswers\)/);
  assert.doesNotMatch(guideDetailSource, /\bsetQuizAnswer\b|quizAnswer === option/);
});

test("guide quiz API submits answers by question id", () => {
  assert.match(gamificationApiSource, /export async function loadGuideQuizzes/);
  assert.match(gamificationApiSource, /selectedAnswers: Record<string, string>/);
  assert.match(gamificationApiSource, /selected_answers: selectedAnswers/);
  assert.match(gamificationApiSource, /correct_answers\?: Record<string, string>/);
  assert.match(gamificationApiSource, /normalizeGuideQuizSubmissionResult/);
});

test("guide quiz migration supports five active questions per guide", () => {
  assert.match(migrationSource, /drop constraint if exists guide_quizzes_guide_id_key/i);
  assert.match(migrationSource, /guide_quizzes_guide_id_question_key unique \(guide_id, question\)/i);
  assert.match(migrationSource, /ensure_guide_quiz_question_count\(target_guide_id uuid\)/i);
  assert.match(migrationSource, /perform public\.ensure_guide_quiz_question_count\(target_guide_id\)/i);
  assert.match(migrationSource, /create or replace function public\.get_guide_quiz\(target_guide_id uuid\)/i);
  assert.match(migrationSource, /limit 5/i);
  assert.match(migrationSource, /create or replace function public\.submit_guide_quiz\(\s*target_guide_id uuid,\s*selected_answers jsonb/i);
  assert.match(migrationSource, /passed := total_questions = 5 and score = total_questions/i);
  assert.match(migrationSource, /grant execute on function public\.submit_guide_quiz\(uuid, jsonb\)/i);
  assert.match(migrationSource, /on conflict \(guide_id, question\) do nothing/i);
});

test("guide quiz repair migration replaces stale one-question quiz RPCs", () => {
  assert.match(repairMigrationSource, /drop function if exists public\.submit_guide_quiz\(uuid, text\)/i);
  assert.match(repairMigrationSource, /delete from public\.guide_quizzes as gq/i);
  assert.match(repairMigrationSource, /on conflict \(guide_id, question\) do update set/i);
  assert.match(repairMigrationSource, /is_active = true/i);
  assert.match(repairMigrationSource, /create or replace function public\.get_guide_quiz\(target_guide_id uuid\)/i);
  assert.match(repairMigrationSource, /perform public\.ensure_guide_quiz_question_count\(target_guide_id\)/i);
  assert.match(repairMigrationSource, /limit 5/i);
  assert.match(repairMigrationSource, /create or replace function public\.submit_guide_quiz\(\s*target_guide_id uuid,\s*selected_answers jsonb/i);
  assert.match(repairMigrationSource, /passed := total_questions = 5 and score = total_questions/i);
  assert.match(repairMigrationSource, /select public\.ensure_guide_quiz_question_count\(g\.id\)/i);
});
