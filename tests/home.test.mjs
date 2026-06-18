import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const homeSource = await readFile(new URL("../src/pages/Home.tsx", import.meta.url), "utf8");

test("homepage market showcase promotes Trading Academy signals", () => {
  assert.match(homeSource, /Trading Academy Signals/);
  assert.match(homeSource, /\/assets\/home-trading-signal\.png/);
  assert.match(homeSource, /Get educational trade signals with Academy access/);
  assert.match(homeSource, /Active Signals/);
  assert.match(homeSource, /TP \/ SL Updates/);
  assert.match(homeSource, /Past Trades/);
  assert.match(homeSource, /className="primary-button compact market-signal-cta"/);
  assert.doesNotMatch(homeSource, /Understand the market before risking capital/);
});
