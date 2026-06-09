# ASEKE TRADE

ASEKE TRADE is a premium crypto education platform founded by Aslan Mirsakiyev, aka Aseke. It is built with Vite, React, TypeScript, Supabase, and Netlify-friendly routing.

## Features

- Dark black and platinum fintech design
- Free and premium guides
- Course catalog with free previews and locked premium lessons
- Supabase authentication, password reset, and email verification support
- Protected user dashboard
- Admin-only panel for guides, courses, modules, lessons, users, and premium access
- Supabase Row Level Security policies for role and purchase-based access
- Secure crypto checkout, account balance deposits, and server-side on-chain verification

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
- `premium`: can access premium guides and premium course lessons.
- `admin`: can manage content, users, purchases, and premium access.

Premium lesson access is granted only when Supabase confirms at least one of these:

- the user is `premium`
- the user is `admin`
- the user has a valid `paid`, `active`, or `granted` purchase record
- the user has verified `premium_access` from a confirmed crypto payment

## Crypto Payment Integration

Crypto checkout and balance deposits are implemented with Supabase Edge Functions. Keep blockchain
API keys, receiving addresses, and the service role key in Supabase secrets, not Vite or Netlify
browser variables. See [`docs/crypto-payments.md`](docs/crypto-payments.md) for deployment and
testing.

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
  pages/             Public, auth, dashboard, premium, and admin pages
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
