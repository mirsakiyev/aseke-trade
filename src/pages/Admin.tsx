import {
  Bell,
  CalendarClock,
  Crown,
  Edit3,
  Headphones,
  LineChart,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  WalletCards
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { inboxAudienceLabels, inboxTypeLabels, sendAdminNotification } from "../lib/notificationsApi";
import { supabase } from "../lib/supabase";
import { fetchAdminSupportRequests, SUPPORT_STATUSES, updateSupportRequestStatus } from "../lib/supportApi";
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
  type InboxMessageType,
  type InboxTargetAudience,
  type PremiumSubscription,
  type Profile,
  type Purchase,
  type SupportRequest,
  type SupportRequestStatus
} from "../types/content";

type AdminTab = "guides" | "courses" | "inbox" | "support" | "users";

type FlatCourse = Omit<Course, "modules" | "guides">;

const blankGuideForm = {
  course_id: "",
  title: "",
  slug: "",
  description: "",
  content: "",
  category: "Crypto Basics" as GuideCategory,
  difficulty: "Beginner" as Difficulty,
  estimated_read_time: "8",
  xp_reward: "75",
  price_cents: "0",
  is_premium: false,
  is_archived: false,
  sort_order: "1"
};

const blankCourseForm = {
  title: "",
  slug: "",
  description: "",
  difficulty: "Beginner" as CourseDifficulty,
  is_premium: false,
  is_archived: false,
  sort_order: "1",
  guide_ids: [] as string[]
};

const blankSubscriptionForm = {
  user_id: "",
  starts_at: toDateTimeLocalValue(new Date()),
  expires_at: "",
  duration_count: "30",
  duration_unit: "days",
  admin_note: ""
};

const blankNotificationForm = {
  type: "market_outlook" as InboxMessageType,
  targetAudience: "premium" as InboxTargetAudience,
  userId: "",
  title: "",
  summary: "",
  message: ""
};
const manualNotificationTypes: InboxMessageType[] = [
  "market_outlook",
  "account_update",
  "security_update",
  "community_message"
];

