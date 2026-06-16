import {
  ArrowUpRight,
  Award,
  Bell,
  BookMarked,
  Camera,
  Crown,
  Edit3,
  GraduationCap,
  KeyRound,
  Mail,
  MailOpen,
  Save,
  ShieldCheck,
  UserCircle2,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { UserBadgeRail } from "../components/UserBadgePill";
import { useAuth } from "../contexts/AuthContext";
import { useAccountStatus } from "../hooks/useAccountStatus";
import { evaluateUserBadges } from "../lib/badgesApi";
import { getProgressToNextLevel } from "../lib/levels";
import { fetchInboxMessages, inboxTypeLabels, markInboxMessageRead } from "../lib/notificationsApi";
import { hasPasswordIdentity, SOCIAL_PASSWORD_MESSAGE } from "../lib/passwordAuth";
import { supabase } from "../lib/supabase";
import { sanitizePlainText } from "../lib/validation";
import type {
  Guide,
  InboxMessage,
  Lesson,
  LessonProgress,
  Purchase,
  SavedGuide,
  UserBadge,
  XPTransaction
} from "../types/content";

type MaybeArray<T> = T | T[] | null | undefined;
type SavedGuideRow = Omit<SavedGuide, "guides"> & {
  guides?: MaybeArray<Pick<Guide, "title" | "slug" | "category">>;
};
type LessonProgressRow = Omit<LessonProgress, "lessons"> & {
  lessons?: MaybeArray<Pick<Lesson, "title">>;
};
type InboxFilter = "all" | "unread" | "market_outlook" | "trading_signal" | "account" | "community_message";

const avatarTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const maxAvatarSizeBytes = 2 * 1024 * 1024;
const inboxFilters: Array<{ value: InboxFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "market_outlook", label: "Outlook" },
  { value: "trading_signal", label: "Signals" },
  { value: "account", label: "Account" },
  { value: "community_message", label: "Community" }
];

function firstRelation<T>(relation: MaybeArray<T>): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

function normalizeSavedGuide(row: SavedGuideRow): SavedGuide {
  return {
    ...row,
    guides: firstRelation(row.guides)
  };
}

function normalizeLessonProgress(row: LessonProgressRow): LessonProgress {
  return {
    ...row,
    lessons: firstRelation(row.lessons)
  };
}

