import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const passwordSource = await readFile(new URL("../src/lib/passwordAuth.ts", import.meta.url), "utf8");
const authSource = await readFile(new URL("../src/contexts/AuthContext.tsx", import.meta.url), "utf8");
const dashboardSource = await readFile(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");

const transpiled = ts.transpileModule(passwordSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const passwordAuth = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

test("password change validation blocks unsafe inputs before auth calls", () => {
  assert.equal(
    passwordAuth.validatePasswordChangeInput({
      currentPassword: "",
      newPassword: "NewPass123",
      confirmPassword: "NewPass123"
    }),
    "Current password is required."
  );
  assert.equal(
    passwordAuth.validatePasswordChangeInput({
      currentPassword: "OldPass123",
      newPassword: "newpass123",
      confirmPassword: "newpass123"
    }),
    passwordAuth.NEW_PASSWORD_POLICY_MESSAGE
  );
  assert.equal(
    passwordAuth.validatePasswordChangeInput({
      currentPassword: "OldPass123",
      newPassword: "NewPass123",
      confirmPassword: "Mismatch123"
    }),
    "New password and confirmation do not match."
  );
  assert.equal(
    passwordAuth.validatePasswordChangeInput({
      currentPassword: "OldPass123",
      newPassword: "OldPass123",
      confirmPassword: "OldPass123"
    }),
    "New password must be different from current password."
  );
  assert.equal(
    passwordAuth.validatePasswordChangeInput({
      currentPassword: "OldPass123",
      newPassword: " NewPass123",
      confirmPassword: " NewPass123"
    }),
    "Remove spaces at the beginning or end of password fields."
  );
});

test("password identity helper distinguishes email/password and social-only accounts", () => {
  assert.equal(
    passwordAuth.hasPasswordIdentity({
      email: "learner@example.com",
      identities: [{ provider: "email" }],
      app_metadata: {}
    }),
    true
  );
  assert.equal(
    passwordAuth.hasPasswordIdentity({
      email: "learner@example.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google", providers: ["google"] }
    }),
    false
  );
  assert.equal(
    passwordAuth.hasPasswordIdentity({
      email: "learner@example.com",
      identities: [],
      app_metadata: {}
    }),
    true
  );
});

test("password change uses Supabase reauthentication and provider password update", () => {
  assert.match(authSource, /changePassword/);
  assert.match(authSource, /signInWithPassword\(\{/);
  assert.match(authSource, /updateUser\(\{\s*password: newPassword\s*\}\)/);
  assert.match(authSource, /PASSWORD_UPDATE_GENERIC_ERROR/);
  assert.doesNotMatch(authSource, /console\.(log|warn|error)\([^)]*password/i);
});

test("dashboard profile keeps the change password form collapsed by default", () => {
  for (const expected of [
    "Change Password",
    "const [isPasswordSectionExpanded, setIsPasswordSectionExpanded] = useState(false)",
    "aria-expanded={isPasswordSectionExpanded}",
    "aria-controls=\"password-change-content\"",
    "Open form",
    "Hide form",
    "{isPasswordSectionExpanded &&",
    "Current Password",
    "New Password",
    "Confirm New Password",
    "autoComplete=\"current-password\"",
    "autoComplete=\"new-password\"",
    "isPasswordSaving",
    "Updating...",
    "hasPasswordIdentity(user)",
    "SOCIAL_PASSWORD_MESSAGE",
    "password-change-form"
  ]) {
    assert.match(dashboardSource, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(dashboardSource, /setCurrentPassword\(""\)[\s\S]*setNewPassword\(""\)[\s\S]*setConfirmNewPassword\(""\)/);
});
