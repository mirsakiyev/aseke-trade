alter table public.guides
add column if not exists price_cents integer not null default 0;

alter table public.guides
drop constraint if exists guides_price_cents_check;

alter table public.guides
add constraint guides_price_cents_check
check (price_cents >= 0);

update public.guides
set price_cents = 4900,
    updated_at = now()
where is_premium = true
  and price_cents = 0;

create table if not exists public.crypto_payment_methods (
  id uuid primary key default gen_random_uuid(),
  asset text not null check (asset in ('USDT', 'USDC')),
  network text not null check (network in ('TRC20', 'ERC20')),
  receive_address text not null,
  min_confirmations integer not null default 12 check (min_confirmations > 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (asset, network)
);

create table if not exists public.crypto_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  guide_id uuid references public.guides(id) on delete cascade,
  payment_method_id uuid not null references public.crypto_payment_methods(id),
  expected_amount numeric not null check (expected_amount > 0),
  received_amount numeric,
  asset text not null,
  network text not null,
  receive_address text not null,
  tx_hash text,
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'verifying', 'confirmed', 'underpaid', 'overpaid', 'expired', 'failed', 'duplicate')),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  admin_review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((course_id is not null and guide_id is null) or (course_id is null and guide_id is not null))
);

create table if not exists public.premium_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  guide_id uuid references public.guides(id) on delete cascade,
  payment_id uuid not null references public.crypto_payments(id) on delete cascade,
  access_type text not null default 'verified_purchase',
  created_at timestamptz not null default now(),
  check ((course_id is not null and guide_id is null) or (course_id is null and guide_id is not null))
);

create index if not exists crypto_payments_user_id_idx on public.crypto_payments(user_id);
create index if not exists crypto_payments_status_idx on public.crypto_payments(status);
create unique index if not exists crypto_payments_tx_hash_unique_idx
on public.crypto_payments(tx_hash)
where tx_hash is not null;
create index if not exists premium_access_user_id_idx on public.premium_access(user_id);
create index if not exists premium_access_course_id_idx on public.premium_access(course_id);
create index if not exists premium_access_guide_id_idx on public.premium_access(guide_id);
create unique index if not exists premium_access_payment_id_unique_idx on public.premium_access(payment_id);
create unique index if not exists premium_access_user_course_unique_idx
on public.premium_access(user_id, course_id)
where course_id is not null;
create unique index if not exists premium_access_user_guide_unique_idx
on public.premium_access(user_id, guide_id)
where guide_id is not null;
create unique index if not exists purchases_crypto_payment_reference_unique_idx
on public.purchases(payment_provider, payment_reference)
where payment_provider = 'crypto' and payment_reference is not null;

drop trigger if exists set_crypto_payments_updated_at on public.crypto_payments;
create trigger set_crypto_payments_updated_at
before update on public.crypto_payments
for each row execute function public.set_updated_at();

insert into public.crypto_payment_methods (
  id,
  asset,
  network,
  receive_address,
  min_confirmations,
  is_active
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    'USDT',
    'TRC20',
    'configure:TRON_USDT_RECEIVE_ADDRESS',
    19,
    false
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'USDT',
    'ERC20',
    'configure:ETH_USDT_RECEIVE_ADDRESS',
    12,
    false
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    'USDC',
    'ERC20',
    'configure:ETH_USDC_RECEIVE_ADDRESS',
    12,
    false
  )
on conflict (asset, network) do nothing;

create or replace function public.has_course_crypto_access(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.premium_access
    where user_id = auth.uid()
      and course_id = target_course_id
  );
$$;

create or replace function public.has_guide_crypto_access(target_guide_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.premium_access
    where user_id = auth.uid()
      and guide_id = target_guide_id
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
    or public.has_course_crypto_access(target_course_id)
    or exists (
      select 1
      from public.courses
      where id = target_course_id
        and is_archived = false
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
    or public.has_guide_crypto_access(target_guide_id)
    or exists (
      select 1
      from public.guides
      where id = target_guide_id
        and course_id is not null
        and (
          public.has_course_purchase(course_id)
          or public.has_course_crypto_access(course_id)
        )
    )
    or exists (
      select 1
      from public.guides g
      left join public.courses c on c.id = g.course_id
      where g.id = target_guide_id
        and g.is_archived = false
        and g.is_premium = false
        and coalesce(c.is_premium, false) = false
    );
$$;

create or replace function public.update_crypto_payment_admin_note(target_payment_id uuid, note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can update payment review notes';
  end if;

  update public.crypto_payments
  set admin_review_notes = nullif(trim(note), ''),
      updated_at = now()
  where id = target_payment_id;
end;
$$;

alter table public.crypto_payment_methods enable row level security;
alter table public.crypto_payments enable row level security;
alter table public.premium_access enable row level security;

drop policy if exists "crypto_payment_methods_select_active_or_admin" on public.crypto_payment_methods;
create policy "crypto_payment_methods_select_active_or_admin"
on public.crypto_payment_methods for select
using (is_active = true or public.is_admin());

drop policy if exists "crypto_payments_select_owner_or_admin" on public.crypto_payments;
create policy "crypto_payments_select_owner_or_admin"
on public.crypto_payments for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "premium_access_select_owner_or_admin" on public.premium_access;
create policy "premium_access_select_owner_or_admin"
on public.premium_access for select
using (user_id = auth.uid() or public.is_admin());

grant select on public.crypto_payment_methods to anon, authenticated;
grant select on public.crypto_payments, public.premium_access to authenticated;
grant execute on function public.update_crypto_payment_admin_note(uuid, text) to authenticated;

notify pgrst, 'reload schema';
