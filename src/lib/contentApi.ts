import { sampleCourses, sampleGuides } from "../data/sampleContent";
import type { Course, CourseModule, Guide, Lesson } from "../types/content";
import { supabase } from "./supabase";
import { safeErrorMessage } from "./validation";

type ContentSource = "supabase" | "sample";

export interface ContentResult<T> {
  data: T;
  source: ContentSource;
  error: string | null;
}

function sortLessons(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort((a, b) => a.sort_order - b.sort_order);
}

function sortModules(modules: CourseModule[]): CourseModule[] {
  return [...modules]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((module) => ({ ...module, lessons: sortLessons(module.lessons ?? []) }));
}

function normalizeCourse(row: Record<string, unknown>): Course {
  const modules = ((row.course_modules as CourseModule[] | undefined) ?? row.modules ?? []) as CourseModule[];

  return {
    ...(row as unknown as Omit<Course, "modules">),
    modules: sortModules(modules)
  };
}

export async function loadGuides(): Promise<ContentResult<Guide[]>> {
  if (!supabase) {
    return { data: sampleGuides, source: "sample", error: null };
  }

  const { data, error } = await supabase
    .from("guides")
    .select(
      "id,title,slug,description,content,category,difficulty,estimated_read_time,is_premium,created_by,created_at,updated_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    return { data: sampleGuides, source: "sample", error: safeErrorMessage(error) };
  }

  return { data: (data ?? []) as Guide[], source: "supabase", error: null };
}

export async function loadCourses(): Promise<ContentResult<Course[]>> {
  if (!supabase) {
    return { data: sampleCourses, source: "sample", error: null };
  }

  const { data, error } = await supabase
    .from("courses")
    .select(
      "id,title,slug,description,difficulty,price_cents,is_premium,created_at,updated_at,course_modules(id,course_id,title,sort_order,created_at,lessons(id,module_id,title,content,video_url,sort_order,is_preview,is_premium,created_at,updated_at))"
    )
    .order("created_at", { ascending: false });

  if (error) {
    return { data: sampleCourses, source: "sample", error: safeErrorMessage(error) };
  }

  return {
    data: ((data ?? []) as unknown as Record<string, unknown>[]).map(normalizeCourse),
    source: "supabase",
    error: null
  };
}

export async function loadCourseBySlug(slug: string): Promise<ContentResult<Course | null>> {
  if (!supabase) {
    return {
      data: sampleCourses.find((course) => course.slug === slug) ?? null,
      source: "sample",
      error: null
    };
  }

  const { data, error } = await supabase
    .from("courses")
    .select(
      "id,title,slug,description,difficulty,price_cents,is_premium,created_at,updated_at,course_modules(id,course_id,title,sort_order,created_at,lessons(id,module_id,title,content,video_url,sort_order,is_preview,is_premium,created_at,updated_at))"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    return {
      data: sampleCourses.find((course) => course.slug === slug) ?? null,
      source: "sample",
      error: safeErrorMessage(error)
    };
  }

  return {
    data: data ? normalizeCourse(data as unknown as Record<string, unknown>) : null,
    source: "supabase",
    error: null
  };
}

export async function loadPurchasedCourseIds(userId: string): Promise<Set<string>> {
  if (!supabase) return new Set();

  const { data, error } = await supabase
    .from("purchases")
    .select("course_id")
    .eq("user_id", userId)
    .in("status", ["paid", "active", "granted"]);

  if (error) return new Set();

  return new Set((data ?? []).map((row) => row.course_id).filter(Boolean) as string[]);
}
