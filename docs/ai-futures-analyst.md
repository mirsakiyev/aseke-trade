# AI Futures Analyst

AI Futures Analyst is a protected Trading Academy feature for educational BTCUSDT perpetual-futures analysis. It analyzes closed Binance USD-M Futures candles, may ask OpenAI to review a deterministic candidate, applies a final deterministic risk validator, and can prefill an isolated-margin practice order in Demo Trade.

It does **not** connect to an exchange account, accept exchange credentials, execute a trade, or treat a planning balance as funds held by ASEKE TRADE. Every result is educational analysis, not financial advice.

The implementation is intentionally safe on first deployment:

- `feature_enabled = false`
- `shadow_mode = true`
- `ai_calls_enabled = false`
- `allow_deterministic_only = false`
- `emergency_kill_switch = false`

Applying the migration therefore does not expose analysis to users or start paid AI calls. This repository contains the migration and deployment configuration only; the instructions below must be run against the intended Supabase project. Do not assume they have already been applied remotely.

## V1 scope

- Symbol: `BTCUSDT` perpetual only
- Market provider: Binance USD-M Futures only
- Entry timeframe: closed 15-minute candles
- Context timeframes: closed 1-hour and 4-hour candles
- Style: intraday
- Margin model: isolated only
- Contextual sentiment: Alternative.me Bitcoin Fear & Greed Index
- No news or social-media sentiment
- No spot-price or alternate-exchange fallback
- No automatic or real trading

The possible user-facing states are `NO_TRADE`, `WAIT_FOR_ENTRY`, `LONG_SETUP`, `SHORT_SETUP`, `DATA_UNAVAILABLE`, and `RISK_LIMIT_EXCEEDED`. The engine is expected to return no trade when its evidence or risk constraints are insufficient.

## Architecture

The request path is:

1. The lazy-loaded page at `/trading-academy/ai-futures-analyst` is guarded by the existing authentication and Trading Academy route protection.
2. `ai-futures-analyze` verifies the bearer token with Supabase Auth. It then calls the service-only Academy access helper; it does not trust client profile fields.
3. The database atomically applies the feature state, emergency switch, idempotency key, minimum refresh period, and per-user rate limit.
4. The shared orchestrator reuses the market snapshot and setup for the current closed 15-minute candle and engine/config version. A lease prevents concurrent duplicate setup generation.
5. The server-only market adapter fetches normalized Binance USD-M data and Alternative.me sentiment. It rejects missing, malformed, or stale required data and never substitutes spot data.
6. Pure TypeScript engines calculate indicators and market features, score deterministic long and short candidates, and produce entry, stop, targets, invalidation, and expiration.
7. If enabled, the OpenAI Responses API reviews the deterministic candidate with a strict Structured Outputs JSON schema. The model receives common market features and the candidate, not exchange credentials or a chart screenshot. It cannot introduce prices or position sizing.
8. The final deterministic validator rechecks freshness, snapshot identity, price ordering, reward-to-risk, target allocations, leverage, margin, fees/slippage, quantity rounding, maximum loss, estimated liquidation safety, and Academy access.
9. User-specific planning is deterministic and stored in `ai_user_trade_plans`; it does not require another AI call per balance.
10. `ai-futures-plan` reauthorizes the user and returns only that user's unexpired, approved practice plan to Demo Trade. Demo Trade prefills its form but never submits an order automatically or overwrites an existing position.

Two server-only background functions support shared generation and honest outcome tracking:

- `ai-futures-pipeline` checks for the newest closed analysis candle and creates or reuses one shared snapshot/setup.
- `ai-futures-outcomes` leases active setup outcomes, reads subsequent closed one-minute Binance USD-M candles, and saves transitions/events atomically and idempotently. Historical data before setup creation is not used for scoring an outcome.

The reusable chart component remains read-only on the Analyst page. Demo Trade and AI analysis are lazy-loaded so the regular application bundle does not eagerly load the chart or analyst code.

## Important files

