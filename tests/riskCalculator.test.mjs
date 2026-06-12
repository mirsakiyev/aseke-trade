import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/riskCalculator.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const riskCalculatorModule = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
);
const { calculateRisk } = riskCalculatorModule;

test("risk calculator sizes a long setup from account risk", () => {
  const calculation = calculateRisk({
    symbol: "btc/usdt",
    direction: "long",
    accountBalance: 1000,
    riskPercent: 1,
    entryPrice: 100,
    stopLossPrice: 90,
    takeProfitPrices: [120],
    leverage: 5,
    positionSizeMode: "auto"
  });

  assert.equal(calculation.ok, true);
  assert.equal(calculation.result.symbol, "BTC/USDT");
  assert.equal(calculation.result.riskAmount, 10);
  assert.equal(calculation.result.accountRiskPercent, 1);
  assert.equal(calculation.result.positionSizeUnits, 1);
  assert.equal(calculation.result.notionalPositionValue, 100);
  assert.equal(calculation.result.marginRequired, 20);
  assert.equal(calculation.result.positionRiskPercent, 10);
  assert.equal(calculation.result.marginUsedPercent, 2);
  assert.equal(calculation.result.takeProfits[0].profitAmount, 20);
  assert.equal(calculation.result.takeProfits[0].riskReward, 2);
});

test("risk calculator supports short setups", () => {
  const calculation = calculateRisk({
    symbol: "ETH/USDT",
    direction: "short",
    accountBalance: 1000,
    riskPercent: 1,
    entryPrice: 100,
    stopLossPrice: 110,
    takeProfitPrices: [80],
    leverage: 10,
    positionSizeMode: "auto"
  });

  assert.equal(calculation.ok, true);
  assert.equal(calculation.result.positionSizeUnits, 1);
  assert.equal(calculation.result.takeProfits[0].profitAmount, 20);
  assert.equal(calculation.result.takeProfits[0].riskReward, 2);
});

test("risk calculator warns when manual size exceeds selected risk", () => {
  const calculation = calculateRisk({
    symbol: "BTC/USDT",
    direction: "long",
    accountBalance: 1000,
    riskPercent: 1,
    entryPrice: 100,
    stopLossPrice: 90,
    takeProfitPrices: [120],
    leverage: 5,
    positionSizeMode: "manual",
    manualPositionSize: 2
  });

  assert.equal(calculation.ok, true);
  assert.equal(calculation.result.estimatedLoss, 20);
  assert.ok(calculation.result.warnings.includes("Manual size risks more than the selected account risk."));
});

test("risk calculator rejects an invalid long stop", () => {
  const calculation = calculateRisk({
    symbol: "BTC/USDT",
    direction: "long",
    accountBalance: 1000,
    riskPercent: 1,
    entryPrice: 100,
    stopLossPrice: 101,
    takeProfitPrices: [120],
    leverage: 5,
    positionSizeMode: "auto"
  });

  assert.equal(calculation.ok, false);
  assert.ok(calculation.errors.includes("For a long setup, stop loss must be below entry."));
});
