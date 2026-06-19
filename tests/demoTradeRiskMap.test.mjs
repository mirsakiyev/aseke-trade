import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/demoTradeRiskMap.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const riskMap = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

function marker(scale, label) {
  const item = scale.markers.find((entry) => entry.label === label);
  assert.ok(item, `${label} marker should exist`);
  return item;
}

function layout(layouts, label) {
  const item = layouts.find((entry) => entry.label === label);
  assert.ok(item, `${label} layout should exist`);
  return item;
}

function activeSpread(scale) {
  const activePercents = scale.markers.filter((entry) => entry.tone !== "liquidation").map((entry) => entry.percent);
  return Math.max(...activePercents) - Math.min(...activePercents);
}

function assertLaneSpacing(layouts) {
  const lanes = new Map();
  layouts.forEach((layout) => {
    const key = `${layout.placement}-${layout.lane}`;
    lanes.set(key, [...(lanes.get(key) ?? []), layout]);
  });

  lanes.forEach((laneMarkers) => {
    const sorted = laneMarkers.sort((a, b) => a.labelPercent - b.labelPercent);
    for (let index = 1; index < sorted.length; index += 1) {
      assert.ok(
        sorted[index].labelPercent - sorted[index - 1].labelPercent >= 11.99,
        `${sorted[index - 1].label} and ${sorted[index].label} should not overlap in the same lane`
      );
    }
  });
}

const longActiveMarkers = [
  { label: "SL", price: 62694, tone: "stop" },
  { label: "MARK", price: 62902, tone: "mark" },
  { label: "ENTRY", price: 62910, tone: "entry" },
  { label: "TP1", detailLabel: "50%", price: 63700, tone: "take-profit" },
  { label: "TP2", detailLabel: "50%", price: 63800, tone: "take-profit" }
];

test("far long liquidation uses a compressed left scale and keeps active prices readable", () => {
  const scale = riskMap.resolvePositionRiskScale([
    { label: "LIQ", price: 50581, tone: "liquidation" },
    ...longActiveMarkers
  ]);

  assert.equal(scale.mode, "compressed-left");
  assert.equal(marker(scale, "LIQ").percent, 8);
  assert.ok(activeSpread(scale) > 40);
  assert.ok(marker(scale, "ENTRY").percent > 40);
  assert.ok(marker(scale, "TP2").percent > 85);
  assertLaneSpacing(riskMap.resolveRiskMarkerLayouts(scale.markers));
});

test("middle-distance long liquidation keeps the normal linear scale", () => {
  const scale = riskMap.resolvePositionRiskScale([
    { label: "LIQ", price: 59650, tone: "liquidation" },
    ...longActiveMarkers
  ]);

  assert.equal(scale.mode, "linear");
  assert.ok(marker(scale, "LIQ").percent < marker(scale, "SL").percent);
  assert.ok(marker(scale, "ENTRY").percent < marker(scale, "TP1").percent);
  assertLaneSpacing(riskMap.resolveRiskMarkerLayouts(scale.markers));
});

test("close long liquidation keeps the normal linear scale", () => {
  const scale = riskMap.resolvePositionRiskScale([
    { label: "LIQ", price: 62000, tone: "liquidation" },
    ...longActiveMarkers
  ]);

  assert.equal(scale.mode, "linear");
  assert.ok(marker(scale, "LIQ").percent < marker(scale, "SL").percent);
  assert.ok(marker(scale, "MARK").percent < marker(scale, "TP1").percent);
  assertLaneSpacing(riskMap.resolveRiskMarkerLayouts(scale.markers));
});

test("stacked take-profit labels place higher target numbers above lower ones", () => {
  const scale = riskMap.resolvePositionRiskScale([
    { label: "LIQ", price: 50696, tone: "liquidation" },
    { label: "SL", price: 61500, tone: "stop" },
    { label: "ENTRY", price: 63053, tone: "entry" },
    { label: "MARK", price: 62916, tone: "mark" },
    { label: "TP1", detailLabel: "33.3%", price: 65555, tone: "take-profit" },
    { label: "TP2", detailLabel: "33.3%", price: 67000, tone: "take-profit" },
    { label: "TP3", detailLabel: "33.4%", price: 67000, tone: "take-profit" }
  ]);
  const layouts = riskMap.resolveRiskMarkerLayouts(scale.markers);

  assert.ok(layout(layouts, "TP3").lane < layout(layouts, "TP2").lane);
  assert.ok(layout(layouts, "TP2").lane < layout(layouts, "TP1").lane);
  assertLaneSpacing(layouts);
});

test("far short liquidation uses a compressed left scale so liquidation stays left", () => {
  const scale = riskMap.resolvePositionRiskScale([
    { label: "TP2", detailLabel: "50%", price: 61200, tone: "take-profit" },
    { label: "TP1", detailLabel: "50%", price: 61800, tone: "take-profit" },
    { label: "ENTRY", price: 62600, tone: "entry" },
    { label: "MARK", price: 62900, tone: "mark" },
    { label: "SL", price: 64000, tone: "stop" },
    { label: "LIQ", price: 75000, tone: "liquidation" }
  ]);

  assert.equal(scale.mode, "compressed-left");
  assert.equal(marker(scale, "LIQ").percent, 8);
  assert.ok(activeSpread(scale) > 40);
  assert.ok(marker(scale, "SL").percent < marker(scale, "ENTRY").percent);
  assert.ok(marker(scale, "ENTRY").percent < marker(scale, "TP1").percent);
  assert.ok(marker(scale, "TP1").percent < marker(scale, "TP2").percent);
  assertLaneSpacing(riskMap.resolveRiskMarkerLayouts(scale.markers));
});

test("close short liquidation keeps the normal scale but still renders liquidation left", () => {
  const scale = riskMap.resolvePositionRiskScale([
    { label: "TP2", detailLabel: "50%", price: 61200, tone: "take-profit" },
    { label: "TP1", detailLabel: "50%", price: 61800, tone: "take-profit" },
    { label: "ENTRY", price: 62600, tone: "entry" },
    { label: "MARK", price: 62900, tone: "mark" },
    { label: "SL", price: 64000, tone: "stop" },
    { label: "LIQ", price: 64800, tone: "liquidation" }
  ]);

  assert.equal(scale.mode, "linear");
  assert.ok(marker(scale, "LIQ").percent < marker(scale, "SL").percent);
  assert.ok(marker(scale, "SL").percent < marker(scale, "ENTRY").percent);
  assert.ok(marker(scale, "ENTRY").percent < marker(scale, "TP1").percent);
  assertLaneSpacing(riskMap.resolveRiskMarkerLayouts(scale.markers));
});