export function Admin() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>("guides");
  const [guides, setGuides] = useState<Guide[]>([]);
  const [courses, setCourses] = useState<FlatCourse[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [premiumSubscriptions, setPremiumSubscriptions] = useState<PremiumSubscription[]>([]);
  const [supportRequests, setSupportRequests] = useState<SupportRequest[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [message, setMessage] = useState<string | null>(null);

  const [guideForm, setGuideForm] = useState(blankGuideForm);
  const [editingGuideId, setEditingGuideId] = useState<string | null>(null);

  const [courseForm, setCourseForm] = useState(blankCourseForm);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);

  const [subscriptionForm, setSubscriptionForm] = useState(blankSubscriptionForm);
  const [editingSubscriptionId, setEditingSubscriptionId] = useState<string | null>(null);
  const [notificationForm, setNotificationForm] = useState(blankNotificationForm);

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
  const profileNameById = useMemo(
    () =>
      new Map(
        profiles.map((profile) => [
          profile.id,
          profile.full_name ?? profile.username ?? profile.id.slice(0, 8)
        ])
      ),
    [profiles]
  );

  const refreshAdminData = useCallback(async () => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setMessage(null);

    const [guideResult, courseResult, profileResult, purchaseResult, subscriptionResult, supportResult] =
      await Promise.all([
        supabase.from("guides").select("*").order("created_at", { ascending: false }),
        supabase.from("courses").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("purchases").select("*").order("created_at", { ascending: false }),
        supabase.from("premium_subscriptions").select("*").order("created_at", { ascending: false }),
        fetchAdminSupportRequests()
          .then((data) => ({ data, error: null }))
          .catch((error) => ({ data: [] as SupportRequest[], error }))
      ]);

    if (
      guideResult.error ||
      courseResult.error ||
      profileResult.error ||
      purchaseResult.error ||
      subscriptionResult.error ||
      supportResult.error
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
    setProfiles((profileResult.data ?? []) as Profile[]);
    setPurchases((purchaseResult.data ?? []) as Purchase[]);
    setPremiumSubscriptions((subscriptionResult.data ?? []) as PremiumSubscription[]);
    setSupportRequests(supportResult.data);
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

    const xpReward = Number(guideForm.xp_reward);
    if (!Number.isFinite(xpReward) || xpReward < 50 || xpReward > 100) {
      setMessage("Guide XP reward must be between 50 and 100.");
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
      xp_reward: xpReward,
      price_cents: Number(guideForm.price_cents),
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
      price_cents: 0,
      is_premium: courseForm.is_premium,
      is_archived: courseForm.is_archived,
      sort_order: Number(courseForm.sort_order)
    };

    const result = editingCourseId
      ? await supabase.from("courses").update(payload).eq("id", editingCourseId).select("id").single()
      : await supabase.from("courses").insert(payload).select("id").single();

    const savedCourseId = result.data?.id ?? editingCourseId;
    if (result.error || !savedCourseId) {
      setMessage("Course could not be saved.");
      return;
    }

    const selectedGuideIds = [...new Set(courseForm.guide_ids)];
    const assignedGuideIds = guides
      .filter((guide) => guide.course_id === savedCourseId)
      .map((guide) => guide.id);
    const removedGuideIds = assignedGuideIds.filter((guideId) => !selectedGuideIds.includes(guideId));

    const assignResult =
      selectedGuideIds.length > 0
        ? await supabase.from("guides").update({ course_id: savedCourseId }).in("id", selectedGuideIds)
        : { error: null };
    const removeResult =
      removedGuideIds.length > 0
        ? await supabase.from("guides").update({ course_id: null }).in("id", removedGuideIds)
        : { error: null };

    setMessage(assignResult.error || removeResult.error ? "Course saved, but guide assignments could not be updated." : "Course saved.");
    if (!result.error) {
      setCourseForm(blankCourseForm);
      setEditingCourseId(null);
      await refreshAdminData();
    }
  };

  const saveSubscription = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;

    const startsAt = dateTimeLocalToIso(subscriptionForm.starts_at) ?? new Date().toISOString();
    const expiresAt = dateTimeLocalToIso(subscriptionForm.expires_at);
    const durationCount = Number(subscriptionForm.duration_count);

    if (!editingSubscriptionId && !subscriptionForm.user_id) {
      setMessage("Choose a user for the Trading Academy subscription.");
      return;
    }

    if (editingSubscriptionId && !expiresAt) {
      setMessage("Choose an end date when updating a subscription.");
      return;
    }

    if (expiresAt && new Date(expiresAt).getTime() <= new Date(startsAt).getTime()) {
      setMessage("End date must be after start date.");
      return;
    }

    if (!editingSubscriptionId && !expiresAt && (!Number.isFinite(durationCount) || durationCount <= 0)) {
      setMessage("Provide an end date or a positive duration.");
      return;
    }

    const result = editingSubscriptionId
      ? await supabase.rpc("admin_update_trading_academy_subscription", {
          target_subscription_id: editingSubscriptionId,
          target_starts_at: startsAt,
          target_expires_at: expiresAt,
          admin_note: sanitizePlainText(subscriptionForm.admin_note, 500) || null
        })
      : await supabase.rpc("admin_issue_trading_academy_subscription", {
          target_user_id: subscriptionForm.user_id,
          target_starts_at: startsAt,
          target_expires_at: expiresAt,
          duration_count: expiresAt ? null : durationCount,
          duration_unit: subscriptionForm.duration_unit,
          admin_note: sanitizePlainText(subscriptionForm.admin_note, 500) || null
        });

    setMessage(result.error ? "Trading Academy subscription could not be saved." : "Trading Academy subscription saved.");
    if (!result.error) {
      setSubscriptionForm(blankSubscriptionForm);
      setEditingSubscriptionId(null);
      await refreshAdminData();
    }
  };

  const saveNotification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;

    try {
      await sendAdminNotification({
        type: notificationForm.type,
        targetAudience: notificationForm.targetAudience,
        userId: notificationForm.targetAudience === "specific_user" ? notificationForm.userId : undefined,
        title: notificationForm.title,
        summary: notificationForm.summary,
        message: notificationForm.message,
        sentByAdminId: user.id
      });
      setNotificationForm({
        ...blankNotificationForm,
        type: notificationForm.type,
        targetAudience: defaultAudienceForNotificationType(notificationForm.type)
      });
      setMessage("Notification sent.");
    } catch (notificationError) {
      setMessage(notificationError instanceof Error ? notificationError.message : "Notification could not be sent.");
    }
  };

  const deleteRow = async (table: "guides" | "courses", id: string) => {
    if (!supabase) return;
    if (!window.confirm("Delete this item?")) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    setMessage(error ? "Delete failed." : "Item deleted.");
    if (!error) await refreshAdminData();
  };

  const grantPremium = async (profileId: string) => {
    if (!supabase) return;
    const { error } = await supabase.rpc("admin_issue_trading_academy_subscription", {
      target_user_id: profileId,
      target_starts_at: new Date().toISOString(),
      target_expires_at: null,
      duration_count: 12,
      duration_unit: "months",
      admin_note: "Quick grant from admin users list"
    });
    setMessage(error ? "Trading Academy access could not be granted." : "Trading Academy access granted for one year.");
    if (!error) await refreshAdminData();
  };

  const revokePremium = async (profileId: string) => {
    if (!supabase) return;
    const targetProfile = profiles.find((profile) => profile.id === profileId);
    const subscriptionResult = await supabase
      .from("premium_subscriptions")
      .update({ status: "cancelled" })
      .eq("user_id", profileId)
      .in("status", ["pending", "active"]);
    const profileResult = await supabase
      .from("profiles")
      .update({
        role: targetProfile?.role === "admin" ? "admin" : "user",
        premium_starts_at: null,
        premium_until: null
      })
      .eq("id", profileId);
    const error = subscriptionResult.error ?? profileResult.error;
    setMessage(error ? "Trading Academy access could not be revoked." : "Trading Academy access revoked.");
    if (!error) await refreshAdminData();
  };

  return (
    <main className="page page-stack">
      <section className="page-title-row compact-title-row">
        <div>
          <p className="eyebrow">Admin Panel</p>
          <h1>Content management</h1>
          <p className="muted">
            Admin-only route backed by Supabase Row Level Security for content, users, purchases, and Trading Academy grants.
          </p>
        </div>
        <div className="inline-actions">
          <Link className="ghost-button" to="/admin/trading-academy">
            <Crown size={17} />
            Academy Tools
          </Link>
          <Link className="ghost-button" to="/admin/crypto-payments">
            <WalletCards size={17} />
            Crypto Payments
          </Link>
          <button className="ghost-button" type="button" onClick={() => void refreshAdminData()}>
            <RefreshCw size={17} />
            Refresh
          </button>
        </div>
      </section>

      {!supabase && (
        <div className="warning-box">Supabase is not connected. Add environment variables before using admin features.</div>
      )}

      {message && <p className="soft-notice">{message}</p>}

      <section className="tab-bar" aria-label="Admin sections">
        {(["guides", "courses", "inbox", "support", "users"] as AdminTab[]).map((tab) => (
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
            <section className="admin-grid admin-guides-grid">
              <form className="section-panel stack-form compact-admin-form" onSubmit={saveGuide}>
                <h2>{editingGuideId ? "Edit guide" : "Create guide"}</h2>
                <div className="form-row">
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
                </div>
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
                    rows={2}
                    required
                  />
                </label>
                <label>
                  Content
                  <textarea
                    className="guide-content-input"
                    value={guideForm.content}
                    onChange={(event) => setGuideForm((form) => ({ ...form, content: event.target.value }))}
                    rows={4}
                    required
                  />
                </label>
                <div className="form-row admin-compact-grid">
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
                <div className="form-row admin-compact-grid">
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
                  <label>
                    XP reward
                    <input
                      type="number"
                      min={50}
                      max={100}
                      value={guideForm.xp_reward}
                      onChange={(event) => setGuideForm((form) => ({ ...form, xp_reward: event.target.value }))}
                    />
                  </label>
                  <label>
                    Price cents
                    <input
                      type="number"
                      min={0}
                      value={guideForm.price_cents}
                      onChange={(event) => setGuideForm((form) => ({ ...form, price_cents: event.target.value }))}
                    />
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={guideForm.is_premium}
                      onChange={(event) => setGuideForm((form) => ({ ...form, is_premium: event.target.checked }))}
                    />
                    Requires Trading Academy
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
                        {guide.is_archived ? "Archived" : guide.is_premium ? "Trading Academy" : "Free"} -{" "}
                        {guide.xp_reward} XP - {guide.price_cents} cents
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
                            xp_reward: String(guide.xp_reward ?? 75),
                            price_cents: String(guide.price_cents ?? 0),
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
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={courseForm.is_premium}
                    onChange={(event) => setCourseForm((form) => ({ ...form, is_premium: event.target.checked }))}
                  />
                  Trading Academy course
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={courseForm.is_archived}
                    onChange={(event) => setCourseForm((form) => ({ ...form, is_archived: event.target.checked }))}
                  />
                  Archived
                </label>
                <fieldset className="admin-guide-picker">
                  <legend>Included guides</legend>
                  {guides.length > 0 ? (
                    <div className="admin-guide-picker-list">
                      {guides.map((guide) => {
                        const isChecked = courseForm.guide_ids.includes(guide.id);
                        return (
                          <label className="checkbox-label" key={guide.id}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(event) =>
                                setCourseForm((form) => ({
                                  ...form,
                                  guide_ids: event.target.checked
                                    ? [...form.guide_ids, guide.id]
                                    : form.guide_ids.filter((guideId) => guideId !== guide.id)
                                }))
                              }
                            />
                            <span>
                              {guide.title}
                              <small>{guide.is_archived ? "Archived" : guide.is_premium ? "Trading Academy" : "Free"}</small>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="muted">Create guides first, then attach them to a course.</p>
                  )}
                </fieldset>
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
                        {course.is_archived ? "Archived" : course.is_premium ? "Trading Academy" : "Free"}
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
                            is_premium: course.is_premium,
                            is_archived: Boolean(course.is_archived),
                            sort_order: String(course.sort_order ?? 1),
                            guide_ids: guides
                              .filter((guide) => guide.course_id === course.id)
                              .map((guide) => guide.id)
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

          {activeTab === "inbox" && (
            <section className="admin-grid notification-admin-grid">
              <form className="section-panel stack-form" onSubmit={saveNotification}>
                <div className="compact-tool-heading">
                  <span className="feature-icon">
                    <Bell size={20} />
                  </span>
                  <div>
                    <h2>Send notification</h2>
                    <p className="muted">Market outlook alerts are premium-only. Trading signal alerts are automatic.</p>
                  </div>
                </div>

                <div className="form-row">
                  <label>
                    Type
                    <select
                      value={notificationForm.type}
                      onChange={(event) => {
                        const type = event.target.value as InboxMessageType;
                        setNotificationForm((form) => ({
                          ...form,
                          type,
                          targetAudience: defaultAudienceForNotificationType(type),
                          userId: ""
                        }));
                      }}
                    >
                      {manualNotificationTypes.map((type) => (
                        <option value={type} key={type}>
                          {inboxTypeLabels[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Audience
                    <select
                      value={notificationForm.targetAudience}
                      onChange={(event) => {
                        const targetAudience = event.target.value as InboxTargetAudience;
                        setNotificationForm((form) => ({
                          ...form,
                          targetAudience,
                          userId: targetAudience === "specific_user" ? form.userId : ""
                        }));
                      }}
                    >
                      {notificationAudienceOptions(notificationForm.type).map((audience) => (
                        <option value={audience} key={audience}>
                          {inboxAudienceLabels[audience]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {notificationForm.targetAudience === "specific_user" && (
                  <label>
                    User
                    <select
                      value={notificationForm.userId}
                      onChange={(event) => setNotificationForm((form) => ({ ...form, userId: event.target.value }))}
                      required
                    >
                      <option value="">Select user</option>
                      {profiles.map((profile) => (
                        <option value={profile.id} key={profile.id}>
                          {profile.full_name ?? profile.username ?? profile.id}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label>
                  Title
                  <input
                    value={notificationForm.title}
                    onChange={(event) => setNotificationForm((form) => ({ ...form, title: event.target.value }))}
                    maxLength={180}
                    required
                  />
                </label>
                <label>
                  Summary
                  <input
                    value={notificationForm.summary}
                    onChange={(event) => setNotificationForm((form) => ({ ...form, summary: event.target.value }))}
                    maxLength={260}
                  />
                </label>
                <label>
                  Message
                  <textarea
                    value={notificationForm.message}
                    onChange={(event) => setNotificationForm((form) => ({ ...form, message: event.target.value }))}
                    maxLength={2400}
                    rows={6}
                    required
                  />
                </label>
                <button className="primary-button full-width" type="submit">
                  <Send size={17} />
                  Send Notification
                </button>
              </form>

              <AdminList title="Delivery Rules">
                <li>
                  <div>
                    <strong>Market Outlook</strong>
                    <span>Sent to premium users only.</span>
                  </div>
                  <Crown size={18} />
                </li>
                <li>
                  <div>
                    <strong>Trading Signal</strong>
                    <span>Sent automatically to premium users when a signal is created or updated.</span>
                  </div>
                  <LineChart size={18} />
                </li>
                <li>
                  <div>
                    <strong>Community</strong>
                    <span>Sent to all logged-in users.</span>
                  </div>
                  <Bell size={18} />
                </li>
                <li>
                  <div>
                    <strong>Account and Security</strong>
                    <span>Available for all, basic, or a specific user.</span>
                  </div>
                  <ShieldCheck size={18} />
                </li>
              </AdminList>
            </section>
          )}

          {activeTab === "support" && (
            <section className="admin-grid">
              <AdminList title="Support Requests">
                {supportRequests.length ? (
                  supportRequests.map((request) => (
                    <SupportRequestAdminRow request={request} onUpdated={refreshAdminData} key={request.id} />
                  ))
                ) : (
                  <li>
                    <div>
                      <strong>No support requests</strong>
                      <span>General support form submissions will appear here.</span>
                    </div>
                    <Headphones size={18} />
                  </li>
                )}
              </AdminList>
            </section>
          )}

          {activeTab === "users" && (
            <section className="admin-grid">
              <form className="section-panel stack-form" onSubmit={saveSubscription}>
                <h2>{editingSubscriptionId ? "Edit Trading Academy access" : "Issue Trading Academy access"}</h2>
                {!editingSubscriptionId && (
                  <label>
                    User
                    <select
                      value={subscriptionForm.user_id}
                      onChange={(event) =>
                        setSubscriptionForm((form) => ({ ...form, user_id: event.target.value }))
                      }
                      required
                    >
                      <option value="">Select user</option>
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.full_name ?? profile.username ?? profile.id}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="form-row">
                  <label>
                    Start date
                    <input
                      type="datetime-local"
                      value={subscriptionForm.starts_at}
                      onChange={(event) =>
                        setSubscriptionForm((form) => ({ ...form, starts_at: event.target.value }))
                      }
                      required
                    />
                  </label>
                  <label>
                    End date
                    <input
                      type="datetime-local"
                      value={subscriptionForm.expires_at}
                      onChange={(event) =>
                        setSubscriptionForm((form) => ({ ...form, expires_at: event.target.value }))
                      }
                      required={Boolean(editingSubscriptionId)}
                    />
                  </label>
                </div>
                {!editingSubscriptionId && (
                  <div className="form-row">
                    <label>
                      Duration
                      <input
                        type="number"
                        min={1}
                        value={subscriptionForm.duration_count}
                        onChange={(event) =>
                          setSubscriptionForm((form) => ({ ...form, duration_count: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Unit
                      <select
                        value={subscriptionForm.duration_unit}
                        onChange={(event) =>
                          setSubscriptionForm((form) => ({ ...form, duration_unit: event.target.value }))
                        }
                      >
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                        <option value="months">Months</option>
                      </select>
                    </label>
                  </div>
                )}
                <label>
                  Admin note
                  <textarea
                    value={subscriptionForm.admin_note}
                    onChange={(event) =>
                      setSubscriptionForm((form) => ({ ...form, admin_note: event.target.value }))
                    }
                    rows={3}
                  />
                </label>
                <div className="inline-actions">
                  <button className="primary-button" type="submit">
                    <CalendarClock size={17} />
                    Save Access
                  </button>
                  {editingSubscriptionId && (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        setEditingSubscriptionId(null);
                        setSubscriptionForm(blankSubscriptionForm);
                      }}
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>

              <AdminList title="Trading Academy Subscriptions">
                {premiumSubscriptions.map((subscription) => (
                  <li key={subscription.id}>
                    <div>
                      <strong>{profileNameById.get(subscription.user_id) ?? subscription.user_id}</strong>
                      <span>
                        {subscription.status} - {formatAdminDate(subscription.starts_at)} to{" "}
                        {formatAdminDate(subscription.expires_at)}
                      </span>
                    </div>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => {
                          setEditingSubscriptionId(subscription.id);
                          setSubscriptionForm({
                            user_id: subscription.user_id,
                            starts_at: toDateTimeLocalValue(new Date(subscription.starts_at)),
                            expires_at: toDateTimeLocalValue(new Date(subscription.expires_at)),
                            duration_count: String(subscription.plan_duration_months),
                            duration_unit: "months",
                            admin_note: subscription.admin_note ?? ""
                          });
                        }}
                      >
                        <Edit3 size={16} />
                        <span className="sr-only">Edit subscription</span>
                      </button>
                    </div>
                  </li>
                ))}
              </AdminList>

              <AdminList title="Registered Users">
                {profiles.map((profile) => (
                  <li key={profile.id}>
                    <div>
                      <strong>{profile.full_name ?? profile.username ?? profile.id}</strong>
                      <span>
                        {profile.role === "premium" ? "Trading Academy" : profile.role} - {profile.premium_until ? new Date(profile.premium_until).toLocaleDateString() : "no Trading Academy date"}
                      </span>
                    </div>
                    <div className="row-actions text-actions">
                      <button className="ghost-button compact" type="button" onClick={() => void grantPremium(profile.id)}>
                        Grant Academy
                      </button>
                      <button className="ghost-button compact danger-text" type="button" onClick={() => void revokePremium(profile.id)}>
                        Revoke Academy
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
                        User {purchase.user_id.slice(0, 8)} - {purchase.course_id ?? purchase.guide_id ?? "Trading Academy"}
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

function SupportRequestAdminRow({
  request,
  onUpdated
}: {
  request: SupportRequest;
  onUpdated: () => Promise<void>;
}) {
  const [status, setStatus] = useState<SupportRequestStatus>(request.status);
  const [isSaving, setIsSaving] = useState(false);

  const updateStatus = async () => {
    if (isSaving) return;

    setIsSaving(true);
    try {
      await updateSupportRequestStatus(request.id, status);
      await onUpdated();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <li className="admin-review-row">
      <div>
        <strong>{request.subject}</strong>
        <span>
          {formatAdminDateTime(request.created_at)} - {request.name} - {request.email}
        </span>
        <span>
          {request.category} - {formatSupportStatus(request.status)}
          {request.user_id ? ` - User ${request.user_id.slice(0, 8)}` : " - Visitor"}
        </span>
        <span>{request.message}</span>
      </div>
      <div className="admin-inline-form support-admin-form">
        <select value={status} onChange={(event) => setStatus(event.target.value as SupportRequestStatus)}>
          {SUPPORT_STATUSES.map((item) => (
            <option value={item} key={item}>
              {formatSupportStatus(item)}
            </option>
          ))}
        </select>
        <button className="ghost-button compact" type="button" onClick={() => void updateStatus()} disabled={isSaving}>
          {isSaving ? "Saving" : "Update"}
        </button>
      </div>
    </li>
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

function defaultAudienceForNotificationType(type: InboxMessageType): InboxTargetAudience {
  if (type === "market_outlook" || type === "trading_signal") return "premium";
  if (type === "community_message") return "all";
  return "all";
}

function notificationAudienceOptions(type: InboxMessageType): InboxTargetAudience[] {
  if (type === "market_outlook" || type === "trading_signal") return ["premium"];
  if (type === "community_message") return ["all"];
  return ["all", "basic", "specific_user"];
}

function toDateTimeLocalValue(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function dateTimeLocalToIso(value: string): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

function formatAdminDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  return date.toLocaleDateString();
}

function formatAdminDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  return date.toLocaleString();
}

function formatSupportStatus(status: SupportRequestStatus): string {
  return status.replace("_", " ");
}
