import { Edit3, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { sanitizePlainText, slugify, validateSlug } from "../lib/validation";
import {
  COURSE_DIFFICULTIES,
  DIFFICULTIES,
  GUIDE_CATEGORIES,
  type Course,
  type CourseDifficulty,
  type Difficulty,
  type Guide,
  type GuideCategory,
  type Lesson,
  type Profile,
  type Purchase
} from "../types/content";

type AdminTab = "guides" | "courses" | "lessons" | "users";

type FlatCourse = Omit<Course, "modules" | "guides">;
type FlatModule = {
  id: string;
  course_id: string;
  title: string;
  sort_order: number;
  created_at: string;
};

const blankGuideForm = {
  course_id: "",
  title: "",
  slug: "",
  description: "",
  content: "",
  category: "Crypto Basics" as GuideCategory,
  difficulty: "Beginner" as Difficulty,
  estimated_read_time: "8",
  is_premium: false,
  is_archived: false,
  sort_order: "1"
};

const blankCourseForm = {
  title: "",
  slug: "",
  description: "",
  difficulty: "Beginner" as CourseDifficulty,
  price_cents: "0",
  is_premium: false,
  is_archived: false,
  sort_order: "1"
};

const blankModuleForm = {
  course_id: "",
  title: "",
  sort_order: "1"
};

const blankLessonForm = {
  module_id: "",
  title: "",
  content: "",
  video_url: "",
  sort_order: "1",
  is_preview: false,
  is_premium: true
};

export function Admin() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>("guides");
  const [guides, setGuides] = useState<Guide[]>([]);
  const [courses, setCourses] = useState<FlatCourse[]>([]);
  const [modules, setModules] = useState<FlatModule[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [message, setMessage] = useState<string | null>(null);

  const [guideForm, setGuideForm] = useState(blankGuideForm);
  const [editingGuideId, setEditingGuideId] = useState<string | null>(null);

  const [courseForm, setCourseForm] = useState(blankCourseForm);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);

  const [moduleForm, setModuleForm] = useState(blankModuleForm);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);

  const [lessonForm, setLessonForm] = useState(blankLessonForm);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);

  const courseNameById = useMemo(
    () => new Map(courses.map((course) => [course.id, course.title])),
    [courses]
  );
  const categoryByCourseId = useMemo(
    () =>
      new Map(
        courses
          .filter((course) => (GUIDE_CATEGORIES as readonly string[]).includes(course.title))
          .map((course) => [course.id, course.title as GuideCategory])
      ),
    [courses]
  );
  const moduleNameById = useMemo(
    () => new Map(modules.map((module) => [module.id, module.title])),
    [modules]
  );

  const refreshAdminData = useCallback(async () => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setMessage(null);

    const [guideResult, courseResult, moduleResult, lessonResult, profileResult, purchaseResult] =
      await Promise.all([
        supabase.from("guides").select("*").order("created_at", { ascending: false }),
        supabase.from("courses").select("*").order("created_at", { ascending: false }),
        supabase.from("course_modules").select("*").order("sort_order", { ascending: true }),
        supabase.from("lessons").select("*").order("sort_order", { ascending: true }),
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("purchases").select("*").order("created_at", { ascending: false })
      ]);

    if (
      guideResult.error ||
      courseResult.error ||
      moduleResult.error ||
      lessonResult.error ||
      profileResult.error ||
      purchaseResult.error
    ) {
      setMessage("Some admin data could not be loaded. Check your admin role and RLS policies.");
    }

    setGuides(
      [...((guideResult.data ?? []) as Guide[])].sort(
        (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.title.localeCompare(b.title)
      )
    );
    setCourses(
      [...((courseResult.data ?? []) as FlatCourse[])].sort(
        (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.title.localeCompare(b.title)
      )
    );
    setModules((moduleResult.data ?? []) as FlatModule[]);
    setLessons((lessonResult.data ?? []) as Lesson[]);
    setProfiles((profileResult.data ?? []) as Profile[]);
    setPurchases((purchaseResult.data ?? []) as Purchase[]);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refreshAdminData();
  }, [refreshAdminData]);

  const saveGuide = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !user) return;

    const slugError = validateSlug(guideForm.slug);
    if (slugError) {
      setMessage(slugError);
      return;
    }

    const payload = {
      course_id: guideForm.course_id || null,
      title: sanitizePlainText(guideForm.title, 160),
      slug: guideForm.slug.trim(),
      description: sanitizePlainText(guideForm.description, 500),
      content: sanitizePlainText(guideForm.content, 12000),
      category: categoryByCourseId.get(guideForm.course_id) ?? guideForm.category,
      difficulty: guideForm.difficulty,
      estimated_read_time: Number(guideForm.estimated_read_time),
      is_premium: guideForm.is_premium,
      is_archived: guideForm.is_archived,
      sort_order: Number(guideForm.sort_order),
      created_by: user.id
    };

    const result = editingGuideId
      ? await supabase.from("guides").update(payload).eq("id", editingGuideId)
      : await supabase.from("guides").insert(payload);

    setMessage(result.error ? "Guide could not be saved." : "Guide saved.");
    if (!result.error) {
      setGuideForm(blankGuideForm);
      setEditingGuideId(null);
      await refreshAdminData();
    }
  };

  const saveCourse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;

    const slugError = validateSlug(courseForm.slug);
    if (slugError) {
      setMessage(slugError);
      return;
    }

    const payload = {
      title: sanitizePlainText(courseForm.title, 160),
      slug: courseForm.slug.trim(),
      description: sanitizePlainText(courseForm.description, 700),
      difficulty: courseForm.difficulty,
      price_cents: Number(courseForm.price_cents),
      is_premium: courseForm.is_premium,
      is_archived: courseForm.is_archived,
      sort_order: Number(courseForm.sort_order)
    };

    const result = editingCourseId
      ? await supabase.from("courses").update(payload).eq("id", editingCourseId)
      : await supabase.from("courses").insert(payload);

    setMessage(result.error ? "Course could not be saved." : "Course saved.");
    if (!result.error) {
      setCourseForm(blankCourseForm);
      setEditingCourseId(null);
      await refreshAdminData();
    }
  };

  const saveModule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;

    const payload = {
      course_id: moduleForm.course_id,
      title: sanitizePlainText(moduleForm.title, 160),
      sort_order: Number(moduleForm.sort_order)
    };

    const result = editingModuleId
      ? await supabase.from("course_modules").update(payload).eq("id", editingModuleId)
      : await supabase.from("course_modules").insert(payload);

    setMessage(result.error ? "Module could not be saved." : "Module saved.");
    if (!result.error) {
      setModuleForm(blankModuleForm);
      setEditingModuleId(null);
      await refreshAdminData();
    }
  };

  const saveLesson = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;

    const payload = {
      module_id: lessonForm.module_id,
      title: sanitizePlainText(lessonForm.title, 180),
      content: sanitizePlainText(lessonForm.content, 14000),
      video_url: sanitizePlainText(lessonForm.video_url, 500) || null,
      sort_order: Number(lessonForm.sort_order),
      is_preview: lessonForm.is_preview,
      is_premium: lessonForm.is_premium
    };

    const result = editingLessonId
      ? await supabase.from("lessons").update(payload).eq("id", editingLessonId)
      : await supabase.from("lessons").insert(payload);

    setMessage(result.error ? "Lesson could not be saved." : "Lesson saved.");
    if (!result.error) {
      setLessonForm(blankLessonForm);
      setEditingLessonId(null);
      await refreshAdminData();
    }
  };

  const deleteRow = async (table: "guides" | "courses" | "course_modules" | "lessons", id: string) => {
    if (!supabase) return;
    if (!window.confirm("Delete this item?")) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    setMessage(error ? "Delete failed." : "Item deleted.");
    if (!error) await refreshAdminData();
  };

  const grantPremium = async (profileId: string) => {
    if (!supabase) return;
    const targetProfile = profiles.find((profile) => profile.id === profileId);
    const premiumUntil = new Date();
    premiumUntil.setFullYear(premiumUntil.getFullYear() + 1);
    const { error } = await supabase
      .from("profiles")
      .update({ role: targetProfile?.role === "admin" ? "admin" : "premium", premium_until: premiumUntil.toISOString() })
      .eq("id", profileId);
    setMessage(error ? "Premium access could not be granted." : "Premium access granted for one year.");
    if (!error) await refreshAdminData();
  };

  const revokePremium = async (profileId: string) => {
    if (!supabase) return;
    const targetProfile = profiles.find((profile) => profile.id === profileId);
    const { error } = await supabase
      .from("profiles")
      .update({ role: targetProfile?.role === "admin" ? "admin" : "user", premium_until: null })
      .eq("id", profileId);
    setMessage(error ? "Premium access could not be revoked." : "Premium access revoked.");
    if (!error) await refreshAdminData();
  };

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Admin Panel</p>
          <h1>Content and access management</h1>
          <p className="muted">
            Admin-only route backed by Supabase Row Level Security for content, users, purchases, and premium grants.
          </p>
        </div>
        <button className="ghost-button" type="button" onClick={() => void refreshAdminData()}>
          <RefreshCw size={17} />
          Refresh
        </button>
      </section>

      {!supabase && (
        <div className="warning-box">Supabase is not connected. Add environment variables before using admin features.</div>
      )}

      {message && <p className="soft-notice">{message}</p>}

      <section className="tab-bar" aria-label="Admin sections">
        {(["guides", "courses", "lessons", "users"] as AdminTab[]).map((tab) => (
          <button
            className={activeTab === tab ? "filter-pill active" : "filter-pill"}
            type="button"
            onClick={() => setActiveTab(tab)}
            key={tab}
          >
            {tab}
          </button>
        ))}
      </section>

      {isLoading ? (
        <LoadingState label="Loading admin data" />
      ) : (
        <>
          {activeTab === "guides" && (
            <section className="admin-grid">
              <form className="section-panel stack-form" onSubmit={saveGuide}>
                <h2>{editingGuideId ? "Edit guide" : "Create guide"}</h2>
                <label>
                  Title
                  <input
                    value={guideForm.title}
                    onChange={(event) => {
                      const title = event.target.value;
                      setGuideForm((form) => ({ ...form, title, slug: form.slug || slugify(title) }));
                    }}
                    required
                  />
                </label>
                <label>
                  Slug
                  <input
                    value={guideForm.slug}
                    onChange={(event) => setGuideForm((form) => ({ ...form, slug: event.target.value }))}
                    required
                  />
                </label>
                <div className="form-row">
                  <label>
                    Course
                    <select
                      value={guideForm.course_id}
                      onChange={(event) => {
                        const courseId = event.target.value;
                        setGuideForm((form) => ({
                          ...form,
                          course_id: courseId,
                          category: categoryByCourseId.get(courseId) ?? form.category
                        }));
                      }}
                    >
                      <option value="">No course</option>
                      {courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Sort order
                    <input
                      type="number"
                      min={1}
                      value={guideForm.sort_order}
                      onChange={(event) => setGuideForm((form) => ({ ...form, sort_order: event.target.value }))}
                    />
                  </label>
                </div>
                <label>
                  Description
                  <textarea
                    value={guideForm.description}
                    onChange={(event) => setGuideForm((form) => ({ ...form, description: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Content
                  <textarea
                    value={guideForm.content}
                    onChange={(event) => setGuideForm((form) => ({ ...form, content: event.target.value }))}
                    rows={7}
                    required
                  />
                </label>
                <div className="form-row">
                  <label>
                    Category
                    <select
                      value={guideForm.category}
                      onChange={(event) =>
                        setGuideForm((form) => ({ ...form, category: event.target.value as GuideCategory }))
                      }
                    >
                      {GUIDE_CATEGORIES.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Difficulty
                    <select
                      value={guideForm.difficulty}
                      onChange={(event) =>
                        setGuideForm((form) => ({ ...form, difficulty: event.target.value as Difficulty }))
                      }
                    >
                      {DIFFICULTIES.map((difficulty) => (
                        <option key={difficulty}>{difficulty}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Read time
                    <input
                      type="number"
                      min={1}
                      value={guideForm.estimated_read_time}
                      onChange={(event) =>
                        setGuideForm((form) => ({ ...form, estimated_read_time: event.target.value }))
                      }
                    />
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={guideForm.is_premium}
                      onChange={(event) => setGuideForm((form) => ({ ...form, is_premium: event.target.checked }))}
                    />
                    Premium
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={guideForm.is_archived}
                      onChange={(event) => setGuideForm((form) => ({ ...form, is_archived: event.target.checked }))}
                    />
                    Archived
                  </label>
                </div>
                <button className="primary-button full-width" type="submit">
                  <Plus size={17} />
                  Save Guide
                </button>
              </form>

              <AdminList title="Guides">
                {guides.map((guide) => (
                  <li key={guide.id}>
                    <div>
                      <strong>{guide.title}</strong>
                      <span>
                        #{guide.sort_order ?? "-"} - {courseNameById.get(guide.course_id ?? "") ?? guide.category} -{" "}
                        {guide.is_archived ? "Archived" : guide.is_premium ? "Premium" : "Free"}
                      </span>
                    </div>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => {
                          setEditingGuideId(guide.id);
                          setGuideForm({
                            course_id: guide.course_id ?? "",
                            title: guide.title,
                            slug: guide.slug,
                            description: guide.description,
                            content: guide.content,
                            category: guide.category,
                            difficulty: guide.difficulty,
                            estimated_read_time: String(guide.estimated_read_time),
                            is_premium: guide.is_premium,
                            is_archived: Boolean(guide.is_archived),
                            sort_order: String(guide.sort_order ?? 1)
                          });
                        }}
                      >
                        <Edit3 size={16} />
                        <span className="sr-only">Edit guide</span>
                      </button>
                      <button className="icon-button danger" type="button" onClick={() => void deleteRow("guides", guide.id)}>
                        <Trash2 size={16} />
                        <span className="sr-only">Delete guide</span>
                      </button>
                    </div>
                  </li>
                ))}
              </AdminList>
            </section>
          )}

          {activeTab === "courses" && (
            <section className="admin-grid">
              <form className="section-panel stack-form" onSubmit={saveCourse}>
                <h2>{editingCourseId ? "Edit course" : "Create course"}</h2>
                <label>
                  Title
                  <input
                    value={courseForm.title}
                    onChange={(event) => {
                      const title = event.target.value;
                      setCourseForm((form) => ({ ...form, title, slug: form.slug || slugify(title) }));
                    }}
                    required
                  />
                </label>
                <label>
                  Slug
                  <input
                    value={courseForm.slug}
                    onChange={(event) => setCourseForm((form) => ({ ...form, slug: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Description
                  <textarea
                    value={courseForm.description}
                    onChange={(event) => setCourseForm((form) => ({ ...form, description: event.target.value }))}
                    rows={5}
                    required
                  />
                </label>
                <label>
                  Sort order
                  <input
                    type="number"
                    min={1}
                    value={courseForm.sort_order}
                    onChange={(event) => setCourseForm((form) => ({ ...form, sort_order: event.target.value }))}
                  />
                </label>
                <div className="form-row">
                  <label>
                    Difficulty
                    <select
                      value={courseForm.difficulty}
                      onChange={(event) =>
                        setCourseForm((form) => ({ ...form, difficulty: event.target.value as CourseDifficulty }))
                      }
                    >
                      {COURSE_DIFFICULTIES.map((difficulty) => (
                        <option key={difficulty}>{difficulty}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Price cents
                    <input
                      type="number"
                      min={0}
                      value={courseForm.price_cents}
                      onChange={(event) => setCourseForm((form) => ({ ...form, price_cents: event.target.value }))}
                    />
                  </label>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={courseForm.is_premium}
                    onChange={(event) => setCourseForm((form) => ({ ...form, is_premium: event.target.checked }))}
                  />
                  Premium course
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={courseForm.is_archived}
                    onChange={(event) => setCourseForm((form) => ({ ...form, is_archived: event.target.checked }))}
                  />
                  Archived
                </label>
                <button className="primary-button full-width" type="submit">
                  <Plus size={17} />
                  Save Course
                </button>
              </form>

              <AdminList title="Courses">
                {courses.map((course) => (
                  <li key={course.id}>
                    <div>
                      <strong>{course.title}</strong>
                      <span>
                        #{course.sort_order ?? "-"} - {course.difficulty} -{" "}
                        {course.is_archived ? "Archived" : course.is_premium ? "Premium" : "Free"}
                      </span>
                    </div>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => {
                          setEditingCourseId(course.id);
                          setCourseForm({
                            title: course.title,
                            slug: course.slug,
                            description: course.description,
                            difficulty: course.difficulty,
                            price_cents: String(course.price_cents),
                            is_premium: course.is_premium,
                            is_archived: Boolean(course.is_archived),
                            sort_order: String(course.sort_order ?? 1)
                          });
                        }}
                      >
                        <Edit3 size={16} />
                        <span className="sr-only">Edit course</span>
                      </button>
                      <button className="icon-button danger" type="button" onClick={() => void deleteRow("courses", course.id)}>
                        <Trash2 size={16} />
                        <span className="sr-only">Delete course</span>
                      </button>
                    </div>
                  </li>
                ))}
              </AdminList>
            </section>
          )}

          {activeTab === "lessons" && (
            <section className="admin-grid">
              <div className="admin-form-stack">
                <form className="section-panel stack-form" onSubmit={saveModule}>
                  <h2>{editingModuleId ? "Edit module" : "Create module"}</h2>
                  <label>
                    Course
                    <select
                      value={moduleForm.course_id}
                      onChange={(event) => setModuleForm((form) => ({ ...form, course_id: event.target.value }))}
                      required
                    >
                      <option value="">Select course</option>
                      {courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Title
                    <input
                      value={moduleForm.title}
                      onChange={(event) => setModuleForm((form) => ({ ...form, title: event.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    Sort order
                    <input
                      type="number"
                      value={moduleForm.sort_order}
                      onChange={(event) => setModuleForm((form) => ({ ...form, sort_order: event.target.value }))}
                    />
                  </label>
                  <button className="primary-button full-width" type="submit">
                    <Plus size={17} />
                    Save Module
                  </button>
                </form>

                <form className="section-panel stack-form" onSubmit={saveLesson}>
                  <h2>{editingLessonId ? "Edit lesson" : "Create lesson"}</h2>
                  <label>
                    Module
                    <select
                      value={lessonForm.module_id}
                      onChange={(event) => setLessonForm((form) => ({ ...form, module_id: event.target.value }))}
                      required
                    >
                      <option value="">Select module</option>
                      {modules.map((module) => (
                        <option key={module.id} value={module.id}>
                          {courseNameById.get(module.course_id)} / {module.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Title
                    <input
                      value={lessonForm.title}
                      onChange={(event) => setLessonForm((form) => ({ ...form, title: event.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    Content
                    <textarea
                      value={lessonForm.content}
                      onChange={(event) => setLessonForm((form) => ({ ...form, content: event.target.value }))}
                      rows={6}
                      required
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      Video URL
                      <input
                        value={lessonForm.video_url}
                        onChange={(event) => setLessonForm((form) => ({ ...form, video_url: event.target.value }))}
                      />
                    </label>
                    <label>
                      Sort order
                      <input
                        type="number"
                        value={lessonForm.sort_order}
                        onChange={(event) => setLessonForm((form) => ({ ...form, sort_order: event.target.value }))}
                      />
                    </label>
                  </div>
                  <div className="form-row">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={lessonForm.is_preview}
                        onChange={(event) => setLessonForm((form) => ({ ...form, is_preview: event.target.checked }))}
                      />
                      Free preview
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={lessonForm.is_premium}
                        onChange={(event) => setLessonForm((form) => ({ ...form, is_premium: event.target.checked }))}
                      />
                      Premium lesson
                    </label>
                  </div>
                  <button className="primary-button full-width" type="submit">
                    <Plus size={17} />
                    Save Lesson
                  </button>
                </form>
              </div>

              <div className="admin-form-stack">
                <AdminList title="Modules">
                  {modules.map((module) => (
                    <li key={module.id}>
                      <div>
                        <strong>{module.title}</strong>
                        <span>{courseNameById.get(module.course_id) ?? module.course_id}</span>
                      </div>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => {
                            setEditingModuleId(module.id);
                            setModuleForm({
                              course_id: module.course_id,
                              title: module.title,
                              sort_order: String(module.sort_order)
                            });
                          }}
                        >
                          <Edit3 size={16} />
                          <span className="sr-only">Edit module</span>
                        </button>
                        <button
                          className="icon-button danger"
                          type="button"
                          onClick={() => void deleteRow("course_modules", module.id)}
                        >
                          <Trash2 size={16} />
                          <span className="sr-only">Delete module</span>
                        </button>
                      </div>
                    </li>
                  ))}
                </AdminList>

                <AdminList title="Lessons">
                  {lessons.map((lesson) => (
                    <li key={lesson.id}>
                      <div>
                        <strong>{lesson.title}</strong>
                        <span>{moduleNameById.get(lesson.module_id) ?? lesson.module_id}</span>
                      </div>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => {
                            setEditingLessonId(lesson.id);
                            setLessonForm({
                              module_id: lesson.module_id,
                              title: lesson.title,
                              content: lesson.content,
                              video_url: lesson.video_url ?? "",
                              sort_order: String(lesson.sort_order),
                              is_preview: lesson.is_preview,
                              is_premium: lesson.is_premium
                            });
                          }}
                        >
                          <Edit3 size={16} />
                          <span className="sr-only">Edit lesson</span>
                        </button>
                        <button className="icon-button danger" type="button" onClick={() => void deleteRow("lessons", lesson.id)}>
                          <Trash2 size={16} />
                          <span className="sr-only">Delete lesson</span>
                        </button>
                      </div>
                    </li>
                  ))}
                </AdminList>
              </div>
            </section>
          )}

          {activeTab === "users" && (
            <section className="admin-grid">
              <AdminList title="Registered Users">
                {profiles.map((profile) => (
                  <li key={profile.id}>
                    <div>
                      <strong>{profile.full_name ?? profile.username ?? profile.id}</strong>
                      <span>
                        {profile.role} - {profile.premium_until ? new Date(profile.premium_until).toLocaleDateString() : "no premium date"}
                      </span>
                    </div>
                    <div className="row-actions text-actions">
                      <button className="ghost-button compact" type="button" onClick={() => void grantPremium(profile.id)}>
                        Grant
                      </button>
                      <button className="ghost-button compact danger-text" type="button" onClick={() => void revokePremium(profile.id)}>
                        Revoke
                      </button>
                    </div>
                  </li>
                ))}
              </AdminList>

              <AdminList title="Purchases and Access">
                {purchases.map((purchase) => (
                  <li key={purchase.id}>
                    <div>
                      <strong>{purchase.status}</strong>
                      <span>
                        User {purchase.user_id.slice(0, 8)} - {purchase.course_id ?? purchase.guide_id ?? "premium"}
                      </span>
                    </div>
                    <ShieldCheck size={18} />
                  </li>
                ))}
              </AdminList>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function AdminList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="section-panel">
      <h2>{title}</h2>
      <ul className="admin-list">{children}</ul>
    </article>
  );
}
