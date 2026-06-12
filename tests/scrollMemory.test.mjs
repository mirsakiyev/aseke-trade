import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const layoutSource = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
const scrollMemorySource = await readFile(new URL("../src/components/ScrollMemory.tsx", import.meta.url), "utf8");

test("layout installs site-wide scroll memory", () => {
  assert.match(layoutSource, /import \{ ScrollMemory \} from "\.\/ScrollMemory"/);
  assert.match(layoutSource, /<ScrollMemory \/>/);
});

test("scroll memory restores positions when users return to a tab", () => {
  assert.match(scrollMemorySource, /const scrollPositions = new Map/);
  assert.match(scrollMemorySource, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(scrollMemorySource, /window\.addEventListener\("focus", restoreCurrentScroll\)/);
  assert.match(scrollMemorySource, /window\.history\.scrollRestoration = "manual"/);
  assert.match(scrollMemorySource, /restoreDurationMs/);
  assert.match(scrollMemorySource, /isRestoringRef/);
  assert.match(scrollMemorySource, /saveCurrentScroll\(true\)/);
  assert.match(scrollMemorySource, /document\.visibilityState !== "visible"/);
});