| Area | Location |
| --- | --- |
| Protected user page | `src/pages/AiFuturesAnalyst.tsx` |
| Admin monitor | `src/pages/AdminAiFuturesAnalyst.tsx` |
| Shared candlestick chart | `src/components/FuturesCandlestickChart.tsx` |
| Browser API adapter | `src/lib/aiFuturesApi.ts` |
| Deterministic features/setup/validation | `src/lib/aiFuturesFeatures.ts`, `src/lib/aiFuturesSetup.ts`, `src/lib/aiFuturesValidator.ts` |
| Decimal-safe sizing | `src/lib/aiFuturesDecimal.ts`, `src/lib/aiFuturesRisk.ts` |
| Outcome engine | `src/lib/aiFuturesOutcome.ts` |
| Server providers and orchestration | `supabase/functions/_shared/ai-futures-*.ts` |
| User Edge Functions | `supabase/functions/ai-futures-analyze`, `supabase/functions/ai-futures-plan` |
| Cron Edge Functions | `supabase/functions/ai-futures-pipeline`, `supabase/functions/ai-futures-outcomes` |
| Schema, RLS, RPCs, Vault Cron | `supabase/migrations/202607120002_ai_futures_analyst.sql` |

## Providers and failure policy

### Binance USD-M Futures

The market adapter uses public endpoints under `https://fapi.binance.com` for:

- 15m, 1h, and 4h BTCUSDT OHLCV
- mark price, index price, and funding
- open-interest history and change
- global and top-trader long/short ratios
- taker buy/sell ratio
- exchange price, quantity, and notional filters

No Binance API key is required or supported in v1. Requests run server-side with an 8-second timeout and at most two attempts. Required responses are structurally validated. There is no silent Binance spot, Binance.US, Coinbase, or other-exchange fallback.

### Alternative.me Fear & Greed

The adapter reads `https://api.alternative.me/fng/?limit=2&format=json`. The user page attributes the displayed context to the [Alternative.me Crypto Fear & Greed Index](https://alternative.me/crypto/fear-and-greed-index/). The value is slow contextual sentiment, not an immediate entry trigger.

### OpenAI

The reviewer calls `https://api.openai.com/v1/responses` from an Edge Function and requests a strict JSON-schema response. See the official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) and [Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create).

The initial database configuration uses `gpt-5.6`, but the active immutable configuration row's `model_name` is authoritative for the orchestrated pipeline. `AI_ANALYSIS_MODEL` is an optional server-side fallback for direct use of the shared reviewer; it is not a browser variable and should not be used as a substitute for versioning the active admin configuration.

If OpenAI is missing, times out, refuses, or violates the schema, the failure is logged. The system returns unavailable unless the active configuration explicitly permits a clearly labelled deterministic-only result. AI output can approve, downgrade, or reject a candidate; it cannot loosen a deterministic rule or add numeric trading claims.

## Environment variables and secrets

### Browser and Netlify

The existing frontend variables remain the only browser-safe values:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

`VITE_SUPABASE_ANON_KEY` is also supported by the existing client and takes precedence when present. Never add OpenAI, Cron, or service-role secrets to a variable beginning with `VITE_` or to Netlify's client bundle.

### Supabase Edge Functions

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project API URL. Supabase injects this in hosted Edge Functions. |
| `SERVICE_ROLE_KEY` | Yes | Exact server-only secret name used by all four AI functions. `SUPABASE_SERVICE_ROLE_KEY` is not a replacement in this feature. |
| `OPENAI_API_KEY` | When `ai_calls_enabled` is true | Server-only OpenAI credential. |
| `AI_ANALYSIS_MODEL` | No | Shared reviewer fallback; the active database config's `model_name` is used by the main pipeline. |
| `AI_CRON_SECRET` | For both Cron functions | Independent high-entropy value checked in `x-ai-cron-secret`. Do not reuse the service-role key. |
| `AI_ALLOWED_ORIGINS` | Recommended | Comma-separated browser origins, with no trailing paths. Example: `https://aseketrade.com,https://www.aseketrade.com`. |
| `AI_OUTCOME_BATCH_LIMIT` | No | Positive outcome batch size; defaults to `100` and the database claim caps it at `500`. |

Binance and Alternative.me use public data, so there is no `BINANCE_API_KEY` or sentiment-provider key.

Set hosted secrets without putting literal values in source control:

