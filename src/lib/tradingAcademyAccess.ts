import type { Profile, TradingAcademyLeaderboardRow } from "../types/content";

export const TRADING_ACADEMY_PUBLIC_PATH = "/trading-academy";
export const TRADING_ACADEMY_DASHBOARD_PATH = "/trading-academy/dashboard";

export type TradingAcademyRouteDecision = "allow" | "login" | "public";
export type LeaderboardRankTone = "gold" | "silver" | "bronze" | "standard";

export function hasTradingAcademyAccess(profile: Profile | null, now = Date.now()): boolean {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  if (profile.premium_starts_at && new Date(profile.premium_starts_at).getTime() > now) return false;
  if (!profile.premium_until) return false;

  return new Date(profile.premium_until).getTime() > now;
}

export function tradingAcademyNavPath(isLoggedIn: boolean, profile: Profile | null, now = Date.now()): string {
  return isLoggedIn && hasTradingAcademyAccess(profile, now)
    ? TRADING_ACADEMY_DASHBOARD_PATH
    : TRADING_ACADEMY_PUBLIC_PATH;
}

export function tradingAcademyDashboardDecision(
  isLoggedIn: boolean,
  profile: Profile | null,
  now = Date.now()
): TradingAcademyRouteDecision {
  if (!isLoggedIn) return "login";
  return hasTradingAcademyAccess(profile, now) ? "allow" : "public";
}

export function rankTradingAcademyLeaderboard<T extends Pick<TradingAcademyLeaderboardRow, "level" | "total_xp" | "joined_at">>(
  rows: T[]
): Array<T & { rank: number }> {
  return [...rows]
    .sort((left, right) => {
      const levelDiff = right.level - left.level;
      if (levelDiff !== 0) return levelDiff;

      const xpDiff = right.total_xp - left.total_xp;
      if (xpDiff !== 0) return xpDiff;

      return new Date(left.joined_at).getTime() - new Date(right.joined_at).getTime();
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function leaderboardRankTone(rank: number): LeaderboardRankTone {
  if (rank === 1) return "gold";
  if (rank === 2) return "silver";
  if (rank === 3) return "bronze";
  return "standard";
}
