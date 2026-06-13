import type { PublicUserBadge, UserBadge, UserBadgeMetadata, UserBadgeType } from "../types/content";
import { supabase } from "./supabase";

type BadgeRow = Record<string, unknown>;

export async function evaluateUserBadges(userId?: string): Promise<UserBadge[]> {
  if (!supabase) return [];

  const args = userId ? { target_user_id: userId } : undefined;
  const { data, error } = await supabase.rpc("evaluate_user_badges", args);
  if (error) throw new Error("Badges could not be evaluated.");

  return normalizeUserBadges(data);
}

export async function fetchUserBadges(userId: string): Promise<UserBadge[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("user_badges")
    .select("*")
    .eq("user_id", userId)
    .order("xp_awarded", { ascending: false })
    .order("earned_at", { ascending: false });

  if (error) throw new Error("Badges could not be loaded.");
  return normalizeUserBadges(data);
}

export function normalizeUserBadges(value: unknown): UserBadge[] {
  return normalizeBadgeRows(value).map((badge) => ({
    ...badge,
    user_id: String((badge as UserBadge).user_id ?? ""),
    badge_key: String((badge as UserBadge).badge_key ?? ""),
    created_at: typeof (badge as UserBadge).created_at === "string" ? (badge as UserBadge).created_at : undefined,
    updated_at: typeof (badge as UserBadge).updated_at === "string" ? (badge as UserBadge).updated_at : undefined
  }));
}

export function normalizePublicBadges(value: unknown): PublicUserBadge[] {
  return normalizeBadgeRows(value).map(({ user_id: _userId, badge_key: _badgeKey, created_at: _createdAt, updated_at: _updatedAt, ...badge }) => badge);
}

function normalizeBadgeRows(value: unknown): UserBadge[] {
  const rows = Array.isArray(value) ? value : [];

  return rows
    .filter((row): row is BadgeRow => Boolean(row) && typeof row === "object")
    .map((row) => {
      const metadata = normalizeMetadata(row.metadata);
      return {
        id: String(row.id ?? ""),
        user_id: String(row.user_id ?? ""),
        badge_type: normalizeBadgeType(row.badge_type),
        badge_key: String(row.badge_key ?? ""),
        name: String(row.name ?? "Achievement"),
        description: String(row.description ?? ""),
        icon: String(row.icon ?? "award"),
        style_variant: String(row.style_variant ?? "course-silver"),
        xp_awarded: normalizeInteger(row.xp_awarded),
        earned_at: String(row.earned_at ?? new Date(0).toISOString()),
        metadata,
        created_at: typeof row.created_at === "string" ? row.created_at : undefined,
        updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined
      };
    });
}

function normalizeBadgeType(value: unknown): UserBadgeType {
  return value === "subscription_loyalty" ? "subscription_loyalty" : "course_completion";
}

function normalizeInteger(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.round(numberValue)) : 0;
}

function normalizeMetadata(value: unknown): UserBadgeMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const rawMetadata = value as Record<string, unknown>;
  const metadata: UserBadgeMetadata = { ...rawMetadata };

  if (typeof rawMetadata.subscriptionMonthNumber === "string") {
    metadata.subscriptionMonthNumber = normalizeInteger(rawMetadata.subscriptionMonthNumber);
  }

  if (typeof rawMetadata.continuousMonths === "string") {
    metadata.continuousMonths = normalizeInteger(rawMetadata.continuousMonths);
  }

  return metadata;
}