```bash
export SUPABASE_SERVICE_ROLE_KEY_VALUE='copy-from-Supabase-dashboard'
export OPENAI_API_KEY_VALUE='copy-from-OpenAI'
export AI_CRON_SECRET_VALUE="$(openssl rand -hex 32)"

npx supabase@latest secrets set \
  SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY_VALUE" \
  OPENAI_API_KEY="$OPENAI_API_KEY_VALUE" \
  AI_CRON_SECRET="$AI_CRON_SECRET_VALUE" \
  AI_ALLOWED_ORIGINS='https://aseketrade.com,https://www.aseketrade.com' \
  AI_OUTCOME_BATCH_LIMIT='100'
```

Keep the generated Cron value available long enough to store the identical value in Supabase Vault. Clear the shell variables afterward:

```bash
unset SUPABASE_SERVICE_ROLE_KEY_VALUE OPENAI_API_KEY_VALUE AI_CRON_SECRET_VALUE
```

Use separate secrets for local, staging, and production projects. Rotate `OPENAI_API_KEY` and `AI_CRON_SECRET` immediately if either is exposed.

## Production migration and deployment

Run these commands from the repository root. Replace placeholders deliberately and confirm the linked project before any mutation.

### 1. Validate locally

```bash
npm ci
npm run lint
npm test
npm run build
```

### 2. Link and inspect the database change

```bash
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
npx supabase@latest migration list
npx supabase@latest db push --dry-run
```

The pending AI migration should be `202607120002_ai_futures_analyst.sql`. Review the dry run before continuing. Never use `supabase db reset` against production.

### 3. Configure Edge Function secrets

Set the variables from the previous section in the linked project. `SERVICE_ROLE_KEY` must use that exact name. It must never be placed in Vault-backed Cron headers or sent to a browser.

### 4. Deploy the four functions

The two user functions keep Supabase gateway JWT verification enabled:

```bash
npx supabase@latest functions deploy ai-futures-analyze
npx supabase@latest functions deploy ai-futures-plan
```

The two server-only functions authenticate `x-ai-cron-secret` themselves and must accept calls from `pg_net`, which has no user JWT:

```bash
npx supabase@latest functions deploy ai-futures-pipeline --no-verify-jwt
npx supabase@latest functions deploy ai-futures-outcomes --no-verify-jwt
```

Do not deploy `ai-futures-analyze` or `ai-futures-plan` with `--no-verify-jwt`.

### 5. Create the named Vault entries

Before applying the migration, open Supabase Dashboard > Vault and create these exact names:

| Vault name | Value |
| --- | --- |
| `ai_futures_market_pipeline_url` | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/ai-futures-pipeline` |
| `ai_futures_outcome_reconcile_url` | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/ai-futures-outcomes` |
| `ai_futures_cron_secret` | The exact same random value used for the Edge Function's `AI_CRON_SECRET` |

For a fresh project, the equivalent SQL is:

```sql
select vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/ai-futures-pipeline',
  'ai_futures_market_pipeline_url',
  'AI Futures closed-candle pipeline URL'
);

select vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/ai-futures-outcomes',
  'ai_futures_outcome_reconcile_url',
  'AI Futures outcome reconciliation URL'
);

select vault.create_secret(
  'PASTE_THE_SAME_AI_CRON_SECRET_VALUE',
  'ai_futures_cron_secret',
  'AI Futures Cron authentication secret'
);
```

If a name already exists, update it in Vault instead of creating a duplicate. Do not paste any Vault value into a migration or a `cron.job` command.

### 6. Apply the migration

```bash
npx supabase@latest db push
```

The migration enables RLS, installs the initial disabled configuration, and attempts to schedule both jobs only when `pg_cron`, `pg_net`, and all three named Vault entries are available. A notice that Cron was not scheduled is safe; use the manual procedure below after fixing the missing prerequisite.

### 7. Verify the deployment while still disabled

```sql
select version, feature_enabled, shadow_mode, ai_calls_enabled,
       allow_deterministic_only, emergency_kill_switch,
       model_name, engine_version, prompt_version, created_at
from public.ai_futures_configs
order by version desc
limit 1;

select jobid, jobname, schedule, active
from cron.job
where jobname in (
  'ai-futures-market-pipeline-every-minute',
  'ai-futures-outcome-reconcile-every-minute'
)
order by jobname;
```

The first query must show the safe initial state described at the top of this guide. Both jobs should use `* * * * *`. The stored Cron command should contain Vault lookups, not a decrypted key:

