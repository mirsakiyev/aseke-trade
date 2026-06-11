import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/levels.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const levels = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

test("XP required for each level increases by 20% and rounds", () => {
  assert.equal(levels.getXPRequiredForNextLevel(1), 100);
  assert.equal(levels.getXPRequiredForNextLevel(2), 120);
  assert.equal(levels.getXPRequiredForNextLevel(3), 144);
  assert.equal(levels.getXPRequiredForNextLevel(4), 173);
});

test("level is calculated from cumulative XP thresholds", () => {
  assert.equal(levels.getLevelFromXP(0), 1);
  assert.equal(levels.getLevelFromXP(99), 1);
  assert.equal(levels.getLevelFromXP(100), 2);
  assert.equal(levels.getLevelFromXP(219), 2);
  assert.equal(levels.getLevelFromXP(220), 3);
  assert.equal(levels.getLevelFromXP(363), 3);
  assert.equal(levels.getLevelFromXP(364), 4);
});

test("progress reports the current level window", () => {
  assert.deepEqual(levels.getProgressToNextLevel(220), {
    level: 3,
    totalXP: 220,
    currentLevelStartXP: 220,
    nextLevelStartXP: 364,
    xpIntoLevel: 0,
    xpRequiredForNextLevel: 144,
    xpRemainingForNextLevel: 144,
    progressPercent: 0
  });

  assert.deepEqual(levels.getProgressToNextLevel(292), {
    level: 3,
    totalXP: 292,
    currentLevelStartXP: 220,
    nextLevelStartXP: 364,
    xpIntoLevel: 72,
    xpRequiredForNextLevel: 144,
    xpRemainingForNextLevel: 72,
    progressPercent: 50
  });
});
