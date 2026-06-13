import {
  Award,
  BarChart3,
  Blocks,
  BookOpen,
  Crown,
  Diamond,
  Flame,
  GraduationCap,
  LineChart,
  Network,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy
} from "lucide-react";
import type { PublicUserBadge, UserBadge } from "../types/content";

type BadgeLike = UserBadge | PublicUserBadge;
type BadgeSize = "small" | "medium";

interface UserBadgePillProps {
  badge: BadgeLike;
  size?: BadgeSize;
  showLabel?: boolean;
}

interface UserBadgeRailProps {
  badges: BadgeLike[];
  emptyLabel: string;
  maxVisible?: number;
  size?: BadgeSize;
}

const iconMap = {
  award: Award,
  "bar-chart": BarChart3,
  blocks: Blocks,
  "book-open": BookOpen,
  crown: Crown,
  diamond: Diamond,
  flame: Flame,
  "graduation-cap": GraduationCap,
  "line-chart": LineChart,
  network: Network,
  shield: ShieldCheck,
  sparkles: Sparkles,
  star: Star,
  trophy: Trophy
};

export function UserBadgePill({ badge, size = "medium", showLabel = true }: UserBadgePillProps) {
  const Icon = iconMap[badge.icon as keyof typeof iconMap] ?? Award;
  const label = badgeLabel(badge);
  const title = `${badge.name}. ${label}. Earned ${formatBadgeDate(badge.earned_at)}. +${badge.xp_awarded} XP. ${badge.description}`;

  return (
    <span
      className={`user-badge-pill ${badge.badge_type} ${badgeVariantClass(badge.style_variant)} ${size}`}
      title={title}
      aria-label={title}
    >
      <span className="user-badge-icon">
        <Icon size={size === "small" ? 14 : 17} aria-hidden="true" />
      </span>
      {showLabel ? (
        <span className="user-badge-copy">
          <strong>{badge.name}</strong>
          <small>{label} · +{badge.xp_awarded} XP</small>
        </span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  );
}

export function UserBadgeRail({ badges, emptyLabel, maxVisible = 6, size = "medium" }: UserBadgeRailProps) {
  const visibleBadges = badges.slice(0, maxVisible);
  const hiddenCount = Math.max(0, badges.length - visibleBadges.length);

  if (!visibleBadges.length) {
    return (
      <div className="user-badge-empty">
        <Award size={17} aria-hidden="true" />
        <span>{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className={`user-badge-rail ${size}`}>
      {visibleBadges.map((badge) => (
        <UserBadgePill badge={badge} size={size} showLabel={size !== "small"} key={badge.id} />
      ))}
      {hiddenCount > 0 && (
        <span className={`user-badge-more ${size}`} title={`${hiddenCount} more badges`}>
          +{hiddenCount}
        </span>
      )}
    </div>
  );
}

function badgeLabel(badge: BadgeLike): string {
  if (badge.badge_type === "subscription_loyalty") {
    const month = badge.metadata.subscriptionMonthNumber;
    return typeof month === "number" && month > 0 ? `${month} Month Loyalty` : "Loyalty Badge";
  }

  return "Course Complete";
}

function badgeVariantClass(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function formatBadgeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";

  return date.toLocaleDateString();
}
