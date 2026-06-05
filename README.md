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
- Payment-provider-ready premium page without fake client-side checkout

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

## Payment Integration Notes

The premium page intentionally does not create fake payments or client-side purchases.

To add Stripe or another provider later:

1. Create checkout sessions from a Netlify Function or other secure server endpoint.
2. Store secret keys only in server-side environment variables.
3. Validate payment webhooks with provider signatures.
4. Insert or update `purchases` through a server-side Supabase service role key.
5. Keep browser code limited to reading access state through RLS-protected queries.

## Netlify Deployment

1. Push the project to GitHub.
2. Create a Netlify site from the repository.
3. Use these build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Add environment variables in Netlify:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - Future public payment key only if needed

   `VITE_SUPABASE_URL` must be the Project API URL from Supabase's API settings, not the database
   URL from the Database settings page.

   If you already use `VITE_SUPABASE_ANON_KEY`, the app accepts it and prefers it when both key
   variables are set. After changing Netlify environment variables, trigger a fresh deploy so Vite
   can bake them into the frontend bundle.
5. Keep secret payment provider keys out of Vite variables.

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
supabase/
  migrations/        Schema, triggers, RLS policies
  seed.sql           Sample curriculum content
public/assets/       Generated project visuals
```

## Security Notes

- Do not hardcode secrets.
- Use only `VITE_SUPABASE_URL` and one public Supabase browser key variable in browser code.
  `VITE_SUPABASE_ANON_KEY` is preferred when both key variables are set.
- Never trust frontend-only authorization.
- Keep Row Level Security enabled on all Supabase tables.
- Use service role keys only in secure server-side functions.
- React escapes displayed text by default; admin content fields are stored as plain text and trimmed before submission.

## Risk Disclaimer

ASEKE TRADE is educational only and is not financial advice. Crypto and futures trading involve substantial risk. Users are responsible for their own decisions, risk limits, and account security.
