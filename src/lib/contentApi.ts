import { sampleCourses, sampleGuides } from "../data/sampleContent";
import type { Course, CourseModule, Guide, Lesson } from "../types/content";
import { supabase, supabaseConfigError, supabaseProjectRef } from "./supabase";

type ContentSource = "supabase" | "sample";

export interface ContentResult<T> {
  data: T;
  source: ContentSource;
  error: string | null;
}

function missingSupabaseMessage(): string {
  return `${supabaseConfigError ?? "Supabase environment variables are not available in this build."} ${projectRefMessage()} If you just changed them, restart the dev server or redeploy Netlify.`;
}

function projectRefMessage(): string {
  return supabaseProjectRef ? `Project ref: ${supabaseProjectRef}.` : "Project ref unavailable.";
}

function maskSensitiveValues(value: string): string {
  return value
    .replace(/sb_publishable_[A-Za-z0-9._-]+/g, "sb_publishable_...")
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, "sb_secret_...")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "eyJ...");
}

function errorDetail(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";

  const supabaseError = error as {
    code?: unknown;
    details?: unknown;
    hint?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const parts = [
    supabaseError.code,
    supabaseError.message,
    supabaseError.details,
    supabaseError.hint,
    supabaseError.name
  ]
    .map((part) => (typeof part === "string" ? maskSensitiveValues(part.trim()) : ""))
    .filter(Boolean);

  return [...new Set(parts)].join(" ").slice(0, 420);
}

function withErrorDetail(message: string, error: unknown): string {
  const detail = errorDetail(error);
  const ref = projectRefMessage();
  return detail ? `${message} ${ref} ${detail}` : `${message} ${ref}`;
}

function contentLoadError(contentName: string, error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("failed to fetch")) {
    return withErrorDetail(`Supabase ${contentName} could not be reached. Showing sample ${contentName}.`, error);
  }

  if (lowerMessage.includes("invalid jwt") || lowerMessage.includes("invalid api key")) {
    return withErrorDetail(`Supabase rejected the public API key. Showing sample ${contentName}.`, error);
  }

  if (lowerMessage.includes("relationship")) {
    return withErrorDetail(
      `Supabase ${contentName} query does not match the database schema. Showing sample ${contentName}.`,
      error
    );
  }

  if (lowerMessage.includes("permission denied") || lowerMessage.includes("row-level security")) {
    return withErrorDetail(`Supabase permissions blocked ${contentName}. Showing sample ${contentName}.`, error);
  }

  return withErrorDetail(`Supabase ${contentName} could not be loaded. Showing sample ${contentName}.`, error);
}

function logContentError(contentName: string, error: unknown): void {
  console.warn(`Supabase ${contentName} load failed`, error);
}

function sortLessons(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort((a, b) => a.sort_order - b.sort_order);
}

function sortModules(modules: CourseModule[]): CourseModule[] {
  return [...modules]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((module) => ({ ...module, lessons: sortLessons(module.lessons ?? []) }));
}

function sortGuides(guides: Guide[]): Guide[] {
  return [...guides].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
}

function normalizeGuide(row: Record<string, unknown>): Guide {
  const courseValue = row.course ?? row.courses ?? null;
  const course = Array.isArray(courseValue) ? courseValue[0] ?? null : courseValue;

  return {
    ...(row as unknown as Omit<Guide, "course">),
    course: course as Guide["course"]
  };
}

function normalizeCourse(row: Record<string, unknown>): Course {
  const modules = ((row.course_modules as CourseModule[] | undefined) ?? row.modules ?? []) as CourseModule[];
  const guides = ((row.guides as Record<string, unknown>[] | undefined) ?? []).map(normalizeGuide);

  return {
    ...(row as unknown as Omit<Course, "modules" | "guides">),
    modules: sortModules(modules),
    guides: sortGuides(guides)
  };
}