export function Dashboard() {
  const { user, profile, refreshProfile, changePassword } = useAuth();
  const accountStatus = useAccountStatus();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [savedGuides, setSavedGuides] = useState<SavedGuide[]>([]);
  const [progress, setProgress] = useState<LessonProgress[]>([]);
  const [xpTransactions, setXPTransactions] = useState<XPTransaction[]>([]);
  const [userBadges, setUserBadges] = useState<UserBadge[]>([]);
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([]);
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>("all");
  const [selectedInboxMessageId, setSelectedInboxMessageId] = useState<string | null>(null);
  const [areBadgesExpanded, setAreBadgesExpanded] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [isNameSaving, setIsNameSaving] = useState(false);
  const [isEditingDisplayName, setIsEditingDisplayName] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [isPasswordSuccess, setIsPasswordSuccess] = useState(false);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [isPasswordSectionExpanded, setIsPasswordSectionExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const totalXP = profile?.total_xp ?? 0;
  const levelProgress = getProgressToNextLevel(totalXP);
  const displayName = profile?.full_name ?? profile?.username ?? user?.email ?? "Account";
  const canChangeAccountPassword = hasPasswordIdentity(user);
  const unreadInboxCount = inboxMessages.filter((message) => !message.is_read).length;
  const visibleBadgeLimit = areBadgesExpanded ? userBadges.length : 4;
  const filteredInboxMessages = useMemo(
    () => inboxMessages.filter((message) => matchesInboxFilter(message, inboxFilter)),
    [inboxFilter, inboxMessages]
  );
  const selectedInboxMessage = useMemo(
    () => filteredInboxMessages.find((message) => message.id === selectedInboxMessageId) ?? null,
    [filteredInboxMessages, selectedInboxMessageId]
  );

  useEffect(() => {
    if (!isEditingDisplayName) {
      setDisplayNameInput(profile?.full_name ?? profile?.username ?? user?.email?.split("@")[0] ?? "");
    }
  }, [isEditingDisplayName, profile?.full_name, profile?.username, user?.email]);

  useEffect(() => {
    let mounted = true;
    const currentUser = user;
    const client = supabase;

    if (!client || !currentUser) {
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }

    const userId = currentUser.id;
    const database = client;

    async function loadDashboardData() {
      let nextBadges: UserBadge[] = [];

      try {
        nextBadges = await evaluateUserBadges(userId);
        await refreshProfile();
      } catch {
        nextBadges = [];
      }

      const [purchaseResult, savedResult, progressResult, xpResult, inboxResult] = await Promise.all([
        database.from("purchases").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        database
          .from("saved_guides")
          .select("id,user_id,guide_id,created_at,guides(title,slug,category)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        database
          .from("lesson_progress")
          .select("id,user_id,lesson_id,completed,completed_at,lessons(title)")
          .eq("user_id", userId)
          .order("completed_at", { ascending: false }),
        database
          .from("xp_transactions")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(5),
        fetchInboxMessages()
          .then((data) => ({ data, error: null }))
          .catch((loadError: unknown) => ({ data: [] as InboxMessage[], error: loadError }))
      ]);

      if (!mounted) return;

      if (purchaseResult.error || savedResult.error || progressResult.error || xpResult.error) {
        setError("Some dashboard data could not be loaded.");
      }
      setInboxError(inboxResult.error ? "Inbox messages could not be loaded." : null);

      setPurchases((purchaseResult.data ?? []) as Purchase[]);
      setSavedGuides(((savedResult.data ?? []) as SavedGuideRow[]).map(normalizeSavedGuide));
      setProgress(((progressResult.data ?? []) as LessonProgressRow[]).map(normalizeLessonProgress));
      setXPTransactions((xpResult.data ?? []) as XPTransaction[]);
      setUserBadges(nextBadges);
      setInboxMessages(inboxResult.data);
      setIsLoading(false);
    }

    void loadDashboardData();

    return () => {
      mounted = false;
    };
  }, [refreshProfile, user]);

  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!supabase || !user) {
      setAvatarMessage("Login with Supabase connected to change your avatar.");
      return;
    }

    if (!avatarTypes.includes(file.type)) {
      setAvatarMessage("Use a JPG, PNG, WEBP, or GIF image.");
      return;
    }

    if (file.size > maxAvatarSizeBytes) {
      setAvatarMessage("Avatar images must be 2 MB or smaller.");
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase();
    const safeExtension = extension && /^[a-z0-9]+$/.test(extension) ? extension : "png";
    const avatarPath = `${user.id}/avatar-${Date.now()}.${safeExtension}`;

    setIsAvatarUploading(true);
    setAvatarMessage(null);

    const uploadResult = await supabase.storage.from("avatars").upload(avatarPath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false
    });

    if (uploadResult.error) {
      setAvatarMessage("Avatar upload failed. Check the avatars storage bucket and policies.");
      setIsAvatarUploading(false);
      return;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(avatarPath);
    const updateResult = await supabase.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", user.id);

    if (updateResult.error) {
      setAvatarMessage("Avatar uploaded, but your profile could not be updated.");
    } else {
      setAvatarMessage("Avatar updated.");
      await refreshProfile();
    }

    setIsAvatarUploading(false);
  };

  const saveDisplayName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!supabase || !user) {
      setNameMessage("Login with Supabase connected to change your name.");
      return;
    }

    const fullName = sanitizePlainText(displayNameInput, 40);
    if (fullName.length < 2) {
      setNameMessage("Display name must be at least 2 characters.");
      return;
    }

    setIsNameSaving(true);
    setNameMessage(null);

    const { error: updateError } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);

    if (updateError) {
      setNameMessage("Display name could not be updated.");
    } else {
      setNameMessage("Display name updated.");
      await refreshProfile();
      setIsEditingDisplayName(false);
    }

    setIsNameSaving(false);
  };

  const startEditingDisplayName = () => {
    setDisplayNameInput(profile?.full_name ?? profile?.username ?? user?.email?.split("@")[0] ?? "");
    setNameMessage(null);
    setIsEditingDisplayName(true);
  };

  const cancelEditingDisplayName = () => {
    setDisplayNameInput(profile?.full_name ?? profile?.username ?? user?.email?.split("@")[0] ?? "");
    setNameMessage(null);
    setIsEditingDisplayName(false);
  };

  const saveAccountPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordMessage(null);
    setIsPasswordSuccess(false);

    if (!canChangeAccountPassword) {
      setPasswordMessage(SOCIAL_PASSWORD_MESSAGE);
      return;
    }

    setIsPasswordSaving(true);
    const result = await changePassword(currentPassword, newPassword, confirmNewPassword);
    setIsPasswordSaving(false);

    setPasswordMessage(result.message);
    setIsPasswordSuccess(result.ok);

    if (result.ok) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } else {
      setCurrentPassword("");
    }
  };

  const togglePasswordSection = () => {
    setIsPasswordSectionExpanded((expanded) => {
      const nextExpanded = !expanded;

      if (!nextExpanded) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
        setPasswordMessage(null);
        setIsPasswordSuccess(false);
      }

      return nextExpanded;
    });
  };

  const openInboxMessage = async (message: InboxMessage) => {
    setSelectedInboxMessageId(message.id);
    if (message.is_read) return;

    setInboxMessages((messages) =>
      messages.map((currentMessage) =>
        currentMessage.id === message.id ? { ...currentMessage, is_read: true } : currentMessage
      )
    );

    try {
      await markInboxMessageRead(message.id);
    } catch {
      setInboxError("Inbox read status could not be saved.");
    }
  };

  return (
    <main className="page page-stack">
      <section className="page-title-row compact-title-row">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Account Dashboard</h1>
          <p className="muted">
            Continue your trading education, manage your balance, and track your Trading Academy access.
          </p>
        </div>
        <span className={accountStatus.isPremiumActive ? "status-pill premium" : "status-pill free"}>
          <Crown size={15} />
          {accountStatus.planLabel}
        </span>
      </section>

      {error && <p className="warning-box">{error}</p>}

      <section className="dashboard-grid three profile-overview-grid">
        <article className="section-panel dashboard-profile-card">
          <div className="avatar-profile-row">
            <div className="dashboard-avatar" aria-label="Profile avatar">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="Profile avatar" />
              ) : (
                <UserCircle2 size={74} aria-hidden="true" />
              )}
              <span className="avatar-level-badge">LVL {levelProgress.level}</span>
            </div>
            <div>
              <span className="feature-icon compact-icon">
                <UserCircle2 size={21} />
              </span>
              <h2>Profile</h2>
              <label className="ghost-button compact avatar-upload-button">
                <Camera size={16} />
                {isAvatarUploading ? "Uploading" : "Change avatar"}
                <input type="file" accept={avatarTypes.join(",")} onChange={(event) => void uploadAvatar(event)} />
              </label>
            </div>
          </div>
          {avatarMessage && <p className="soft-notice">{avatarMessage}</p>}
          {isEditingDisplayName ? (
            <form className="display-name-form" onSubmit={saveDisplayName}>
              <label>
                Display name
                <input
                  value={displayNameInput}
                  onChange={(event) => setDisplayNameInput(event.target.value)}
                  maxLength={40}
                />
              </label>
              <div className="display-name-actions">
                <button className="ghost-button compact" type="submit" disabled={isNameSaving}>
                  <Save size={16} />
                  {isNameSaving ? "Saving" : "Save"}
                </button>
                <button className="ghost-button compact" type="button" onClick={cancelEditingDisplayName}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="display-name-static">
              <div>
                <span>Display name</span>
                <strong>{displayName}</strong>
              </div>
              <button className="ghost-button compact" type="button" onClick={startEditingDisplayName}>
                <Edit3 size={16} />
                Change name
              </button>
            </div>
          )}
          {nameMessage && <p className="soft-notice">{nameMessage}</p>}
          <dl className="detail-list">
            <div>
              <dt>Name</dt>
              <dd>{displayName}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user?.email}</dd>
            </div>
            <div>
              <dt>Available Balance</dt>
              <dd>{accountStatus.balanceLabel}</dd>
            </div>
            <div>
              <dt>Current Plan</dt>
              <dd>{accountStatus.planLabel}</dd>
            </div>
            {accountStatus.isPremiumActive && accountStatus.premiumUntilLabel && (
              <div>
                <dt>Trading Academy Access Expires</dt>
                <dd>{accountStatus.premiumUntilLabel}</dd>
              </div>
            )}
          </dl>
          <section className="profile-password-section" aria-labelledby="change-password-title">
            <div className="profile-password-heading">
              <span className="feature-icon compact-icon">
                <KeyRound size={18} />
              </span>
              <div>
                <h3 id="change-password-title">
                  <button
                    className="profile-password-title-link"
                    type="button"
                    onClick={togglePasswordSection}
                    aria-expanded={isPasswordSectionExpanded}
                    aria-controls="password-change-content"
                  >
                    Change Password
                  </button>
                </h3>
              </div>
            </div>

            {isPasswordSectionExpanded && (
              <div id="password-change-content">
                {canChangeAccountPassword ? (
                  <form className="password-change-form" onSubmit={saveAccountPassword}>
                    <label>
                      Current Password
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                        disabled={isPasswordSaving}
                        required
                      />
                    </label>
                    <label>
                      New Password
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        disabled={isPasswordSaving}
                        minLength={8}
                        required
                      />
                    </label>
                    <label>
                      Confirm New Password
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={confirmNewPassword}
                        onChange={(event) => setConfirmNewPassword(event.target.value)}
                        disabled={isPasswordSaving}
                        minLength={8}
                        required
                      />
                    </label>
                    {passwordMessage && (
                      <p className={isPasswordSuccess ? "form-success" : "form-error"} aria-live="polite">
                        {passwordMessage}
                      </p>
                    )}
                    <button className="ghost-button compact" type="submit" disabled={isPasswordSaving || !supabase}>
                      <ShieldCheck size={16} />
                      {isPasswordSaving ? "Updating..." : "Update password"}
                    </button>
                  </form>
                ) : (
                  <p className="soft-notice">{SOCIAL_PASSWORD_MESSAGE}</p>
                )}
              </div>
            )}
          </section>
        </article>

        <article className="section-panel inbox-panel dashboard-inbox-card">
          <div className="lesson-title-line">
            <div>
              <h2>Inbox</h2>
            </div>
            <span className={unreadInboxCount ? "status-pill premium" : "status-pill free"}>
              <Bell size={15} />
              {unreadInboxCount} unread
            </span>
          </div>

          <div className="inbox-filter-row" aria-label="Inbox filters">
            {inboxFilters.map((filter) => (
              <button
                className={inboxFilter === filter.value ? "filter-pill active" : "filter-pill"}
                type="button"
                onClick={() => setInboxFilter(filter.value)}
                key={filter.value}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {inboxError && <p className="warning-box">{inboxError}</p>}

          {isLoading ? (
            <LoadingState label="Loading inbox" />
          ) : (
            <div className="inbox-layout">
              <div className="inbox-list" role="list">
                {filteredInboxMessages.length ? (
                  filteredInboxMessages.map((message) => (
                    <button
                      className={`inbox-row ${selectedInboxMessage?.id === message.id ? "active" : ""} ${message.is_read ? "read" : "unread"}`}
                      type="button"
                      onClick={() => void openInboxMessage(message)}
                      role="listitem"
                      key={message.id}
                    >
                      <span className="inbox-row-top">
                        <span className="inbox-icon-frame">
                          {message.is_read ? <MailOpen size={16} /> : <Mail size={16} />}
                        </span>
                        <strong>{message.title}</strong>
                        <span>{inboxTypeLabels[message.type]}</span>
                      </span>
                      <span>{message.summary ?? formatInboxPreview(message.message)}</span>
                      <time>{formatDashboardDate(message.created_at)}</time>
                    </button>
                  ))
                ) : (
                  <div className="inbox-list-empty" aria-hidden="true" />
                )}
              </div>

              {selectedInboxMessage ? (
                <article className="inbox-detail-panel">
                  <div className="inbox-detail-heading">
                    <span className="status-pill premium">{inboxTypeLabels[selectedInboxMessage.type]}</span>
                    <time>{formatDashboardDate(selectedInboxMessage.created_at)}</time>
                  </div>
                  <h3>{selectedInboxMessage.title}</h3>
                  {selectedInboxMessage.summary && <p className="muted">{selectedInboxMessage.summary}</p>}
                  <p className="inbox-message-body">{selectedInboxMessage.message}</p>
                  {selectedInboxMessage.related_signal_id && (
                    <p className="muted">Signal ID: {selectedInboxMessage.related_signal_id}</p>
                  )}
                </article>
              ) : (
                <div className="inbox-detail-panel inbox-detail-empty">
                  <MailOpen size={22} aria-hidden="true" />
                  <p className="muted">
                    {filteredInboxMessages.length
                      ? "Select a notification to read it."
                      : "No notifications in this view."}
                  </p>
                </div>
              )}
            </div>
          )}
        </article>

        <article className="section-panel dashboard-access-card">
          <span className="feature-icon">
            <WalletCards size={21} />
          </span>
          <h2>Account access</h2>
          <div className="inline-actions">
            <Link className="primary-button compact" to="/account/payments">
              <ArrowUpRight size={16} />
              Top up balance
            </Link>
            <Link className="ghost-button compact" to="/trading-academy">
              <ShieldCheck size={16} />
              Extend Trading Academy Access
            </Link>
          </div>
        </article>

        <article className="section-panel level-panel compact-level-panel dashboard-level-card">
          <div className="level-compact-header">
            <span className="feature-icon compact-icon">
              <Award size={21} />
            </span>
            <div>
              <h2>Learning Level</h2>
              <span>{totalXP} total XP</span>
            </div>
            <span className="level-badge">LVL {levelProgress.level}</span>
          </div>
          <div className="xp-progress-track" aria-label={`${levelProgress.progressPercent}% to next level`}>
            <span style={{ width: `${levelProgress.progressPercent}%` }} />
          </div>
          <p className="level-next-line">
            {levelProgress.xpIntoLevel}/{levelProgress.xpRequiredForNextLevel} XP - {levelProgress.xpRemainingForNextLevel} XP to LVL {levelProgress.level + 1}
          </p>
          <div className="level-badge-section">
            <div className="level-badge-heading">
              <span>Badges</span>
              <small>{userBadges.length ? `${userBadges.length} earned` : "Course and loyalty rewards"}</small>
            </div>
            <UserBadgeRail
              badges={userBadges}
              emptyLabel="Complete course quizzes or keep Trading Academy active to earn badges."
              maxVisible={visibleBadgeLimit}
            />
            {userBadges.length > 4 && (
              <button
                className="ghost-button compact badge-expand-button"
                type="button"
                onClick={() => setAreBadgesExpanded((expanded) => !expanded)}
                aria-expanded={areBadgesExpanded}
              >
                {areBadgesExpanded ? "Show fewer badges" : `Show all ${userBadges.length}`}
              </button>
            )}
          </div>
        </article>
      </section>

      {isLoading ? (
        <LoadingState label="Loading dashboard" />
      ) : (
        <section className="dashboard-grid three">
          <article className="section-panel">
            <span className="feature-icon">
              <GraduationCap size={21} />
            </span>
            <h2>Recent Payments & Access</h2>
            {purchases.length ? (
              <ul className="plain-list">
                {purchases.map((purchase) => (
                  <li key={purchase.id}>
                    <strong>{purchase.status}</strong>
                    <span>{purchase.course_id ?? purchase.guide_id ?? "Trading Academy access"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                You have no payments yet. Top up your balance or join the Trading Academy when you are ready.
              </p>
            )}
          </article>

          <article className="section-panel">
            <span className="feature-icon">
              <BookMarked size={21} />
            </span>
            <h2>Saved Guides</h2>
            {savedGuides.length ? (
              <ul className="plain-list">
                {savedGuides.map((saved) => (
                  <li key={saved.id}>
                    <strong>{saved.guides?.title ?? saved.guide_id}</strong>
                    <span>{saved.guides?.category ?? "Guide"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No saved guides yet. Start with Crypto Foundations, then save the guides you want to revisit.</p>
            )}
          </article>

          <article className="section-panel">
            <span className="feature-icon">
              <Crown size={21} />
            </span>
            <h2>Recent XP</h2>
            {xpTransactions.length ? (
              <ul className="plain-list">
                {xpTransactions.map((transaction) => (
                  <li key={transaction.id}>
                    <strong>+{transaction.amount} XP</strong>
                    <span>{transaction.description ?? transaction.source_type}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Pass guide quizzes and solve the current puzzle to build your XP history.
              </p>
            )}
          </article>

          <article className="section-panel">
            <span className="feature-icon">
              <Crown size={21} />
            </span>
            <h2>Lesson Progress</h2>
            {progress.length ? (
              <ul className="plain-list">
                {progress.map((item) => (
                  <li key={item.id}>
                    <strong>{item.lessons?.title ?? item.lesson_id}</strong>
                    <span>{item.completed ? "Completed" : "In progress"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                You have not started any lessons yet. Begin with foundations, then move toward Trading Academy topics when ready.
              </p>
            )}
          </article>
        </section>
      )}
    </main>
  );
}

function matchesInboxFilter(message: InboxMessage, filter: InboxFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return !message.is_read;
  if (filter === "account") return message.type === "account_update" || message.type === "security_update";
  return message.type === filter;
}

function formatInboxPreview(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function formatDashboardDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return date.toLocaleString();
}