```sql
select jobname, command
from cron.job
where jobname like 'ai-futures-%';
```

### 8. Deploy the frontend

Deploy the Vite application through the existing Netlify process after the database and functions are ready. The route remains unavailable to regular users until an admin creates a configuration with `feature_enabled = true` and `shadow_mode = false`.

## Manual Cron installation

Use this only if the migration was applied before the Vault entries existed or automatic scheduling was unavailable. First enable the extensions in Supabase Dashboard, then run:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname in (
  'ai-futures-market-pipeline-every-minute',
  'ai-futures-outcome-reconcile-every-minute'
);

select cron.schedule(
  'ai-futures-market-pipeline-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url := (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'ai_futures_market_pipeline_url' limit 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ai-cron-secret', (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'ai_futures_cron_secret' limit 1
        )
      ),
      body := '{"scope":"closed-candle"}'::jsonb,
      timeout_milliseconds := 8000
    );
  $cron$
);

select cron.schedule(
  'ai-futures-outcome-reconcile-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url := (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'ai_futures_outcome_reconcile_url' limit 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ai-cron-secret', (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'ai_futures_cron_secret' limit 1
        )
      ),
      body := '{"scope":"active-setups"}'::jsonb,
      timeout_milliseconds := 8000
    );
  $cron$
);
```

Smoke-test each endpoint with the same Cron secret stored in Vault and the Edge Function environment:

```bash
curl --fail-with-body \
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/ai-futures-pipeline' \
  -H "x-ai-cron-secret: $AI_CRON_SECRET_VALUE" \
  -H 'Content-Type: application/json' \
  --data '{"scope":"closed-candle"}'

curl --fail-with-body \
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/ai-futures-outcomes' \
  -H "x-ai-cron-secret: $AI_CRON_SECRET_VALUE" \
  -H 'Content-Type: application/json' \
  --data '{"scope":"active-setups"}'
```

While the feature is disabled, the market pipeline should return a safe `skipped` result. A missing or incorrect Cron secret must return an error, never process a job.

## Local development

### Hosted-backend workflow

The simplest UI workflow is to use the existing `.env` with a development Supabase project and run:

```bash
npm install
npm run dev
```

The browser calls the deployed Edge Functions in that project. If the project has not received the AI migration/functions, the page must show an honest unavailable error. It must not fabricate local data.

### Fully local Supabase workflow

Docker is required for the local Supabase stack:

```bash
npx supabase@latest start
npx supabase@latest db reset
npx supabase@latest status
```

`db reset` is appropriate only for this disposable local stack. Copy the local API URL and publishable/anon key printed by `supabase status` into `.env`:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_LOCAL_ANON_KEY
```

Create `supabase/.env.ai-futures.local` with local-only values. The repository's `.env.*.local` ignore rule keeps this file out of Git, but verify with `git status` before continuing:

```bash
SERVICE_ROLE_KEY=YOUR_LOCAL_SERVICE_ROLE_KEY_FROM_SUPABASE_STATUS
OPENAI_API_KEY=YOUR_DEVELOPMENT_OPENAI_KEY
AI_CRON_SECRET=YOUR_LOCAL_RANDOM_CRON_SECRET
AI_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
AI_OUTCOME_BATCH_LIMIT=25
```

Serve all functions in one terminal and Vite in another:

```bash
npx supabase@latest functions serve --env-file supabase/.env.ai-futures.local
npm run dev
```

Local Cron is optional for page development. Invoke the two server-only endpoints manually with `x-ai-cron-secret`, or create the same named Vault entries and schedules in the local database.

The initial config is disabled even locally. Use the admin UI and staged states below; do not weaken the migration defaults for convenience.

## Shadow mode and staged enablement

Every configuration change creates a new immutable `ai_futures_configs` version and requires a change reason. Use `/admin/trading-academy/ai-futures-analyst`; do not update the latest row in place.

Recommended rollout:

