# ASEKE TRADE Crypto Payments

ASEKE TRADE uses non-custodial crypto payments for educational course and guide access. Users send supported stablecoins to fixed ASEKE TRADE receiving addresses, submit a transaction hash, and premium access is unlocked only after server-side on-chain verification.

## Supported Payments

- USDT on TRON TRC20
- USDT on Ethereum ERC20
- USDC on Ethereum ERC20

Do not use this system as a custodial wallet. The app never asks for seed phrases or private keys, never stores private keys, and never accepts native ETH or TRX as payment for USDT/USDC invoices.

## Supabase Secrets

Configure these as Supabase Edge Function secrets:

```bash
supabase secrets set TRONGRID_API_KEY=...
supabase secrets set ETHERSCAN_API_KEY=...
supabase secrets set TRON_USDT_RECEIVE_ADDRESS=...
supabase secrets set ETH_USDT_RECEIVE_ADDRESS=...
supabase secrets set ETH_USDC_RECEIVE_ADDRESS=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
```

Supabase automatically provides `SUPABASE_URL` to Edge Functions. Keep `SUPABASE_SERVICE_ROLE_KEY`, `TRONGRID_API_KEY`, and `ETHERSCAN_API_KEY` out of Netlify browser environment variables.

Netlify should only contain frontend-safe values such as:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Database

Run the migration:

```bash
supabase db push
```

The migration creates:

- `crypto_payment_methods`
- `crypto_payments`
- `premium_access`

It also seeds inactive method rows. The Edge Functions sync those rows with real receiving addresses from Supabase secrets and activate only configured methods.

## Edge Functions

Deploy:

```bash
supabase functions deploy create-crypto-payment
supabase functions deploy submit-crypto-tx
supabase functions deploy verify-crypto-payment
```

`create-crypto-payment` and `submit-crypto-tx` require a signed-in Supabase user. `verify-crypto-payment` is server-only and requires `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.

Verification checks:

- Transaction exists
- Transaction succeeded
- Token contract matches the selected asset
- Recipient matches the invoice receiving address
- Amount is at least the expected stablecoin amount
- Required confirmations are reached
- Transaction hash has not already confirmed another payment

The implementation follows the official TRON transaction confirmation and transaction-info APIs and Etherscan API V2 transaction receipt/proxy APIs:

- [TRON transaction confirmation](https://developers.tron.network/docs/tron-protocol-transaction)
- [TRON get transaction info by ID](https://developers.tron.network/reference/gettransactioninfobyid)
- [Etherscan API V2](https://docs.etherscan.io/introduction)
- [Etherscan eth_getTransactionReceipt](https://docs.etherscan.io/api-reference/endpoint/ethgettransactionreceipt)

## Pages

- `/checkout/:itemType/:itemId`
- `/payment/:paymentId`
- `/account/payments`
- `/admin/crypto-payments`

## Manual Test Checklist

- User creates a payment for a premium course.
- User sees the configured address for USDT TRC20, USDT ERC20, and USDC ERC20.
- User submits a malformed transaction hash and receives an error.
- User submits a wrong-network transaction hash and the payment is not confirmed.
- User submits an underpaid transaction and payment becomes `underpaid`.
- User submits a valid transaction and payment becomes `confirmed`.
- User cannot use the same transaction hash to unlock a second payment.
- User receives `premium_access` and a matching `purchases` row after confirmation.
- Expired payments cannot accept a new transaction hash through normal user flow.
- Non-authenticated users cannot create payment intents.
- Users cannot view another user’s crypto payment.
- Admins can filter crypto payments and save review notes.
- Admins cannot confirm payments from the admin UI.
