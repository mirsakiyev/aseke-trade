import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const badgeMigration = await readFile(
  new URL("../supabase/migrations/202606130001_badge_system.sql", import.meta.url),
  "utf8"
);
const dashboardSource = await readFile(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");
const academyDashboardSource = await readFile(
  new URL("../src/pages/TradingAcademyDashboard.tsx", import.meta.url),
  "utf8"
);
const badgesApiSource = await readFile(new URL("../src/lib/badgesApi.ts", import.meta.url), "utf8");
const badgeComponentSource = await readFile(new URL("../src/components/UserBadgePill.tsx", import.meta.url), "utf8");
const tradingAcademyApiSource = await readFile(new URL("../src/lib/tradingAcademyApi.ts", import.meta.url), "utf8");

test("badge migration creates an idempotent badge and XP model", () => {
  for (const expected of [
    "public.user_badges",
    "'course_badge'",
    "'loyalty_badge'",
    "COURSE_BADGE_EARNED",
    "LOYALTY_BADGE_EARNED"
  ]) {
    assert.match(badgeMigration, new RegExp(expected.replace(/[.]/g, "\\."), "i"));
  }
  assert.match(badgeMigration, /unique\s+\(user_id,\s*badge_key\)/i);
  assert.match(badgeMigration, /on conflict\s+\(user_id,\s*source_type,\s*source_id\)\s+do nothing/i);
});

test("course badge logic requires every guide quiz in a course to be completed", () => {
  assert.match(badgeMigration, /check_and_award_course_badge_for_course/i);
  assert.match(badgeMigration, /required_guides = 0/i);
  assert.match(badgeMigration, /guides_with_quizzes <> required_guides/i);
  assert.match(badgeMigration, /completed_guides <> required_guides/i);
  assert.match(badgeMigration, /'course_completion'/i);
  assert.match(badgeMigration, /'course_completion:' \|\| course_record\.id::text/i);
  assert.match(badgeMigration, /100,\s*jsonb_build_object/i);
});

test("loyalty badge logic uses continuous subscription periods and increasing XP", () => {
  assert.match(badgeMigration, /check_and_award_subscription_loyalty_badges/i);
  assert.match(badgeMigration, /starts_at > previous_period_end/i);
  assert.match(badgeMigration, /for month_number in 2\.\.earned_months loop/i);
  assert.match(badgeMigration, /xp_award := 500 \+ \(\(month_number - 2\) \* 100\)/i);
  assert.match(badgeMigration, /'subscription_loyalty:' \|\| period_key \|\| ':month:' \|\| month_number::text/i);
  assert.match(badgeMigration, /subscriptionMonthNumber/i);
});

test("dashboard lazily evaluates badges and renders them under Learning Level", () => {
  assert.match(dashboardSource, /evaluateUserBadges/);
  assert.match(dashboardSource, /setUserBadges/);
  assert.match(dashboardSource, /areBadgesExpanded/);
  assert.match(dashboardSource, /level-badge-section/);
  assert.match(dashboardSource, /<UserBadgeRail/);
  assert.match(dashboardSource, /Show all \$\{userBadges\.length\}/);
  assert.match(dashboardSource, /Complete course quizzes or keep Trading Academy active to earn badges/);
  assert.match(badgesApiSource, /supabase\.rpc\("evaluate_user_badges"/);
});

test("leaderboard exposes compact public badge data without private subscription fields", () => {
  assert.match(badgeMigration, /badges jsonb/i);
  assert.match(badgeMigration, /badge_count integer/i);
  assert.match(badgeMigration, /jsonb_build_object\(\s*'id'/i);
  assert.match(badgeMigration, /subscriptionMonthNumber/i);
  assert.doesNotMatch(badgeMigration, /payment_reference|receive_address|email|wallet/i);
  assert.doesNotMatch(badgeMigration, /badge_position <= 3/i);
  assert.match(academyDashboardSource, /LeaderboardBadgeStrip/);
  assert.match(academyDashboardSource, /expandedLeaderboardBadges/);
  assert.match(academyDashboardSource, /row\.badges\.slice\(0,\s*3\)/);
  assert.match(academyDashboardSource, /aria-expanded=\{isExpanded\}/);
  assert.match(academyDashboardSource, /<UserBadgePill badge=\{badge\} size="small" showLabel=\{false\}/);
  assert.match(tradingAcademyApiSource, /normalizePublicBadges/);
});

test("badge UI has distinct course and loyalty variants", () => {
  assert.match(badgeMigration + badgeComponentSource, /course_completion/);
  assert.match(badgeComponentSource, /subscription_loyalty/);
  assert.match(badgeComponentSource, /Course Complete/);
  assert.match(badgeComponentSource, /Month Loyalty/);
  for (const variant of ["course-emerald", "course-violet", "loyalty-gold", "loyalty-platinum", "loyalty-diamond"]) {
    assert.match(badgeMigration + badgeComponentSource, new RegExp(variant));
  }
});
