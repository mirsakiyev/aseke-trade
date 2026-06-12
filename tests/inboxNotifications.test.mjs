import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const dashboardSource = await readFile(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");
const adminSource = await readFile(new URL("../src/pages/Admin.tsx", import.meta.url), "utf8");
const notificationsApiSource = await readFile(new URL("../src/lib/notificationsApi.ts", import.meta.url), "utf8");
const validationSource = await readFile(new URL("../src/lib/validation.ts", import.meta.url), "utf8");
const typesSource = await readFile(new URL("../src/types/content.ts", import.meta.url), "utf8");
const migration = await readFile(
  new URL("../supabase/migrations/202606120006_inbox_notifications.sql", import.meta.url),
  "utf8"
);

test("notification migration creates inbox tables, read tracking, and server-side premium filters", () => {
  for (const expected of [
    "public.notifications",
    "public.notification_reads",
    "public.get_user_notifications",
    "public.mark_notification_read",
    "public.notify_trading_signal_change",
    "notify_trading_signal_change",
    "after insert or update on public.trading_signals",
    "notifications_premium_types_target_check",
    "requester_is_premium"
  ]) {
    assert.match(migration, new RegExp(expected.replace(/[.]/g, "\\."), "i"));
  }
  assert.match(migration, /n\.type not in \('market_outlook', 'trading_signal'\)/i);
  assert.match(migration, /'premium',\s*'trading_signal'/i);
  assert.match(migration, /related_signal_id/i);
});

test("dashboard renders inbox, read handling, display name editing, and compact level UI", () => {
  for (const expected of [
    "fetchInboxMessages",
    "markInboxMessageRead",
    "display-name-form",
    "display-name-static",
    "isEditingDisplayName",
    "avatar-level-badge",
    "compact-level-panel",
    "inbox-panel",
    "inbox-message-body",
    "Extend Trading Academy Access"
  ]) {
    assert.match(dashboardSource, new RegExp(expected.replace(/[.]/g, "\\.")));
  }
  assert.doesNotMatch(dashboardSource, /Your Trading Academy access is active/);
  assert.doesNotMatch(dashboardSource, /Join Trading Academy/);
});

test("admin has a notification tab with constrained notification audiences", () => {
  assert.match(adminSource, /type AdminTab = "guides" \| "courses" \| "lessons" \| "inbox" \| "users"/);
  assert.match(adminSource, /sendAdminNotification/);
  assert.match(adminSource, /manualNotificationTypes/);
  assert.match(adminSource, /defaultAudienceForNotificationType/);
  assert.match(adminSource, /notificationAudienceOptions/);
  assert.match(adminSource, /return \["premium"\]/);
  assert.match(adminSource, /return \["all"\]/);
  const manualTypes = adminSource.match(/const manualNotificationTypes[\s\S]*?\];/);
  assert.ok(manualTypes);
  assert.doesNotMatch(manualTypes[0], /"trading_signal"/);
  assert.match(adminSource, /Sent automatically to premium users when a signal is created or updated/);
});

test("notification client types and helper validate premium-only delivery", () => {
  assert.match(typesSource, /export type InboxMessageType/);
  assert.match(typesSource, /export interface InboxMessage/);
  assert.match(notificationsApiSource, /premiumOnlyTypes/);
  assert.match(notificationsApiSource, /sanitizeMultilineText\(input\.message, 2400\)/);
  assert.match(validationSource, /export function sanitizeMultilineText/);
  assert.match(validationSource, /replace\(\/\\r\\n\?\/g, "\\n"\)/);
  assert.match(notificationsApiSource, /Trading signal notifications are sent automatically when signals are created or updated/);
  assert.match(notificationsApiSource, /Market outlook and trading signal notifications must be sent to premium users/);
  assert.match(notificationsApiSource, /Community messages must be sent to all users/);
});
