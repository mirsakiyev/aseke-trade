import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/puzzleWindows.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const puzzleWindows = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

test("puzzle windows are grouped into four-hour UTC blocks", () => {
  assert.deepEqual(
    simplifyWindow(puzzleWindows.getCurrentPuzzleWindow(new Date("2026-06-12T00:30:00.000Z"))),
    {
      id: "2026-06-12-00",
      start: "2026-06-12T00:00:00.000Z",
      nextRefresh: "2026-06-12T04:00:00.000Z"
    }
  );

  assert.deepEqual(
    simplifyWindow(puzzleWindows.getCurrentPuzzleWindow(new Date("2026-06-12T03:59:59.000Z"))),
    {
      id: "2026-06-12-00",
      start: "2026-06-12T00:00:00.000Z",
      nextRefresh: "2026-06-12T04:00:00.000Z"
    }
  );

  assert.deepEqual(
    simplifyWindow(puzzleWindows.getCurrentPuzzleWindow(new Date("2026-06-12T04:00:00.000Z"))),
    {
      id: "2026-06-12-04",
      start: "2026-06-12T04:00:00.000Z",
      nextRefresh: "2026-06-12T08:00:00.000Z"
    }
  );
});

test("the final UTC puzzle window rolls to the next day at midnight", () => {
  assert.deepEqual(
    simplifyWindow(puzzleWindows.getCurrentPuzzleWindow(new Date("2026-06-12T23:15:00.000Z"))),
    {
      id: "2026-06-12-20",
      start: "2026-06-12T20:00:00.000Z",
      nextRefresh: "2026-06-13T00:00:00.000Z"
    }
  );
});

test("milliseconds remaining counts down to the next refresh", () => {
  assert.equal(
    puzzleWindows.millisecondsUntilNextPuzzleRefresh(new Date("2026-06-12T01:30:00.000Z")),
    9_000_000
  );
});

function simplifyWindow(window) {
  return {
    id: window.id,
    start: window.start.toISOString(),
    nextRefresh: window.nextRefresh.toISOString()
  };
}