1. **Installed but off:** keep the migration defaults. Verify RLS, function authentication, Cron, logs, and the frontend unavailable state.
2. **Deterministic shadow:** set feature enabled, keep shadow mode on, keep AI calls off, and enable deterministic-only results. Cron generates shared setups for admin inspection; Academy users still receive the shadow response rather than analysis.
3. **AI shadow:** keep shadow mode on, enable AI calls, confirm the active model/prompt version, and preferably disable deterministic-only fallback while validating AI reliability. Review failures, schema rejections, token use, outcomes, losses, expirations, no-trades, and provider freshness over a meaningful period.
4. **Academy live:** only after shadow review, set shadow mode off. Keep the kill switch clear. Decide explicitly whether deterministic-only fallback is acceptable for the product; leaving it off is the strict fail-closed policy.
5. **Post-launch:** monitor every day initially. If error rates, stale data, cost, or outcome behavior are unexpected, return to shadow mode or activate the kill switch by creating another version.

There is no per-user canary allowlist in v1. Changing `shadow_mode` to false exposes the feature to all currently authorized Academy users, so do not describe a partial user rollout unless one is implemented later.

## Admin monitoring

The admin-only page is:

```text
/admin/trading-academy/ai-futures-analyst
```

It provides:

- current feature, shadow, AI-call, deterministic-fallback, and kill-switch state
- versioned scoring thresholds, score weights, safety limits, model, prompt, and engine settings
- recent pipeline runs and failures
- provider and model usage/failure records
- immutable setup and complete outcome history
- entry, win/loss, expectancy, take-profit, no-trade, regime, quality-band, and provider-failure metrics
- read-only inspection of the source snapshot behind a setup
- an append-only correction-note form that never rewrites the original setup

Historical snapshots, predictions, provider/model logs, and outcome events are protected against rewriting. Corrections belong in timestamped append-only `ai_setup_admin_notes`, not edits to the original prediction.

Useful operational queries:

```sql
select job_type, status, error_code, error_detail, counters, started_at, finished_at
from public.ai_pipeline_runs
order by started_at desc
limit 50;

select provider, data_category, status, http_status, error_code,
       latency_ms, source_timestamp, occurred_at
from public.ai_provider_events
where status <> 'success'
order by occurred_at desc
limit 50;

select model_name, prompt_version, status, input_tokens, output_tokens,
       latency_ms, error_code, created_at
from public.ai_model_usage_logs
order by created_at desc
limit 50;

select verdict, market_regime, count(*)
from public.ai_market_setups
where generation_status = 'ready'
group by verdict, market_regime
order by verdict, market_regime;

select status, count(*), avg(realized_result_r) as average_r,
       avg(estimated_result_after_costs_r) as average_after_costs_r
from public.ai_setup_outcomes
group by status
order by status;
```

Cron execution details are separate from application run logs:

```sql
select jobid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid in (
  select jobid from cron.job where jobname like 'ai-futures-%'
)
order by start_time desc
limit 50;
```

Never delete losses, expirations, no-trades, failures, or inconvenient shadow results when assessing performance.

## RLS and authorization verification

The migration enables RLS on every AI table. Its intended boundary is:

- an authenticated Academy user can select/insert/update/delete only their own `ai_risk_profiles` row
- an authenticated Academy user can select only their own analysis requests and personalized plans
- regular users cannot directly read common snapshots, setups, outcome history, provider/model logs, or configuration
- regular users cannot insert trusted snapshots/setups or execute trusted generation/outcome RPCs
- admins can read monitoring records through existing `is_admin()` policies and append admin notes
- `service_role` is the only application role that can generate shared system records and invoke service-only access/generation RPCs

Verify grants and RLS flags after migration:

```sql
select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname like 'ai_%'
  and c.relkind = 'r'
order by c.relname;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public' and tablename like 'ai_%'
order by tablename, policyname;

select
  has_table_privilege('authenticated', 'public.ai_market_snapshots', 'INSERT')
    as authenticated_can_insert_snapshots,
  has_table_privilege('authenticated', 'public.ai_market_setups', 'INSERT')
    as authenticated_can_insert_setups,
  has_function_privilege(
    'authenticated',
    'public.ai_futures_user_has_academy_access(uuid)',
    'EXECUTE'
  ) as authenticated_can_call_service_access_helper,
  has_table_privilege('service_role', 'public.ai_market_snapshots', 'INSERT')
    as service_can_insert_snapshots;
```

Expected values are `false`, `false`, `false`, and `true` in that order.

For row-isolation tests, create two disposable authenticated test accounts: one active Academy user and one different user. In separate SQL Editor transactions, impersonate each JWT subject and confirm only the matching profile/plan is visible:

