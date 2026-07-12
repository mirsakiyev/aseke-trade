import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const decimalSource = await readFile(new URL("../src/lib/aiFuturesDecimal.ts", import.meta.url), "utf8");
const riskSource = await readFile(new URL("../src/lib/aiFuturesRisk.ts", import.meta.url), "utf8");
const tempDir = await mkdtemp(join(tmpdir(), "ai-futures-risk-"));
const decimalPath = join(tempDir, "aiFuturesDecimal.mjs");
const riskPath = join(tempDir, "aiFuturesRisk.mjs");

await writeFile(decimalPath, transpile(decimalSource));
await writeFile(
  riskPath,
  transpile(riskSource).replace(/from "\.\/aiFuturesDecimal(?:\.ts)?"/g, 'from "./aiFuturesDecimal.mjs"')
);

const decimal = await import(pathToFileURL(decimalPath));
const risk = await import(pathToFileURL(riskPath));

after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
}

function baseInput(overrides = {}) {
  return {
    direction: "long",
    planningBalance: "1000",
    riskPercent: "1",
    entryPrice: "100",
    stopLossPrice: "90",
    entryFeePercent: "0.1",
    exitFeePercent: "0.1",
    slippageBufferPercent: "0.1",
    maximumMarginPercent: "50",
    leverage: 5,
    maximumLeverage: 10,
    quantityStep: "0.01",
    priceTickSize: "0.1",
    minimumQuantity: "0.01",
    minimumNotional: "5",
    maintenanceMarginPercent: "0.5",
    ...overrides
  };
}

test("long risk plan includes fees, slippage, step rounding, and an estimated isolated liquidation price", () => {
  const result = risk.calculateAiFuturesRiskPlan(baseInput());

  assert.equal(result.status, "OK");
  assert.equal(result.plan.riskBudget, "10");
  assert.equal(result.plan.lossFraction, "0.103");
  assert.equal(result.plan.quantity, "0.97");
  assert.equal(result.plan.positionNotional, "97");
  assert.equal(result.plan.requiredIsolatedMargin, "19.4");
  assert.equal(result.plan.stopLossAmount, "9.7");
  assert.equal(result.plan.estimatedEntryFee, "0.097");
  assert.equal(result.plan.estimatedExitFee, "0.097");
  assert.equal(result.plan.estimatedSlippageLoss, "0.097");
  assert.equal(result.plan.maximumPlannedLoss, "9.991");
  assert.equal(result.plan.estimatedLiquidationPrice, "80.5");
});

test("short risk plan uses short-side stop and conservative liquidation rounding", () => {
  const result = risk.calculateAiFuturesRiskPlan(baseInput({
    direction: "short",
    stopLossPrice: "110"
  }));

  assert.equal(result.status, "OK");
  assert.equal(result.plan.quantity, "0.97");
  assert.equal(result.plan.maximumPlannedLoss, "9.991");
  assert.equal(result.plan.estimatedLiquidationPrice, "119.4");
  assert.ok(Number(result.plan.estimatedLiquidationPrice) > Number(result.plan.stopLossPrice));
});

test("entry and stop prices use adverse tick rounding before quantity is floored to the exchange step", () => {
  const result = risk.calculateAiFuturesRiskPlan(baseInput({
    entryPrice: "100.04",
    stopLossPrice: "90.06",
    entryFeePercent: "0",
    exitFeePercent: "0",
    slippageBufferPercent: "0",
    quantityStep: "0.03",
    minimumQuantity: "0.03",
    minimumNotional: "0"
  }));

  assert.equal(result.status, "OK");
  assert.equal(result.plan.entryPrice, "100.1");
  assert.equal(result.plan.stopLossPrice, "90");
  assert.equal(result.plan.quantity, "0.99");
  assert.equal(result.plan.positionNotional, "99.099");
  assert.equal(result.plan.maximumPlannedLoss, "9.999");

  const parsedQuantity = decimal.parseDecimal(result.plan.quantity);
  const parsedStep = decimal.parseDecimal("0.03");
  assert.equal(decimal.decimalIsStepMultiple(parsedQuantity, parsedStep), true);
});

