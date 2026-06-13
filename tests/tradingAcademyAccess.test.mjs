import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/tradingAcademyAccess.ts", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const academyAccess = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

const now = new Date("2026-06-12T12:00:00.000Z").getTime();
const baseProfile = {
  id: "profile-1",
  full_name: "Learner One",
  username: "learner",
  role: "user",
  total_xp: 0,
  level: 1,
  premium_starts_at: null,
  premium_until: null,
  avatar_url: null,
  created_at: "2026-01-01T00:00:00.000Z"
};

test("Trading Academy header keeps public path for logged-out and regular users", () => {
  assert.equal(academyAccess.tradingAcademyNavPath(false, null, now), "/trading-academy");
  assert.equal(academyAccess.tradingAcademyNavPath(true, baseProfile, now), "/trading-academy");
});

test("Trading Academy header routes active Academy users to dashboard", () => {
  const academyProfile = {
    ...baseProfile,
    role: "premium",
    premium_starts_at: "2026-06-01T00:00:00.000Z",
    premium_until: "2026-07-01T00:00:00.000Z"
  };

  assert.equal(academyAccess.tradingAcademyNavPath(true, academyProfile, now), "/trading-academy/dashboard");
});

test("site header keeps dashboard access in the account chip only", () => {
  assert.doesNotMatch(layoutSource, /label:\s*"Dashboard"/);
  assert.doesNotMatch(layoutSource, /LayoutDashboard/);
  assert.equal([...layoutSource.matchAll(/<Link to="\/dashboard" className="account-chip"/g)].length, 2);
});

test("site header shows account plan badges as icons", () => {
  assert.match(layoutSource, /account-plan-tag basic icon-only/);
  assert.match(layoutSource, /<UserRound size=\{13\} aria-hidden="true" \/>/);
  assert.match(layoutSource, /<Crown size=\{13\} aria-hidden="true" \/>/);
});

test("dashboard access decision separates logged-out, regular, and Academy users", () => {
  const academyProfile = {
    ...baseProfile,
    role: "premium",
    premium_until: "2026-07-01T00:00:00.000Z"
  };

  assert.equal(academyAccess.tradingAcademyDashboardDecision(false, null, now), "login");
  assert.equal(academyAccess.tradingAcademyDashboardDecision(true, baseProfile, now), "public");
  assert.equal(academyAccess.tradingAcademyDashboardDecision(true, academyProfile, now), "allow");
});

test("leaderboard sorting uses level, then XP, then join date", () => {
  const ranked = academyAccess.rankTradingAcademyLeaderboard([
    { display_name: "Newer L3", level: 3, total_xp: 300, joined_at: "2026-03-01T00:00:00.000Z" },
    { display_name: "Older L3", level: 3, total_xp: 300, joined_at: "2026-02-01T00:00:00.000Z" },
    { display_name: "L2 High XP", level: 2, total_xp: 900, joined_at: "2026-01-01T00:00:00.000Z" },
    { display_name: "L4", level: 4, total_xp: 100, joined_at: "2026-04-01T00:00:00.000Z" }
  ]);

  assert.deepEqual(
    ranked.map((row) => `${row.rank}:${row.display_name}`),
    ["1:L4", "2:Older L3", "3:Newer L3", "4:L2 High XP"]
  );
});

test("top three leaderboard tones are gold, silver, and bronze", () => {
  assert.equal(academyAccess.leaderboardRankTone(1), "gold");
  assert.equal(academyAccess.leaderboardRankTone(2), "silver");
  assert.equal(academyAccess.leaderboardRankTone(3), "bronze");
  assert.equal(academyAccess.leaderboardRankTone(4), "standard");
});
