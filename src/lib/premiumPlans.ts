export const PREMIUM_PRODUCT_LABEL = "Premium";

export const PREMIUM_PLANS = [
  {
    id: "premium_1_month",
    productLabel: PREMIUM_PRODUCT_LABEL,
    durationMonths: 1,
    durationLabel: "1 month",
    priceCents: 1000,
    badge: "Minimum plan",
    featured: false,
    description: "Start with the minimum Premium subscription duration."
  },
  {
    id: "premium_1_year",
    productLabel: PREMIUM_PRODUCT_LABEL,
    durationMonths: 12,
    durationLabel: "1 year",
    priceCents: 5000,
    badge: "Better value",
    featured: true,
    description: "Best value for learners staying with the full Premium path."
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
  if (months === 1) return "1 month";
  if (months === 12) return "1 year";
  return `${months} months`;
}

export function premiumCheckoutPath(planId: PremiumPlanId): string {
  return `/checkout/premium/${planId}`;
}
