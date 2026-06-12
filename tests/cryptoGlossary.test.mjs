import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const glossarySource = await readFile(new URL("../src/data/cryptoGlossary.ts", import.meta.url), "utf8");
const glossaryTranspiled = ts.transpileModule(glossarySource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const glossary = await import(`data:text/javascript;base64,${Buffer.from(glossaryTranspiled).toString("base64")}`);

test("crypto glossary includes the expected categories and core terms", () => {
  const categories = glossary.cryptoGlossaryCategories.map((category) => category.title);
  const terms = glossary.cryptoGlossaryCategories.flatMap((category) =>
    category.terms.map((term) => term.term)
  );

  assert.deepEqual(categories, [
    "Basics",
    "Trading",
    "Blockchain and DeFi",
    "Risk and Security",
    "Advanced Concepts"
  ]);

  assert.ok(terms.includes("Bitcoin"));
  assert.ok(terms.includes("Leverage"));
  assert.ok(terms.includes("Dirty Crypto"));
  assert.ok(terms.includes("MEV"));
});

test("crypto glossary route is linked from the footer and not the main nav", async () => {
  const layoutSource = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const navItemsBlock = layoutSource.match(/const navItems = \[[\s\S]*?\];/)?.[0] ?? "";

  assert.match(appSource, /path="crypto-glossary"/);
  assert.match(layoutSource, /<Link to="\/crypto-glossary">Crypto Glossary<\/Link>/);
  assert.equal(navItemsBlock.includes("crypto-glossary"), false);
});
