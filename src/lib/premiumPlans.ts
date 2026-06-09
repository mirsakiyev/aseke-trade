export const TRADING_ACADEMY_PRODUCT_LABEL = "Trading Academy";

// Internal premium IDs are retained so existing checkout URLs, records, and access logic keep working.
export const PREMIUM_PRODUCT_LABEL = TRADING_ACADEMY_PRODUCT_LABEL;

export const PREMIUM_PLANS = [
  {
    id: "premium_1_month",
    productLabel: PREMIUM_PRODUCT_LABEL,
    durationMonths: 1,
    durationLabel: "1 month",
    priceCents: 1000,
    badge: "Starter access",
    featured: false,
    description: "Start with one month of Trading Academy access."
  },
  {
    id: "premium_1_year",
    productLabel: PREMIUM_PRODUCT_LABEL,
    durationMonths: 12,
    durationLabel: "1 year",
    priceCents: 5000,
    badge: "Best value",
    featured: true,
    description: "Stay active for a full year of Trading Academy education and support."
  }
] as const;

export type PremiumPlan = (typeof PREMIUM_PLANS)[number];
export type PremiumPlanId = PremiumPlan["id"];

export function getPremiumPlan(planId: string | undefined): PremiumPlan | null {
  return PREMIUM_PLANS.find((plan) => plan.id === planId) ?? null;
}

export function formatPremiumPrice(cents: number): string {
  return `${Math.round(cents / 100)} USD`;
}

export function formatPlanDuration(months: number | null | undefined): string {
  if (!months) return "";
  if (months === 12) return "1 year";
  if (months === 1) return "1 month";
  return `${months} months`;
}

export function formatTradingAcademyPlan(durationLabel: string): string {
  if (!durationLabel) return TRADING_ACADEMY_PRODUCT_LABEL;
  return `${TRADING_ACADEMY_PRODUCT_LABEL} - ${durationLabel}`;
}

export function normalizeMembershipLabel(value: string | null | undefined): string {
  if (!value) return TRADING_ACADEMY_PRODUCT_LABEL;
  return value.replace(/\bPremium\b/g, TRADING_ACADEMY_PRODUCT_LABEL);
}

export function premiumCheckoutPath(planId: PremiumPlanId): string {
  return `/checkout/premium/${planId}`;
}
