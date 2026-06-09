# ASEKE TRADE Crypto Payments

ASEKE TRADE uses non-custodial crypto payments for premium course/guide access and optional account balance deposits. Users send supported stablecoins to ASEKE TRADE receiving addresses, submit a transaction hash, and the app unlocks access or credits balance only after server-side on-chain verification.

## Supported Payments

- USDT on TRON TRC20
- USDT on Ethereum ERC20
- USDC on Ethereum ERC20

The app never asks for seed phrases or private keys, never stores private keys, and never creates custodial wallets for users.

## What Is Implemented

- Direct premium course/guide crypto purchase.
- Pending payment records with amount, asset, network, receive address, expiry, and status.
- User-submitted transaction hashes.
- Server-side on-chain verification through Supabase Edge Functions.
- Confirmed payments create purchase/access records.
- Account balance deposits.
- Balance purchases for premium course/guide access.
- Account balance ledger records.
- Admin payment review notes.
- Admin-managed receiving wallet rows with active/inactive status and notes.

## Database Setup Order

Run all migrations in order. If you use Supabase CLI:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

If you use Supabase SQL Editor, run these files in this order:

1. `supabase/migrations/202606030001_initial_schema.sql`
2. `supabase/migrations/202606050001_add_terms_accepted.sql`
3. `supabase/migrations/202606050002_rework_curriculum_guides.sql`
4. `supabase/migrations/202606090001_crypto_payments.sql`
5. `supabase/migrations/202606090002_crypto_balances_wallet_admin.sql`

Do not drop existing user, purchase, profile, or payment tables. The curriculum migration archives old content instead of deleting user/payment data.

Run `supabase/seed.sql` only for fresh local resets or new disposable databases. Do not run `supabase db reset` on production.

## First Admin User

Register normally, then promote your account in Supabase SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = (
  select id
  from auth.users
  where email = 'your-email@example.com'
);
```

Log out and log back in after changing the role.

## Supabase Edge Function Secrets

Add these with Supabase CLI:

```bash
supabase secrets set TRONGRID_API_KEY=YOUR_TRONGRID_API_KEY
supabase secrets set ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
supabase secrets set TRON_USDT_RECEIVE_ADDRESS=YOUR_TRON_TRC20_USDT_ADDRESS
supabase secrets set ETH_USDT_RECEIVE_ADDRESS=YOUR_ETHEREUM_ERC20_USDT_ADDRESS
supabase secrets set ETH_USDC_RECEIVE_ADDRESS=YOUR_ETHEREUM_ERC20_USDC_ADDRESS
supabase secrets set SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Supabase automatically provides `SUPABASE_URL` to Edge Functions.

Keep these out of Netlify:

- `SERVICE_ROLE_KEY`
- `TRONGRID_API_KEY`
- `ETHERSCAN_API_KEY`
- receiving wallet addresses

## Netlify Environment Variables

Netlify only needs browser-safe Supabase values:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

`VITE_SUPABASE_ANON_KEY` is also supported and takes precedence if both key variables exist.

After changing Netlify variables, trigger a fresh deploy.

## Edge Function Deployment

Deploy all payment functions:

```bash
supabase functions deploy create-crypto-payment
supabase functions deploy submit-crypto-tx
supabase functions deploy verify-crypto-payment
supabase functions deploy spend-account-balance
```

`create-crypto-payment`, `submit-crypto-tx`, and `spend-account-balance` require a signed-in Supabase user.

`verify-crypto-payment` is server-only and requires:

```txt
Authorization: Bearer YOUR_SERVICE_ROLE_KEY
```

## Admin Wallet Management

Open:

```txt
/admin/crypto-payments
```

Admins can add or edit receiving wallet rows:

- asset symbol
- network
- receiving address
- confirmation count
- active/inactive status
- notes

Only active wallet rows are used for new user payment/deposit invoices. The database allows only one active row per asset/network pair.

## User Pages

- `/checkout/:itemType/:itemId` - direct premium purchase checkout
- `/payment/:paymentId` - payment/deposit instructions and transaction submission
- `/account/payments` - account balance, deposit creation, payment history, ledger
- `/admin/crypto-payments` - admin payments and wallet management

## Verification Rules

Verification checks:

- transaction hash format
- transaction exists on-chain
- transaction succeeded
- token contract matches selected asset
- recipient matches invoice receive address
- amount is at least expected amount
- required confirmations are reached
- transaction hash was not already used

Confirmed direct purchases create `purchases` and `premium_access` rows. Confirmed deposits credit `account_balances` and create `account_balance_transactions` rows.

## Manual Test Checklist

- Admin user can open `/admin/crypto-payments`.
- Admin can add/update/deactivate receiving wallets.
- Non-admin cannot open admin crypto payment controls.
- User can create a pending premium purchase.
- User can create a pending account deposit.
- Payment page shows correct amount, asset, network, address, and expiry.
- Malformed transaction hash is rejected.
- Wrong-network or wrong-token transaction does not unlock access.
- Underpaid transaction becomes `underpaid`.
- Valid confirmed purchase becomes `confirmed` and unlocks content.
- Valid confirmed deposit becomes `confirmed` and credits balance.
- User can buy premium content with sufficient account balance.
- Balance purchase deducts balance and creates a ledger transaction.
- Insufficient balance purchase fails.
- Duplicate transaction hash is rejected.
- User cannot view another user's payments, deposits, balance, ledger, or purchases.

## Important Limitations

- The system assumes USDT/USDC are worth 1 USD for pricing and balance accounting.
- It does not handle exchange-rate conversion, refunds, chargebacks, or automatic sweeping.
- It does not store private keys or create user custodial wallets.
- Admin wallet changes affect only new payment intents, not already-created pending payments.
