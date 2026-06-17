import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const sharedPaymentsSource = await readFile(
  new URL("../supabase/functions/_shared/crypto-payments.ts", import.meta.url),
  "utf8"
);
const createPaymentSource = await readFile(
  new URL("../supabase/functions/create-crypto-payment/index.ts", import.meta.url),
  "utf8"
);
const submitTxSource = await readFile(
  new URL("../supabase/functions/submit-crypto-tx/index.ts", import.meta.url),
  "utf8"
);
const securityMigration = await readFile(
  new URL("../supabase/migrations/20260616235000_crypto_payment_claim_security.sql", import.meta.url),
  "utf8"
);
const balanceMigration = await readFile(
  new URL("../supabase/migrations/202606090002_crypto_balances_wallet_admin.sql", import.meta.url),
  "utf8"
);
const combinedPaymentMigrations = `${balanceMigration}\n${securityMigration}`;

test("crypto payment creation binds shared-wallet intents to a server-selected exact amount", () => {
  assert.match(createPaymentSource, /getAuthenticatedUser\(request,\s*supabase\)/);
  assert.match(createPaymentSource, /user_id:\s*user\.id/);
  assert.doesNotMatch(createPaymentSource, /user_id:\s*body\.user_id|body\.userId/);
  assert.match(createPaymentSource, /reserveUniqueExpectedAmount\(supabase,\s*method\.row,\s*method\.config,\s*item\.expectedAmount\)/);
  assert.match(createPaymentSource, /expected_amount:\s*reservedAmount\.expectedAmount/);
  assert.match(createPaymentSource, /amount_nonce_units:\s*reservedAmount\.amountNonceUnits/);
  assert.match(sharedPaymentsSource, /Shared receiving wallets cannot prove ownership from a tx hash alone/);
});

test("crypto payment migration replaces unsafe tx-hash ownership with processed event uniqueness", () => {
  assert.match(securityMigration, /drop index if exists public\.crypto_payments_tx_hash_unique_idx/i);
  assert.match(securityMigration, /create table if not exists public\.crypto_processed_transactions/i);
  assert.match(securityMigration, /unique\s*\(\s*network,\s*tx_hash,\s*event_index\s*\)/i);
  assert.match(securityMigration, /create unique index if not exists crypto_payments_active_expected_amount_unique_idx/i);
  assert.match(securityMigration, /payment_method_id,\s*receive_address,\s*asset,\s*network,\s*expected_amount/i);
  assert.match(securityMigration, /create table if not exists public\.crypto_payment_claim_attempts/i);
  assert.match(securityMigration, /for update/i);
});

test("transaction hash submission is authenticated, rate-limited, audited, and not ownership proof", () => {
  assert.match(submitTxSource, /getAuthenticatedUser\(request,\s*supabase\)/);
  assert.match(submitTxSource, /\.eq\("user_id",\s*user\.id\)/);
  assert.match(submitTxSource, /enforceCryptoClaimRateLimit\(supabase,\s*user\.id\)/);
  assert.match(submitTxSource, /logCryptoClaimAttempt/);
  assert.match(submitTxSource, /raw tx hash is public data/i);
  assert.doesNotMatch(submitTxSource, /\.from\("crypto_payments"\)[\s\S]*\.eq\("tx_hash",\s*txHash\)[\s\S]*\.neq\("id",\s*payment\.id\)/);
});

test("verifier rejects copied hashes unless the on-chain token event exactly matches the intent", () => {
  assert.match(sharedPaymentsSource, /payment\.network === "TRC20"\s*\?\s*await verifyTronPayment\(payment,\s*method\)\s*:\s*await verifyEthereumPayment\(payment,\s*method\)/);
  assert.match(sharedPaymentsSource, /String\(receipt\.status\)\.toLowerCase\(\) !== "0x1"/);
  assert.match(sharedPaymentsSource, /String\(txInfo\.receipt\?\.result \?\? ""\)\.toUpperCase\(\) !== "SUCCESS"/);
  assert.match(sharedPaymentsSource, /String\(log\.address \?\? ""\)\.toLowerCase\(\) !== tokenAddress/);
  assert.match(sharedPaymentsSource, /topics\[2\] !== recipientTopic/);
  assert.match(sharedPaymentsSource, /const exactTransfer = transferEvents\.find\(\(event\) => event\.units === expectedUnits\)/);
  assert.doesNotMatch(sharedPaymentsSource, /receivedUnits\s*>=\s*expectedUnits|receivedUnits\s*<\s*expectedUnits[\s\S]*return\s*\{\s*status:\s*"valid"/);
});

test("verifier handles duplicate races, insufficient confirmations, and multiple transfer events safely", () => {
  assert.match(sharedPaymentsSource, /\.from\("crypto_processed_transactions"\)\.insert/);
  assert.match(sharedPaymentsSource, /if \(error\.code === "23505"\) return false/);
  assert.match(sharedPaymentsSource, /return updatePaymentStatus\(supabase,\s*payment\.id,\s*"duplicate"/);
  assert.match(sharedPaymentsSource, /confirmations < method\.minConfirmations/);
  assert.match(sharedPaymentsSource, /return updatePaymentStatus\(supabase,\s*payment\.id,\s*verification\.receivedAmount \? "confirming" : "verifying"/);
  assert.match(sharedPaymentsSource, /for \(const \[index,\s*log\] of logs\.entries\(\)\)/);
  assert.match(sharedPaymentsSource, /eventIndexFromLog\(log,\s*index\)/);
});

test("invalid, expired, wrong amount, wrong recipient, and wrong token claims are not credited", () => {
  assert.match(submitTxSource, /new Date\(payment\.expires_at\)\.getTime\(\) < Date\.now\(\)/);
  assert.match(submitTxSource, /status:\s*"expired"/);
  assert.match(sharedPaymentsSource, /return updatePaymentStatus\(supabase,\s*payment\.id,\s*"underpaid"/);
  assert.match(sharedPaymentsSource, /return updatePaymentStatus\(supabase,\s*payment\.id,\s*"overpaid"/);
  assert.match(sharedPaymentsSource, /return updatePaymentStatus\(supabase,\s*payment\.id,\s*"rejected"/);
  assert.match(securityMigration, /status not in \('confirmed', 'credited'\)/i);
  assert.match(combinedPaymentMigrations, /account_balance_transactions_deposit_payment_unique_idx/i);
});
