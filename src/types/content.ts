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
  total_xp: number;
  level: number;
  premium_starts_at: string | null;
  premium_until: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at?: string;
}

export type PremiumPlanId = "premium_1_month" | "premium_1_year";
export type PremiumSubscriptionPlanId = PremiumPlanId | "admin_custom";
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
  xp_reward: number;
  price_cents: number;
  is_premium: boolean;
  is_archived: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  course?: Pick<Course, "id" | "title" | "slug" | "is_premium"> | null;
}

export interface GuideQuiz {
  id: string;
  guide_id: string;
  question: string;
  answer_options: string[];
}

export interface GuideCompletion {
  id: string;
  user_id: string;
  guide_id: string;
  guide_quiz_id: string | null;
  selected_answer: string | null;
  quiz_passed: boolean;
  xp_awarded: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface XPTransaction {
  id: string;
  user_id: string;
  amount: number;
  source_type: "guide" | "puzzle_of_day" | "admin_adjustment";
  source_id: string;
  description: string | null;
  created_at: string;
}

export interface DailyPuzzle {
  id: string;
  puzzle_date: string;
  title: string;
  prompt: string;
  category: string;
  reward_claimed: boolean;
}

export interface DailyPuzzleSolve {
  id: string;
  puzzle_id: string;
  user_id: string;
  submitted_answer: string;
  is_correct: boolean;
  is_first_solver: boolean;
  created_at: string;
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
  transaction_type: "deposit" | "purchase" | "refund" | "adjustment" | "fee";
  amount_cents: number;
  description: string | null;
  created_at: string;
}

export type TradingSignalDirection = "long" | "short";
export type TradingSignalStatus = "active" | "hit_tp" | "hit_sl" | "manually_closed";
export type TradingSignalUpdateType = "signal_created" | "signal_edited" | "note" | "tp_hit" | "sl_hit" | "manual_close";

export interface TradingSignalTakeProfit {
  id: string;
  price: string | number;
  positionSizePercent: string | number;
  position_size_percent?: string | number;
  isHit: boolean;
  is_hit?: boolean;
  hitAt: string | null;
  hit_at?: string | null;
}

export interface TradingSignalUpdate {
  id: string;
  type: TradingSignalUpdateType;
  message: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export interface TradingSignalOriginalSnapshot {
  generatedTitle: string;
  symbol: string;
  direction: TradingSignalDirection;
  leverage: number;
  entryPrice: string | number;
  stopLoss: string | number;
  takeProfits: TradingSignalTakeProfit[];
  priceAtCreation: string | number;
  notes: string | null;
  createdAt: string;
}

export interface TradingSignal {
  id: string;
  title: string | null;
  generated_title: string | null;
  symbol: string;
  direction: TradingSignalDirection;
  leverage: number;
  entry_price: string | number;
  stop_loss: string | number;
  take_profits: TradingSignalTakeProfit[] | null;
  take_profit_1?: string | number | null;
  take_profit_2?: string | number | null;
  take_profit_3?: string | number | null;
  additional_take_profits?: Array<string | number> | null;
  price_at_creation: string | number;
  chart_image_url: string | null;
  notes: string | null;
  status: TradingSignalStatus;
  updates: TradingSignalUpdate[] | null;
  original_signal: TradingSignalOriginalSnapshot | null;
  closed_at: string | null;
  manual_close_price: string | number | null;
  final_price: string | number | null;
  final_roi: string | number | null;
  is_active?: boolean;
  created_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
}

export type AmlCheckStatus = "pending" | "in_review" | "completed" | "rejected" | "refunded";

export interface AmlCheckRequest {
  id: string;
  user_id: string;
  address: string;
  network: string;
  notes: string | null;
  status: AmlCheckStatus;
  admin_result: string | null;
  admin_notes: string | null;
  amount_charged_cents: number;
  transaction_id: string | null;
  idempotency_key: string | null;
  reviewed_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type PremiumSupportPriority = "low" | "normal" | "high" | "urgent";
export type PremiumSupportStatus = "open" | "in_review" | "answered" | "closed";

export interface PremiumSupportRequest {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  category: string | null;
  priority: PremiumSupportPriority;
  status: PremiumSupportStatus;
  admin_response: string | null;
  admin_notes: string | null;
  reviewed_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TradingAcademyLeaderboardRow {
  rank: number;
  member_key: string;
  display_name: string;
  level: number;
  total_xp: number;
  joined_at: string;
}

export interface PremiumSubscription {
  id: string;
  user_id: string;
  product_type: "premium";
  product_label: string;
  plan_id: PremiumSubscriptionPlanId;
  plan_duration_months: number;
  starts_at: string;
  expires_at: string;
  price_cents: number;
  status: "pending" | "active" | "expired" | "cancelled" | "failed";
  crypto_payment_id: string | null;
  balance_transaction_id: string | null;
  granted_by: string | null;
  admin_note: string | null;
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
