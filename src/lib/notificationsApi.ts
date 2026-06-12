import type { InboxMessage, InboxMessageType, InboxTargetAudience } from "../types/content";
import { supabase } from "./supabase";
import { sanitizeMultilineText, sanitizePlainText } from "./validation";

const premiumOnlyTypes = new Set<InboxMessageType>(["market_outlook", "trading_signal"]);

export const inboxTypeLabels: Record<InboxMessageType, string> = {
  market_outlook: "Market Outlook",
  trading_signal: "Trading Signal",
  account_update: "Account",
  security_update: "Security",
  community_message: "Community"
};

export const inboxAudienceLabels: Record<InboxTargetAudience, string> = {
  all: "All users",
  basic: "Basic users",
  premium: "Premium users",
  specific_user: "Specific user"
};

export async function fetchInboxMessages(): Promise<InboxMessage[]> {
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("get_user_notifications");
  if (error) throw new Error("Inbox messages could not be loaded.");

  return (data ?? []) as InboxMessage[];
}

export async function markInboxMessageRead(messageId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not connected.");

  const { error } = await supabase.rpc("mark_notification_read", {
    target_notification_id: messageId
  });

  if (error) throw new Error("Inbox message could not be marked as read.");
}

export async function sendAdminNotification(input: {
  type: InboxMessageType;
  targetAudience: InboxTargetAudience;
  userId?: string;
  title: string;
  summary?: string;
  message: string;
  relatedSignalId?: string;
  sentByAdminId: string;
}): Promise<InboxMessage> {
  if (!supabase) throw new Error("Supabase is not connected.");

  const payload = buildNotificationPayload(input);
  const { data, error } = await supabase.from("notifications").insert(payload).select("*").single();

  if (error || !data) throw new Error("Notification could not be sent.");
  return data as InboxMessage;
}

export function buildNotificationPayload(input: {
  type: InboxMessageType;
  targetAudience: InboxTargetAudience;
  userId?: string;
  title: string;
  summary?: string;
  message: string;
  relatedSignalId?: string;
  sentByAdminId: string;
}) {
  validateNotificationAudience(input.type, input.targetAudience, input.userId);

  const title = sanitizePlainText(input.title, 180);
  const summary = sanitizePlainText(input.summary ?? "", 260);
  const message = sanitizeMultilineText(input.message, 2400);
  const relatedSignalId = sanitizePlainText(input.relatedSignalId ?? "", 80);

  if (!title) throw new Error("Notification title is required.");
  if (!message) throw new Error("Notification message is required.");

  return {
    type: input.type,
    target_audience: input.targetAudience,
    user_id: input.targetAudience === "specific_user" ? input.userId : null,
    title,
    summary: summary || null,
    message,
    related_signal_id: relatedSignalId || null,
    sent_by_admin_id: input.sentByAdminId
  };
}

function validateNotificationAudience(type: InboxMessageType, audience: InboxTargetAudience, userId?: string): void {
  if (type === "trading_signal") {
    throw new Error("Trading signal notifications are sent automatically when signals are created or updated.");
  }

  if (premiumOnlyTypes.has(type) && audience !== "premium") {
    throw new Error("Market outlook and trading signal notifications must be sent to premium users.");
  }

  if (type === "community_message" && audience !== "all") {
    throw new Error("Community messages must be sent to all users.");
  }

  if (audience === "specific_user" && !userId) {
    throw new Error("Choose a user for a direct notification.");
  }

  if (audience !== "specific_user" && userId) {
    throw new Error("Direct user is only valid for specific-user notifications.");
  }
}
