# ASEKE TRADE

ASEKE TRADE is a Trading Academy for disciplined crypto market education. It is built with Vite, React, TypeScript, Supabase, and Netlify-friendly routing.

## Features

- Dark black and platinum fintech design
- Free guides and Trading Academy materials
- Course catalog with free previews and locked Trading Academy lessons
- Supabase authentication, password reset, and email verification support
- Protected user dashboard
- Admin-only panel for guides, courses, modules, lessons, users, and Trading Academy access
- Supabase Row Level Security policies for role and purchase-based access
- Secure Trading Academy memberships, crypto checkout, account balance deposits, and server-side on-chain verification

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

3. Fill in:

   ```bash
   VITE_SUPABASE_URL=your-supabase-project-url
   VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
   ```

   Use the Project API URL, usually `https://your-project-ref.supabase.co`, not the database
   connection string, pooler URL, or Postgres host. Use the publishable key for browser code, never
   an `sb_secret_...` key.

   `VITE_SUPABASE_ANON_KEY` is also supported and takes precedence when both key variables are set.

4. Start the app:

   ```bash
   npm run dev
   ```

5. Build for production:

   ```bash
   npm run build
   ```

## Supabase Setup

1. Create a Supabase project.
2. In Supabase Auth settings, configure your site URL and redirect URLs:
   - Local: `http://localhost:5173`
   - Netlify: `https://your-site.netlify.app`
3. Run the migration in `supabase/migrations/202606030001_initial_schema.sql`.
4. Run `supabase/seed.sql` for sample guides, courses, modules, and lessons.
5. Configure crypto payment secrets and Edge Functions with the steps in
   [`docs/crypto-payments.md`](docs/crypto-payments.md).

With the Supabase CLI, the common flow is:

```bash
supabase link --project-ref your-project-ref
supabase db push
supabase db reset
```

Use `supabase db reset` only for local or disposable databases because it recreates data.

## First Admin User

1. Register the first account in the app.
2. Open the Supabase SQL editor.
3. Promote that account:

```sql
update public.profiles
set role = 'admin'
where id = (
  select id
  from auth.users
  where email = 'your-email@example.com'
);
```

After signing out and back in, the Admin navigation item will appear.

## Roles and Access

- `user`: can read free content and manage their own dashboard records.
- `premium`: internal role for users with active Trading Academy access until `premium_until` expires.
- `admin`: can manage content, users, purchases, and Trading Academy access.

Trading Academy lesson access is granted only when Supabase confirms at least one of these:

- the user has a future `premium_until` date
- the user is `admin`
- the user has a valid `paid`, `active`, or `granted` purchase record
- the user has verified `premium_access` from a confirmed crypto payment
- the user has an active Trading Academy subscription record

## Crypto Payment Integration

Crypto checkout, Trading Academy memberships, balance deposits, and balance-based Trading Academy purchases are
implemented with Supabase Edge Functions. Keep blockchain API keys, receiving addresses, and
`SERVICE_ROLE_KEY` in Supabase secrets, not Vite or Netlify browser variables. See
[`docs/crypto-payments.md`](docs/crypto-payments.md) for deployment and testing.

## Market Index Data

The `/charts` page loads its Market Sentiment & Risk widgets through the `market-indices` Supabase
Edge Function. The function reads public Alternative.me, Binance, and Deribit endpoints without
browser secrets. The Longs vs Shorts card includes a futures exchange selector with a default Major
CEX Average option. For multi-exchange and non-Binance futures long/short data, add the CoinGlass
key as a Supabase secret:

```bash
supabase secrets set COINGLASS_API_KEY=your-coinglass-api-key
supabase functions deploy market-indices
```

Do not add `COINGLASS_API_KEY` to Vite or Netlify browser variables. If the secret is missing, the
widget disables non-Binance exchange options, falls back to Binance-only public futures positioning,
and labels it that way.

## Netlify Deployment

1. Push the project to GitHub.
2. Create a Netlify site from the repository.
3. Use these build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Add environment variables in Netlify:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - No crypto API keys or service role keys

   `VITE_SUPABASE_URL` must be the Project API URL from Supabase's API settings, not the database
   URL from the Database settings page.

   If you already use `VITE_SUPABASE_ANON_KEY`, the app accepts it and prefers it when both key
   variables are set. After changing Netlify environment variables, trigger a fresh deploy so Vite
   can bake them into the frontend bundle.
5. Keep crypto API keys, receiving wallet configuration, and service role keys out of Vite variables.

The `netlify.toml` file includes the redirect needed for React Router.

## Project Structure

```text
src/
  components/        Shared layout, route guards, loading states
  contexts/          Supabase auth and profile state
  data/              Local sample content fallback
  lib/               Supabase client, content queries, validation helpers
  pages/             Public, auth, dashboard, Trading Academy, and admin pages
  types/             Shared TypeScript models
docs/
  crypto-payments.md Crypto payment setup and testing guide
supabase/
  functions/         Crypto payment, deposit, and balance Edge Functions
  migrations/        Schema, triggers, RLS policies
  seed.sql           Sample curriculum content
public/assets/       Generated project visuals
```

## Security Notes

- Do not hardcode secrets.
- Use only `VITE_SUPABASE_URL` and one public Supabase browser key variable in browser code.
  `VITE_SUPABASE_ANON_KEY` is preferred when both key variables are set.
- Never ask users for seed phrases or private keys.
- Never trust frontend-only authorization.
- Keep Row Level Security enabled on all Supabase tables.
- Use service role keys only in secure server-side functions.
- React escapes displayed text by default; admin content fields are stored as plain text and trimmed before submission.

## Risk Disclaimer

ASEKE TRADE is educational only and is not financial advice. Crypto and futures trading involve substantial risk. Users are responsible for their own decisions, risk limits, and account security.
