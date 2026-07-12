import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.45.4";

const defaultAllowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://aseke-trade.netlify.app",
  "https://aseketrade.com",
  "https://www.aseketrade.com"
];

export function getAiServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new AiHttpError(500, "missing_supabase_secrets", "Supabase server secrets are not configured.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export async function requireAiUser(request: Request, supabase: SupabaseClient): Promise<User> {
  const token = bearerToken(request);
  if (!token) throw new AiHttpError(401, "auth_required", "Sign in before using AI Futures Analyst.");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new AiHttpError(401, "invalid_session", "Your session could not be verified.");
  return data.user;
}

export function requireAiCron(request: Request): void {
  const expected = Deno.env.get("AI_CRON_SECRET")?.trim();
  const received = request.headers.get("x-ai-cron-secret")?.trim();
  if (!expected) throw new AiHttpError(500, "missing_cron_secret", "AI cron authentication is not configured.");
  if (!received || !constantTimeEqual(received, expected)) {
    throw new AiHttpError(403, "cron_forbidden", "This AI pipeline endpoint is server-only.");
  }
}

export function handleAiOptions(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response("ok", { status: 200, headers: aiCorsHeaders(request) });
}

export function aiJsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...aiCorsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Vary: "Origin"
    }
  });
}

export function aiErrorResponse(request: Request, error: unknown): Response {
  const status = error instanceof AiHttpError ? error.status : 500;
  const code = error instanceof AiHttpError ? error.code : readErrorCode(error) ?? "ai_futures_failed";
  const message = error instanceof Error ? error.message : "AI Futures analysis failed.";
  console.error("AI Futures request failed", { code, message, error });
  return aiJsonResponse(request, { error: code, message }, status);
}

export async function readBoundedJson(request: Request, maximumBytes = 24_000): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maximumBytes) throw new AiHttpError(413, "request_too_large", "Request body is too large.");
  if (!text.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new AiHttpError(400, "invalid_json", "Request body must be valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AiHttpError(400, "invalid_request", "Request body must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function aiCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin")?.trim();
  const allowed = allowedOrigins();
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
  };
}

function allowedOrigins(): string[] {
  const configured = (Deno.env.get("AI_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length ? configured : defaultAllowedOrigins;
}

function bearerToken(request: Request): string | null {
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index % a.length] ?? 0) ^ (b[index % b.length] ?? 0);
  return difference === 0;
}

function readErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return null;
}

export class AiHttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "AiHttpError";
  }
}