```sql
begin;
select set_config('request.jwt.claim.sub', 'FIRST_TEST_USER_UUID', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"FIRST_TEST_USER_UUID","role":"authenticated"}',
  true
);
set local role authenticated;

select user_id from public.ai_risk_profiles;
select user_id, setup_id from public.ai_user_trade_plans;
rollback;
```

Repeat with `SECOND_TEST_USER_UUID`. Do not run isolation tests using the SQL Editor's default database-owner role alone; owners bypass RLS. Also verify through the application or authenticated HTTP calls that logged-out, non-Academy, and expired-Academy users receive 401/403 responses while an active subscriber succeeds when the feature is live.

## Tests and release checks

Run the full project checks:

```bash
npm run lint
npm test
npm run build
git diff --check
```

Run the AI-focused Node tests while iterating:

```bash
node --test tests/aiFutures*.test.mjs
```

Before release, confirm:

- fixed fixtures produce deterministic indicators, setup verdicts, and outcome transitions
- long/short sizing remains inside risk and margin budgets after exchange-step rounding
- missing OpenAI/provider data fails closed
- stale or incomplete candles cannot become a setup
- duplicate snapshot/setup requests reuse existing rows rather than creating duplicate AI calls
- active, expired, non-Academy, and logged-out authorization paths behave correctly
- Demo Trade prefill requires a user click and refuses to overwrite an existing open position/order
- `npm run build` keeps Analyst and Demo Trade in lazy chunks and introduces no large eager entry chunk regression
- the admin page can read monitoring data but a regular user cannot

For a hosted smoke test, use a disposable active Academy account and the application UI. Do not put a user JWT, service-role key, or OpenAI key into committed scripts, screenshots, issue comments, or test fixtures.

## Safe disable, emergency response, and rollback

### Fast application disable

From the admin page, create a new configuration version with:

- `Emergency kill switch`: on
- `Feature enabled`: off
- `Shadow mode`: on
- `AI calls enabled`: off
- a specific incident/change reason

The kill switch prevents new analysis/setup completion. To stop background HTTP requests as well, unschedule both jobs:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'ai-futures-market-pipeline-every-minute',
  'ai-futures-outcome-reconcile-every-minute'
);
```

Stopping outcome reconciliation pauses tracking; it does not delete history. When restored, review the candle backlog and outcome batch limit before resuming.

If the admin UI is unavailable, a database owner can invoke the same versioned admin RPC in SQL Editor while impersonating a known admin account:

```sql
begin;
select set_config('request.jwt.claim.sub', 'KNOWN_ADMIN_USER_UUID', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"KNOWN_ADMIN_USER_UUID","role":"authenticated"}',
  true
);

select public.admin_create_ai_futures_config(
  p_feature_enabled => false,
  p_shadow_mode => true,
  p_ai_calls_enabled => false,
  p_emergency_kill_switch => true,
  p_change_reason => 'Emergency disable: describe incident and ticket here'
);
commit;
```

Confirm the latest version before assuming the switch took effect.

### Code rollback

Roll back the frontend and Edge Functions to a known-good application revision, but retain the AI tables and immutable history unless a separately reviewed data-retention migration is required. Dropping the tables is not a safe operational rollback.

Recommended order:

1. Activate the kill switch and disable AI calls.
2. Unschedule Cron if provider calls must stop.
3. Deploy the known-good frontend/functions revision.
4. Diagnose using immutable setup, outcome, model, provider, and pipeline records.
5. Apply a forward migration for schema corrections; do not edit a migration already applied to production.
6. Restore first in shadow mode, observe, then deliberately return live.

Rotate the Cron or OpenAI secret as part of rollback whenever credential exposure is suspected. Updating `AI_CRON_SECRET` requires updating the matching `ai_futures_cron_secret` Vault value before re-enabling jobs.

## Safety notes

- Planning Balance is an input for educational sizing, not a wallet or custodial balance.
- Position plans assume isolated margin and estimated fees/slippage.
- The liquidation level is an estimate and must be verified with the user's exchange, including maintenance tiers and fees.
- A Setup Quality Score is a confluence score, never a probability of profit.
- Futures and leverage can cause rapid or total loss.
- Do not add exchange API keys, private keys, seed phrases, automatic order placement, or spot/exchange fallbacks to this v1 pipeline.
