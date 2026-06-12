import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/avatarUrls.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const avatarUrls = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

test("avatar URL resolver keeps public URLs unchanged", () => {
  assert.equal(
    avatarUrls.resolvePublicAvatarUrl("https://example.com/avatar.png", "https://project.supabase.co"),
    "https://example.com/avatar.png"
  );
});

test("avatar URL resolver builds public storage URLs for relative avatar paths", () => {
  assert.equal(
    avatarUrls.resolvePublicAvatarUrl("user-id/avatar one.png", "https://project.supabase.co/"),
    "https://project.supabase.co/storage/v1/object/public/avatars/user-id/avatar%20one.png"
  );

  assert.equal(
    avatarUrls.resolvePublicAvatarUrl("avatars/user-id/profile.webp", "https://project.supabase.co"),
    "https://project.supabase.co/storage/v1/object/public/avatars/user-id/profile.webp"
  );
});

test("avatar URL resolver returns null for empty values", () => {
  assert.equal(avatarUrls.resolvePublicAvatarUrl(null, "https://project.supabase.co"), null);
  assert.equal(avatarUrls.resolvePublicAvatarUrl("   ", "https://project.supabase.co"), null);
});