export async function loadGuides(): Promise<ContentResult<Guide[]>> {
  if (!supabase) {
    return { data: sampleGuides, source: "sample", error: missingSupabaseMessage() };
  }

  const { data, error } = await supabase
    .from("guides")
    .select(
      "id,course_id,title,slug,description,content,category,difficulty,estimated_read_time,is_premium,is_archived,sort_order,created_by,created_at,updated_at,course:courses(id,title,slug,is_premium)"
    )
    .eq("is_archived", false)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) {
    logContentError("guides", error);
    return { data: sampleGuides, source: "sample", error: contentLoadError("guides", error) };
  }

  return { data: sortGuides(((data ?? []) as unknown as Record<string, unknown>[]).map(normalizeGuide)), source: "supabase", error: null };
}

export async function loadCourses(): Promise<ContentResult<Course[]>> {
  if (!supabase) {
    return { data: sampleCourses, source: "sample", error: missingSupabaseMessage() };
  }

  const { data, error } = await supabase
    .from("courses")
    .select(
      "id,title,slug,description,difficulty,price_cents,is_premium,is_archived,sort_order,created_at,updated_at,guides(id,course_id,title,slug,description,content,category,difficulty,estimated_read_time,is_premium,is_archived,sort_order,created_by,created_at,updated_at),course_modules(id,course_id,title,sort_order,created_at,lessons(id,module_id,title,content,video_url,sort_order,is_preview,is_premium,created_at,updated_at))"
    )
    .eq("is_archived", false)
    .eq("guides.is_archived", false)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) {
    logContentError("courses", error);
    return { data: sampleCourses, source: "sample", error: contentLoadError("courses", error) };
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
      error: missingSupabaseMessage()
    };
  }

  const { data, error } = await supabase
    .from("courses")
    .select(
      "id,title,slug,description,difficulty,price_cents,is_premium,is_archived,sort_order,created_at,updated_at,guides(id,course_id,title,slug,description,content,category,difficulty,estimated_read_time,is_premium,is_archived,sort_order,created_by,created_at,updated_at),course_modules(id,course_id,title,sort_order,created_at,lessons(id,module_id,title,content,video_url,sort_order,is_preview,is_premium,created_at,updated_at))"
    )
    .eq("slug", slug)
    .eq("is_archived", false)
    .eq("guides.is_archived", false)
    .maybeSingle();

  if (error) {
    logContentError("course", error);
    return {
      data: sampleCourses.find((course) => course.slug === slug) ?? null,
      source: "sample",
      error: contentLoadError("course", error)
    };
  }

  return {
    data: data ? normalizeCourse(data as unknown as Record<string, unknown>) : null,
    source: "supabase",
    error: null
  };
}

export async function loadGuideBySlug(slug: string): Promise<ContentResult<Guide | null>> {
  if (!supabase) {
    return {
      data: sampleGuides.find((guide) => guide.slug === slug) ?? null,
      source: "sample",
      error: missingSupabaseMessage()
    };
  }

  const { data, error } = await supabase
    .from("guides")
    .select(
      "id,course_id,title,slug,description,content,category,difficulty,estimated_read_time,is_premium,is_archived,sort_order,created_by,created_at,updated_at,course:courses(id,title,slug,is_premium)"
    )
    .eq("slug", slug)
    .eq("is_archived", false)
    .maybeSingle();

  if (error) {
    logContentError("guide", error);
    return {
      data: sampleGuides.find((guide) => guide.slug === slug) ?? null,
      source: "sample",
      error: contentLoadError("guide", error)
    };
  }

  return {
    data: data ? normalizeGuide(data as unknown as Record<string, unknown>) : null,
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

export async function loadPurchasedGuideIds(userId: string): Promise<Set<string>> {
  if (!supabase) return new Set();

  const { data, error } = await supabase
    .from("purchases")
    .select("guide_id")
    .eq("user_id", userId)
    .in("status", ["paid", "active", "granted"]);

  if (error) return new Set();

  return new Set((data ?? []).map((row) => row.guide_id).filter(Boolean) as string[]);
}
