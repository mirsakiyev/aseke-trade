create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  username text unique,
  role text not null default 'user' check (role in ('user', 'premium', 'admin')),
  premium_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.guides (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text not null,
  content text not null,
  category text not null check (
    category in (
      'Basics',
      'Wallets & Security',
      'Spot Trading',
      'Futures Trading',
      'Risk Management',
      'Trading Strategies',
      'Advanced Concepts'
    )
  ),
  difficulty text not null check (difficulty in ('Beginner', 'Intermediate', 'Advanced')),
  estimated_read_time integer not null default 5 check (estimated_read_time > 0),
  is_premium boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text not null,
  difficulty text not null check (difficulty in ('Beginner', 'Intermediate', 'Advanced')),
  price_cents integer not null default 0 check (price_cents >= 0),
  is_premium boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  sort_order integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.course_modules(id) on delete cascade,
  title text not null,
  content text not null,
  video_url text,
  sort_order integer not null default 1,
  is_preview boolean not null default false,
  is_premium boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  guide_id uuid references public.guides(id) on delete cascade,
  status text not null check (status in ('pending', 'paid', 'active', 'granted', 'revoked', 'refunded')),
  payment_provider text,
  payment_reference text,
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  created_at timestamptz not null default now(),
  check (course_id is not null or guide_id is not null)
);

create table if not exists public.saved_guides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  guide_id uuid not null references public.guides(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, guide_id)
);

create table if not exists public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  completed boolean not null default false,
  completed_at timestamptz,
  unique (user_id, lesson_id)
);

create index if not exists guides_slug_idx on public.guides(slug);
create index if not exists guides_category_idx on public.guides(category);
create index if not exists courses_slug_idx on public.courses(slug);
create index if not exists course_modules_course_id_idx on public.course_modules(course_id);
create index if not exists lessons_module_id_idx on public.lessons(module_id);
create index if not exists purchases_user_id_idx on public.purchases(user_id);
create index if not exists purchases_course_id_idx on public.purchases(course_id);
create index if not exists saved_guides_user_id_idx on public.saved_guides(user_id);
create index if not exists lesson_progress_user_id_idx on public.lesson_progress(user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_guides_updated_at on public.guides;
create trigger set_guides_updated_at
before update on public.guides
for each row execute function public.set_updated_at();

drop trigger if exists set_courses_updated_at on public.courses;
create trigger set_courses_updated_at
before update on public.courses
for each row execute function public.set_updated_at();

drop trigger if exists set_lessons_updated_at on public.lessons;
create trigger set_lessons_updated_at
before update on public.lessons
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anonymous');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin';
$$;

create or replace function public.has_premium_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (
        role in ('premium', 'admin')
        or (premium_until is not null and premium_until > now())
      )
  );
$$;

create or replace function public.has_course_purchase(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.purchases
    where user_id = auth.uid()
      and course_id = target_course_id
      and status in ('paid', 'active', 'granted')
  );
$$;

create or replace function public.has_guide_purchase(target_guide_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.purchases
    where user_id = auth.uid()
      and guide_id = target_guide_id
      and status in ('paid', 'active', 'granted')
  );
$$;

create or replace function public.can_access_course(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or public.has_premium_access()
    or public.has_course_purchase(target_course_id)
    or exists (
      select 1
      from public.courses
      where id = target_course_id
        and is_premium = false
    );
$$;

create or replace function public.can_access_guide(target_guide_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or public.has_premium_access()
    or public.has_guide_purchase(target_guide_id)
    or exists (
      select 1
      from public.guides
      where id = target_guide_id
        and is_premium = false
    );
$$;

create or replace function public.can_access_lesson(target_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lessons l
    join public.course_modules m on m.id = l.module_id
    join public.courses c on c.id = m.course_id
    where l.id = target_lesson_id
      and (
        l.is_preview = true
        or l.is_premium = false
        or c.is_premium = false
        or public.can_access_course(c.id)
      )
  );
$$;

create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin()
    and (
      new.role is distinct from old.role
      or new.premium_until is distinct from old.premium_until
    )
  then
    raise exception 'Only admins can change profile access fields';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_profile_role_escalation on public.profiles;
create trigger prevent_profile_role_escalation
before update on public.profiles
for each row execute function public.prevent_profile_role_escalation();

alter table public.profiles enable row level security;
alter table public.guides enable row level security;
alter table public.courses enable row level security;
alter table public.course_modules enable row level security;
alter table public.lessons enable row level security;
alter table public.purchases enable row level security;
alter table public.saved_guides enable row level security;
alter table public.lesson_progress enable row level security;

drop policy if exists "profiles_select_owner_or_admin" on public.profiles;
create policy "profiles_select_owner_or_admin"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_owner_or_admin" on public.profiles;
create policy "profiles_update_owner_or_admin"
on public.profiles for update
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists "guides_select_by_access" on public.guides;
create policy "guides_select_by_access"
on public.guides for select
using (public.can_access_guide(id));

drop policy if exists "guides_admin_manage" on public.guides;
create policy "guides_admin_manage"
on public.guides for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "courses_select_catalog_metadata" on public.courses;
create policy "courses_select_catalog_metadata"
on public.courses for select
using (true);

drop policy if exists "courses_admin_manage" on public.courses;
create policy "courses_admin_manage"
on public.courses for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "course_modules_select_catalog_metadata" on public.course_modules;
create policy "course_modules_select_catalog_metadata"
on public.course_modules for select
using (true);

drop policy if exists "course_modules_admin_manage" on public.course_modules;
create policy "course_modules_admin_manage"
on public.course_modules for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "lessons_select_by_access" on public.lessons;
create policy "lessons_select_by_access"
on public.lessons for select
using (public.can_access_lesson(id));

drop policy if exists "lessons_admin_manage" on public.lessons;
create policy "lessons_admin_manage"
on public.lessons for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "purchases_select_owner_or_admin" on public.purchases;
create policy "purchases_select_owner_or_admin"
on public.purchases for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "purchases_admin_manage" on public.purchases;
create policy "purchases_admin_manage"
on public.purchases for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "saved_guides_owner_select" on public.saved_guides;
create policy "saved_guides_owner_select"
on public.saved_guides for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "saved_guides_owner_insert" on public.saved_guides;
create policy "saved_guides_owner_insert"
on public.saved_guides for insert
with check (user_id = auth.uid() and public.can_access_guide(guide_id));

drop policy if exists "saved_guides_owner_delete" on public.saved_guides;
create policy "saved_guides_owner_delete"
on public.saved_guides for delete
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "lesson_progress_owner_select" on public.lesson_progress;
create policy "lesson_progress_owner_select"
on public.lesson_progress for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "lesson_progress_owner_insert" on public.lesson_progress;
create policy "lesson_progress_owner_insert"
on public.lesson_progress for insert
with check (user_id = auth.uid() and public.can_access_lesson(lesson_id));

drop policy if exists "lesson_progress_owner_update" on public.lesson_progress;
create policy "lesson_progress_owner_update"
on public.lesson_progress for update
using (user_id = auth.uid() or public.is_admin())
with check ((user_id = auth.uid() and public.can_access_lesson(lesson_id)) or public.is_admin());

drop policy if exists "lesson_progress_owner_delete" on public.lesson_progress;
create policy "lesson_progress_owner_delete"
on public.lesson_progress for delete
using (user_id = auth.uid() or public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.guides, public.courses, public.course_modules, public.lessons to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

notify pgrst, 'reload schema';
