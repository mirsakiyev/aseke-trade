export const GUIDE_CATEGORIES = [
  "Basics",
  "Wallets & Security",
  "Spot Trading",
  "Futures Trading",
  "Risk Management",
  "Trading Strategies",
  "Advanced Concepts"
] as const;

export const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"] as const;

export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];
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

export interface Guide {
  id: string;
  title: string;
  slug: string;
  description: string;
  content: string;
  category: GuideCategory;
  difficulty: Difficulty;
  estimated_read_time: number;
  is_premium: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Course {
  id: string;
  title: string;
  slug: string;
  description: string;
  difficulty: Difficulty;
  price_cents: number;
  is_premium: boolean;
  created_at: string;
  updated_at: string;
  modules: CourseModule[];
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