test("maximum margin allocation caps notional without multiplying the risk budget by leverage", () => {
  const result = risk.calculateAiFuturesRiskPlan(baseInput({
    riskPercent: "10",
    stopLossPrice: "99",
    entryFeePercent: "0",
    exitFeePercent: "0",
    slippageBufferPercent: "0",
    maximumMarginPercent: "2",
    leverage: 2,
    quantityStep: "0.1",
    minimumQuantity: "0.1",
    minimumNotional: "0"
  }));

  assert.equal(result.status, "OK");
  assert.equal(result.plan.riskBudget, "100");
  assert.equal(result.plan.maximumMarginAmount, "20");
  assert.equal(result.plan.marginLimitedNotional, "40");
  assert.equal(result.plan.positionNotional, "40");
  assert.equal(result.plan.requiredIsolatedMargin, "20");
  assert.equal(result.plan.maximumPlannedLoss, "0.4");
});

test("leverage must be an integer within both configured and absolute bounds", () => {
  for (const leverage of [0, 2.5, 11, 101, Number.POSITIVE_INFINITY]) {
    const result = risk.calculateAiFuturesRiskPlan(baseInput({ leverage }));
    assert.equal(result.status, "INVALID_INPUT", `leverage ${leverage} should be invalid`);
  }

  const invalidMaximum = risk.calculateAiFuturesRiskPlan(baseInput({ maximumLeverage: 101 }));
  assert.equal(invalidMaximum.status, "INVALID_INPUT");
});

test("tiny planning balances return RISK_LIMIT_EXCEEDED when quantity floors to zero", () => {
  const result = risk.calculateAiFuturesRiskPlan(baseInput({
    planningBalance: "1",
    riskPercent: "0.5",
    entryPrice: "60000",
    stopLossPrice: "59000",
    entryFeePercent: "0",
    exitFeePercent: "0",
    slippageBufferPercent: "0",
    leverage: 3,
    quantityStep: "0.001",
    minimumQuantity: "0.001",
    priceTickSize: "0.1"
  }));

  assert.equal(result.status, "RISK_LIMIT_EXCEEDED");
  assert.equal(result.reason, "QUANTITY_ROUNDED_TO_ZERO");
});

test("large decimal-string balances remain exact", () => {
  const result = risk.calculateAiFuturesRiskPlan(baseInput({
    planningBalance: "1000000000000",
    riskPercent: "2",
    entryPrice: "60000",
    stopLossPrice: "59000",
    entryFeePercent: "0",
    exitFeePercent: "0",
    slippageBufferPercent: "0",
    leverage: 10,
    maximumLeverage: 10,
    maximumMarginPercent: "50",
    quantityStep: "0.001",
    minimumQuantity: "0.001",
    minimumNotional: "5",
    priceTickSize: "0.1"
  }));

  assert.equal(result.status, "OK");
  assert.equal(result.plan.riskBudget, "20000000000");
  assert.equal(result.plan.quantity, "19999999.999");
  assert.equal(result.plan.positionNotional, "1199999999940");
  assert.equal(result.plan.maximumPlannedLoss, "19999999999");
  assert.ok(BigInt(result.plan.maximumPlannedLoss) <= 20_000_000_000n);
});

test("non-finite, malformed, and over-precision inputs are rejected honestly", () => {
  for (const planningBalance of [Number.NaN, Number.POSITIVE_INFINITY, "1e3", " 1000", "1.0000000000000000001"]) {
    const result = risk.calculateAiFuturesRiskPlan(baseInput({ planningBalance }));
    assert.equal(result.status, "INVALID_INPUT", `${String(planningBalance)} should be invalid`);
  }
});

test("prices that round to zero at the exchange tick are rejected", () => {
  const result = risk.calculateAiFuturesRiskPlan(baseInput({
    entryPrice: "0.15",
    stopLossPrice: "0.05",
    priceTickSize: "0.1",
    minimumNotional: "0"
  }));

  assert.equal(result.status, "INVALID_INPUT");
  assert.ok(result.errors.some((error) => error.includes("after tick rounding")));
});

test("estimated liquidation before the planned stop returns RISK_LIMIT_EXCEEDED", () => {
  const result = risk.calculateAiFuturesRiskPlan(baseInput({
    stopLossPrice: "90",
    entryFeePercent: "0",
    exitFeePercent: "0",
    slippageBufferPercent: "0",
    leverage: 100,
    maximumLeverage: 100
  }));

  assert.equal(result.status, "RISK_LIMIT_EXCEEDED");
  assert.equal(result.reason, "LIQUIDATION_BEFORE_STOP");
});
