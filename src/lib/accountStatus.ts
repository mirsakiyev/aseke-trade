import type { Profile } from "../types/content";
import { TRADING_ACADEMY_PRODUCT_LABEL } from "./premiumPlans";
import { hasTradingAcademyAccess } from "./tradingAcademyAccess";

export type AccountPlanLabel = "Basic" | typeof TRADING_ACADEMY_PRODUCT_LABEL;

export function formatUsd(cents: number): string {
  const safeCents = Number.isFinite(cents) ? cents : 0;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(safeCents / 100);
}

export function hasActivePremiumAccess(profile: Profile | null, now = Date.now()): boolean {
  return hasTradingAcademyAccess(profile, now);
}

export function accountPlanLabel(profile: Profile | null): AccountPlanLabel {
  return hasActivePremiumAccess(profile) ? TRADING_ACADEMY_PRODUCT_LABEL : "Basic";
}

export function premiumExpiryLabel(profile: Profile | null): string | null {
  if (!profile?.premium_until) return null;

  const expiry = new Date(profile.premium_until);
  if (Number.isNaN(expiry.getTime())) return null;

  return expiry.toLocaleDateString();
}

export function accountEmailLabel(email: string | null | undefined): string {
  return email?.trim() || "Account";
}
