import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
const supportSource = await readFile(new URL("../src/pages/Support.tsx", import.meta.url), "utf8");
const supportApiSource = await readFile(new URL("../src/lib/supportApi.ts", import.meta.url), "utf8");
const adminSource = await readFile(new URL("../src/pages/Admin.tsx", import.meta.url), "utf8");
const supportMigration = await readFile(
  new URL("../supabase/migrations/202606150001_general_support_requests.sql", import.meta.url),
  "utf8"
);

test("public support page is routed from the footer and includes FAQ, Telegram, and form", () => {
  assert.match(appSource, /path="support"/);
  assert.match(layoutSource, /<Link to="\/support">Support<\/Link>/);
  assert.match(supportSource, /FaqAccordion/);
  assert.match(supportSource, /https:\/\/t\.me\/aseketrade/);
  assert.match(supportSource, /SUPPORT_CATEGORIES\.map/);
  assert.match(supportSource, /submitSupportRequest/);
  assert.match(supportSource, /Name/);
  assert.match(supportSource, /Email/);
  assert.match(supportSource, /Subject/);
  assert.match(supportSource, /Category/);
  assert.match(supportSource, /Message/);
  assert.match(supportSource, /Send Support Request/);
});

test("support API validates and submits through the support request RPC", () => {
  assert.match(supportApiSource, /export const SUPPORT_CATEGORIES/);
  assert.match(supportApiSource, /"Trading Academy"/);
  assert.match(supportApiSource, /validateEmail/);
  assert.match(supportApiSource, /supabase\.rpc\("submit_support_request"/);
  assert.match(supportApiSource, /fetchAdminSupportRequests/);
  assert.match(supportApiSource, /updateSupportRequestStatus/);
});

test("support migration stores requests and exposes admin-only visibility", () => {
  assert.match(supportMigration, /create table if not exists public\.support_requests/i);
  assert.match(supportMigration, /user_id uuid references auth\.users\(id\) on delete set null/i);
  assert.match(supportMigration, /status text not null default 'open'/i);
  assert.match(supportMigration, /create or replace function public\.submit_support_request/i);
  assert.match(supportMigration, /grant execute on function public\.submit_support_request\(text, text, text, text, text\) to anon, authenticated/i);
  assert.match(supportMigration, /alter table public\.support_requests enable row level security/i);
  assert.match(supportMigration, /support_requests_select_admin/i);
  assert.match(supportMigration, /support_requests_update_admin/i);
  assert.match(supportMigration, /public\.is_admin\(\)/i);
});

test("admin dashboard lists regular support requests with status updates", () => {
  assert.match(adminSource, /type AdminTab = "guides" \| "courses" \| "inbox" \| "support" \| "users"/);
  assert.match(adminSource, /fetchAdminSupportRequests/);
  assert.match(adminSource, /activeTab === "support"/);
  assert.match(adminSource, /<AdminList title="Support Requests" noHover>/);
  assert.match(adminSource, /function SupportRequestAdminRow/);
  assert.match(adminSource, /SUPPORT_STATUSES\.map/);
  assert.match(adminSource, /updateSupportRequestStatus/);
});
