import type { SupportRequest, SupportRequestCategory, SupportRequestStatus } from "../types/content";
import { supabase } from "./supabase";
import { sanitizeMultilineText, sanitizePlainText, validateEmail } from "./validation";

export const SUPPORT_CATEGORIES: SupportRequestCategory[] = [
  "Account",
  "Billing",
  "Trading Academy",
  "Technical Issue",
  "General Question",
  "Other"
];

export const SUPPORT_STATUSES: SupportRequestStatus[] = ["open", "in_progress", "resolved", "closed"];

export interface SubmitSupportRequestInput {
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
}

export async function submitSupportRequest(input: SubmitSupportRequestInput): Promise<SupportRequest> {
  if (!supabase) throw new Error("Support requests are not connected yet.");

  const name = sanitizePlainText(input.name, 120);
  const email = sanitizePlainText(input.email, 180).toLowerCase();
  const subject = sanitizePlainText(input.subject, 180);
  const category = normalizeSupportCategory(input.category);
  const message = sanitizeMultilineText(input.message, 2500);

  if (!name) throw new Error("Name is required.");
  const emailError = validateEmail(email);
  if (emailError) throw new Error(emailError);
  if (!subject) throw new Error("Subject is required.");
  if (!category) throw new Error("Choose a support category.");
  if (!message) throw new Error("Message is required.");

  const { data, error } = await supabase.rpc("submit_support_request", {
    request_name: name,
    request_email: email,
    request_subject: subject,
    request_category: category,
    request_message: message
  });

  if (error || !data) throw new Error("Support request could not be submitted. Please try again.");
  return data as SupportRequest;
}

export async function fetchAdminSupportRequests(): Promise<SupportRequest[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("support_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error("Support requests could not be loaded.");
  return (data ?? []) as SupportRequest[];
}

export async function updateSupportRequestStatus(
  requestId: string,
  status: SupportRequestStatus
): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from("support_requests")
    .update({ status })
    .eq("id", requestId);

  if (error) throw new Error("Support request status could not be updated.");
}

function normalizeSupportCategory(value: string): SupportRequestCategory | null {
  const category = SUPPORT_CATEGORIES.find((item) => item === value);
  return category ?? null;
}
