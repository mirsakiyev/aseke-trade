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

function assertClose(actual, expected, tolerance = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be close to ${expected}`);
}

function autoPercentageInput(overrides) {
  return {
    symbol: "position",
    direction: "long",
    accountBalance: 1000,
    riskPercent: 10,
    entryPrice: 100,
    stopLossMode: "percentage",
    stopLossValue: 5,
    takeProfitMode: "percentage",
    takeProfitValues: [],
    leverage: 5,
    positionSizeMode: "auto",
    ...overrides
  };
}

test("same account risk and stop-loss percentage produces the same notional value for BTC and ETH", () => {
  const btc = calculateRisk(
    autoPercentageInput({
      symbol: "BTC/USDT",
      entryPrice: 64000
    })
  );
  const eth = calculateRisk(
    autoPercentageInput({
      symbol: "ETH/USDT",
      entryPrice: 1600
    })
  );

  assert.equal(btc.ok, true);
  assert.equal(eth.ok, true);

  assert.equal(btc.result.riskAmount, 100);
  assert.equal(btc.result.stopLossPrice, 60800);
  assert.equal(btc.result.stopLossPercent, 5);
  assert.equal(btc.result.notionalPositionValue, 2000);
  assert.equal(btc.result.positionSizeUnits, 0.03125);
  assert.equal(btc.result.marginRequired, 400);

  assert.equal(eth.result.riskAmount, 100);
  assert.equal(eth.result.stopLossPrice, 1520);
  assert.equal(eth.result.stopLossPercent, 5);
  assert.equal(eth.result.notionalPositionValue, 2000);
  assert.equal(eth.result.positionSizeUnits, 1.25);
  assert.equal(eth.result.marginRequired, 400);
});

test("entry 6 with 5 percent stop uses a 2000 dollar notional position", () => {
  const calculation = calculateRisk(
    autoPercentageInput({
      entryPrice: 6,
      stopLossValue: 5
    })
  );

  assert.equal(calculation.ok, true);
  assertClose(calculation.result.stopLossPrice, 5.7);
  assert.equal(calculation.result.riskAmount, 100);
  assert.equal(calculation.result.notionalPositionValue, 2000);
  assertClose(calculation.result.positionSizeUnits, 333.33333333);
});

test("entry 6 with stop price 5 derives a 16.67 percent stop and 600 dollar notional value", () => {
  const calculation = calculateRisk(
    autoPercentageInput({
      entryPrice: 6,
      stopLossMode: "price",
      stopLossValue: 5
    })
  );

  assert.equal(calculation.ok, true);
  assertClose(calculation.result.stopLossPercent, 16.66666667);
  assert.equal(calculation.result.riskAmount, 100);
  assertClose(calculation.result.notionalPositionValue, 600);
  assertClose(calculation.result.positionSizeUnits, 100);
});

test("short setup derives stop, take profit, profit, R multiple, and margin from percentages", () => {
  const calculation = calculateRisk(
    autoPercentageInput({
      direction: "short",
      entryPrice: 100,
      stopLossValue: 5,
      takeProfitValues: [10],
      leverage: 5
    })
  );

  assert.equal(calculation.ok, true);
  assert.equal(calculation.result.stopLossPrice, 105);
  assert.equal(calculation.result.takeProfits[0].price, 90);
  assert.equal(calculation.result.riskAmount, 100);
  assert.equal(calculation.result.notionalPositionValue, 2000);
  assert.equal(calculation.result.positionSizeUnits, 20);
  assert.equal(calculation.result.takeProfits[0].profitAmount, 200);
  assert.equal(calculation.result.takeProfits[0].riskReward, 2);
  assert.equal(calculation.result.marginRequired, 400);
});

test("insufficient margin keeps the risk-based result visible and marks the plan invalid", () => {
  const calculation = calculateRisk(
    autoPercentageInput({
      accountBalance: 1000,
      riskPercent: 100,
      entryPrice: 63000,
      stopLossMode: "price",
      stopLossValue: 62000,
      leverage: 5
    })
  );

  assert.equal(calculation.ok, true);
  assert.equal(calculation.result.riskAmount, 1000);
  assertClose(calculation.result.stopLossPercent, 1.58730159);
  assertClose(calculation.result.notionalPositionValue, 63000);
  assertClose(calculation.result.positionSizeUnits, 1);
  assertClose(calculation.result.marginRequired, 12600);
  assertClose(calculation.result.requiredLeverage, 63);
  assert.equal(calculation.result.isExecutable, false);
  assert.ok(calculation.result.warnings.includes("Invalid plan: insufficient margin."));
});

test("manual notional value equal to account balance shows actual loss instead of old max loss input", () => {
  const calculation = calculateRisk(
    autoPercentageInput({
      accountBalance: 1000,
      entryPrice: 63600,
      stopLossValue: 3,
      takeProfitValues: [10],
      leverage: 10,
      positionSizeMode: "manual",
      manualNotionalValue: 1000
    })
  );

  assert.equal(calculation.ok, true);
  assert.equal(calculation.result.positionSizeMode, "manual");
  assert.equal(calculation.result.notionalPositionValue, 1000);
  assertClose(calculation.result.positionSizeUnits, 0.01572327);
  assert.equal(calculation.result.stopLossPrice, 61692);
  assert.equal(calculation.result.stopLossPercent, 3);
  assert.equal(calculation.result.actualRiskAmount, 30);
  assert.equal(calculation.result.actualRiskPercent, 3);
  assert.equal(calculation.result.marginRequired, 100);
  assert.equal(calculation.result.marginUsedPercent, 10);
  assert.equal(calculation.result.marginShortfall, 0);
  assert.equal(calculation.result.takeProfits[0].price, 69960);
  assertClose(calculation.result.takeProfits[0].profitAmount, 100);
  assertClose(calculation.result.takeProfits[0].riskReward, 3.33333333);
  assert.equal(calculation.result.warnings.length, 0);
});

test("auto risk-based size with 100 percent max loss explains the larger notional value", () => {
  const calculation = calculateRisk(
    autoPercentageInput({
      accountBalance: 1000,
      riskPercent: 100,
      entryPrice: 63600,
      stopLossValue: 3,
      takeProfitValues: [10],
      leverage: 10
    })
  );

  assert.equal(calculation.ok, true);
  assert.equal(calculation.result.positionSizeMode, "auto");
  assert.equal(calculation.result.selectedRiskAmount, 1000);
  assert.equal(calculation.result.actualRiskPercent, 100);
  assertClose(calculation.result.notionalPositionValue, 33333.33333333);
  assertClose(calculation.result.positionSizeUnits, 0.52410901);
  assert.equal(calculation.result.stopLossPrice, 61692);
  assert.equal(calculation.result.stopLossPercent, 3);
  assertClose(calculation.result.marginRequired, 3333.33333333);
  assertClose(calculation.result.marginUsedPercent, 333.33333333);
  assertClose(calculation.result.requiredLeverage, 33.33333333);
  assertClose(calculation.result.marginShortfall, 2333.33333333);
  assert.equal(calculation.result.takeProfits[0].price, 69960);
  assertClose(calculation.result.takeProfits[0].profitAmount, 3333.33333333);
  assertClose(calculation.result.takeProfits[0].riskReward, 3.33333333);
  assert.ok(calculation.result.warnings.includes("Invalid plan: insufficient margin."));
  assert.ok(
    calculation.result.warnings.includes(
      "Extreme risk: this means you are willing to lose the full account balance if stop loss is hit."
    )
  );
});

test("auto mode with 3 percent max loss matches a 1000 dollar manual position at a 3 percent stop", () => {
  const calculation = calculateRisk(
    autoPercentageInput({
      accountBalance: 1000,
      riskPercent: 3,
      entryPrice: 63600,
      stopLossValue: 3,
      leverage: 10
    })
  );

  assert.equal(calculation.ok, true);
  assert.equal(calculation.result.selectedRiskAmount, 30);
  assertClose(calculation.result.notionalPositionValue, 1000);
  assertClose(calculation.result.positionSizeUnits, 0.01572327);
  assertClose(calculation.result.marginRequired, 100);
});

test("risk calculator rejects an invalid long stop price", () => {
  const calculation = calculateRisk(
    autoPercentageInput({
      stopLossMode: "price",
      stopLossValue: 101
    })
  );

  assert.equal(calculation.ok, false);
  assert.ok(calculation.errors.includes("For a long setup, stop loss must be below entry."));
});
