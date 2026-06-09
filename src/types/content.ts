export const GUIDE_CATEGORIES = [
  "Crypto Basics",
  "Investing & Market Research",
  "Trading Academy",
  "DeFi & On-Chain Intelligence",
  "Blockchain Development"
] as const;

export const COURSE_DIFFICULTIES = ["Beginner", "Intermediate", "Advanced", "Expert"] as const;

export const DIFFICULTIES = [
  ...COURSE_DIFFICULTIES,
  "Beginner / Intermediate",
  "Intermediate / Advanced",
  "Advanced / Expert",
  "Beginner / Intermediate / Advanced"
] as const;

export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];
export type CourseDifficulty = (typeof COURSE_DIFFICULTIES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];
export type UserRole = "user" | "premium" | "admin";

export interface Profile {
  id: string;
  full_name: string | null;
  username: string | null;
  role: UserRole;
  premium_until: string | null;
  created_at: string;
}

export type PremiumPlanId = "premium_1_month" | "premium_1_year";
export type PaymentProductType = "premium" | "course" | "guide" | "deposit";

export interface Guide {
  id: string;
  course_id: string | null;
  title: string;
  slug: string;
  description: string;
  content: string;
  category: GuideCategory;
  difficulty: Difficulty;
  estimated_read_time: number;
  price_cents: number;
  is_premium: boolean;
  is_archived: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  course?: Pick<Course, "id" | "title" | "slug" | "is_premium"> | null;
}

export interface Course {
  id: string;
  title: string;
  slug: string;
  description: string;
  difficulty: CourseDifficulty;
  price_cents: number;
  is_premium: boolean;
  is_archived: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  modules: CourseModule[];
  guides: Guide[];
}

export interface CourseModule {
  id: string;
  course_id: string;
  title: string;
  sort_order: number;
  created_at: string;
  lessons: Lesson[];
}

export interface Lesson {
  id: string;
  module_id: string;
  title: string;
  content: string;
  video_url: string | null;
  sort_order: number;
  is_preview: boolean;
  is_premium: boolean;
  created_at: string;
  updated_at: string;
}

export interface Purchase {
  id: string;
  user_id: string;
  course_id: string | null;
  guide_id: string | null;
  status: "pending" | "paid" | "active" | "granted" | "revoked" | "refunded";
  payment_provider: string | null;
  payment_reference: string | null;
  amount_cents: number | null;
  created_at: string;
}

export type CryptoPaymentStatus =
  | "pending"
  | "submitted"
  | "verifying"
  | "confirmed"
  | "underpaid"
  | "overpaid"
  | "expired"
  | "failed"
  | "duplicate";

export type CryptoAsset = "USDT" | "USDC";
export type CryptoNetwork = "TRC20" | "ERC20";

export interface CryptoPayment {
  id: string;
  user_id: string;
  course_id: string | null;
  guide_id: string | null;
  payment_type: "purchase" | "deposit";
  product_type: PaymentProductType;
  product_label: string | null;
  plan_id: PremiumPlanId | null;
  plan_duration_months: number | null;
  fiat_amount_cents: number | null;
  fiat_currency: "USD";
  premium_starts_at: string | null;
  premium_expires_at: string | null;
  payment_method_id: string;
  expected_amount: string | number;
  received_amount: string | number | null;
  asset: CryptoAsset;
  network: CryptoNetwork;
  receive_address: string;
  tx_hash: string | null;
  status: CryptoPaymentStatus;
  expires_at: string;
  submitted_at: string | null;
  confirmed_at: string | null;
  admin_review_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CryptoPaymentMethod {
  id: string;
  asset: CryptoAsset;
  network: CryptoNetwork;
  receive_address: string;
  min_confirmations: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountBalance {
  user_id: string;
  balance_cents: number;
  created_at: string;
  updated_at: string;
}

export interface AccountBalanceTransaction {
  id: string;
  user_id: string;
  crypto_payment_id: string | null;
  course_id: string | null;
  guide_id: string | null;
  product_type: PaymentProductType | null;
  product_label: string | null;
  plan_id: PremiumPlanId | null;
  plan_duration_months: number | null;
  premium_subscription_id: string | null;
  transaction_type: "deposit" | "purchase" | "refund" | "adjustment";
  amount_cents: number;
  description: string | null;
  created_at: string;
}

export interface PremiumSubscription {
  id: string;
  user_id: string;
  product_type: "premium";
  product_label: "Premium";
  plan_id: PremiumPlanId;
  plan_duration_months: number;
  starts_at: string;
  expires_at: string;
  price_cents: number;
  status: "pending" | "active" | "expired" | "cancelled" | "failed";
  crypto_payment_id: string | null;
  balance_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedGuide {
  id: string;
  user_id: string;
  guide_id: string;
  created_at: string;
  guides?: Pick<Guide, "title" | "slug" | "category"> | null;
}

export interface LessonProgress {
  id: string;
  user_id: string;
  lesson_id: string;
  completed: boolean;
  completed_at: string | null;
  lessons?: Pick<Lesson, "title"> | null;
}
