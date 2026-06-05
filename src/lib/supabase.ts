import { createClient } from "@supabase/supabase-js";

const supabaseUrl = cleanEnvValue(import.meta.env.VITE_SUPABASE_URL);
const supabasePublishableKey = firstConfiguredEnvValue(
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
);
export const supabaseProjectRef = getSupabaseProjectRef(supabaseUrl);

function cleanEnvValue(value: string | undefined): string {
  return value?.trim() ?? "";
}

function firstConfiguredEnvValue(...values: Array<string | undefined>): string {
  return values.map(cleanEnvValue).find(Boolean) ?? "";
}

function hasPlaceholder(value: string): boolean {
  return value.includes("your-project") || value.includes("your-supabase");
}

function getSupabaseProjectRef(value: string): string | null {
  try {
    const host = new URL(value).hostname;
    return host.endsWith(".supabase.co") ? host.replace(".supabase.co", "") : host;
  } catch {
    return null;
  }
}

function validateSupabaseUrl(value: string): string | null {
  if (!value || hasPlaceholder(value)) {
    return "Supabase URL is missing or still set to the placeholder value.";
  }

  if (/^postgres(ql)?:\/\//i.test(value) || /pooler\.supabase/i.test(value) || /db\.[a-z0-9-]+\.supabase/i.test(value)) {
    return "Supabase URL must be the Project API URL, not the database connection or pooler URL.";
  }

  try {
    const url = new URL(value);
    const isLocalSupabase = ["localhost", "127.0.0.1"].includes(url.hostname);

    if (url.protocol !== "https:" && !(isLocalSupabase && url.protocol === "http:")) {
      return "Supabase URL must start with https:// for hosted projects.";
    }
  } catch {
    return "Supabase URL is not a valid URL.";
  }

  return null;
}

function validateSupabaseKey(value: string): string | null {
  if (!value || hasPlaceholder(value)) {
    return "Supabase publishable key is missing or still set to the placeholder value.";
  }

  if (value.startsWith("sb_secret_")) {
    return "Supabase secret keys must not be used in the browser. Use the publishable key instead.";
  }

  if (!value.startsWith("sb_publishable_") && !value.startsWith("eyJ")) {
    return "Supabase key must be a publishable key or a legacy anon JWT key.";
  }

  return null;
}

export const supabaseConfigError = validateSupabaseUrl(supabaseUrl) ?? validateSupabaseKey(supabasePublishableKey);

export const isSupabaseConfigured = !supabaseConfigError;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true
      }
    })
  : null;
