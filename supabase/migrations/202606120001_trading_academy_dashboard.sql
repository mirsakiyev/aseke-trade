create or replace function public.user_has_trading_academy_access(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = target_user_id
      and (
        p.role = 'admin'
        or (
          p.premium_until is not null
          and p.premium_until > now()
          and (p.premium_starts_at is null or p.premium_starts_at <= now())
        )
      )
  )
  or exists (
    select 1
    from public.premium_subscriptions as ps
    where ps.user_id = target_user_id
      and ps.status in ('pending', 'active')
      and ps.starts_at <= now()
      and ps.expires_at > now()
  );
$$;

create table if not exists public.trading_signals (
  id uuid primary key default gen_random_uuid(),
  title text,
  symbol text not null,
  direction text not null check (direction in ('long', 'short', 'spot', 'update')),
  entry_price numeric(24, 10) not null,
  stop_loss numeric(24, 10) not null,
  take_profit_1 numeric(24, 10) not null,
  take_profit_2 numeric(24, 10) not null,
  take_profit_3 numeric(24, 10) not null,
  additional_take_profits jsonb not null default '[]'::jsonb,
  price_at_creation numeric(24, 10) not null,
  chart_image_url text,
  notes text,
  status text not null default 'active' check (status in ('draft', 'active', 'closed', 'cancelled', 'hit_tp', 'hit_sl')),
  is_active boolean not null default true,
  created_by_admin_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(additional_take_profits) = 'array')
);

drop trigger if exists set_trading_signals_updated_at on public.trading_signals;
create trigger set_trading_signals_updated_at
before update on public.trading_signals
for each row execute function public.set_updated_at();

create index if not exists trading_signals_status_idx
on public.trading_signals(status, is_active, created_at desc);

create table if not exists public.aml_check_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null,
  network text not null,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'in_review', 'completed', 'rejected', 'refunded')),
  admin_result text,
  admin_notes text,
  amount_charged_cents integer not null default 200 check (amount_charged_cents = 200),
  transaction_id uuid references public.account_balance_transactions(id) on delete set null,
  idempotency_key text,
  reviewed_by_admin_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

drop trigger if exists set_aml_check_requests_updated_at on public.aml_check_requests;
create trigger set_aml_check_requests_updated_at
before update on public.aml_check_requests
for each row execute function public.set_updated_at();

create unique index if not exists aml_check_requests_user_idempotency_unique_idx
on public.aml_check_requests(user_id, idempotency_key)
where idempotency_key is not null;

create index if not exists aml_check_requests_user_id_idx
on public.aml_check_requests(user_id, created_at desc);

create index if not exists aml_check_requests_status_idx
on public.aml_check_requests(status, created_at desc);

create table if not exists public.premium_support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  message text not null,
  category text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_review', 'answered', 'closed')),
  admin_response text,
  admin_notes text,
  reviewed_by_admin_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_premium_support_requests_updated_at on public.premium_support_requests;
create trigger set_premium_support_requests_updated_at
before update on public.premium_support_requests
for each row execute function public.set_updated_at();

create index if not exists premium_support_requests_user_id_idx
on public.premium_support_requests(user_id, created_at desc);

create index if not exists premium_support_requests_status_idx
on public.premium_support_requests(status, created_at desc);

alter table public.account_balance_transactions
drop constraint if exists account_balance_transactions_transaction_type_check;

alter table public.account_balance_transactions
add constraint account_balance_transactions_transaction_type_check
check (transaction_type in ('deposit', 'purchase', 'refund', 'adjustment', 'fee'));

create or replace function public.get_trading_academy_leaderboard()
returns table (
  rank integer,
  member_key text,
  display_name text,
  level integer,
  total_xp integer,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Login is required';
  end if;

  if not public.has_premium_access() then
    raise exception 'Trading Academy access is required';
  end if;

  return query
  select
    row_number() over (
      order by p.level desc, p.total_xp desc, p.created_at asc, p.id asc
    )::integer as rank,
    substr(encode(digest(p.id::text, 'sha256'), 'hex'), 1, 16) as member_key,
    coalesce(nullif(p.username, ''), nullif(p.full_name, ''), 'Academy learner') as display_name,
    p.level,
    p.total_xp,
    p.created_at as joined_at
  from public.profiles as p
  where p.role <> 'admin'
    and public.user_has_trading_academy_access(p.id)
  order by p.level desc, p.total_xp desc, p.created_at asc, p.id asc;
end;
$$;

create or replace function public.submit_trading_academy_aml_check(
  target_user_id uuid,
  wallet_address text,
  target_network text,
  user_notes text default null,
  request_key text default null
)
returns table (
  request_id uuid,
  transaction_id uuid,
  balance_cents integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  fee_cents integer := 200;
  available_balance integer;
  existing_request record;
  created_transaction_id uuid;
  created_request_id uuid;
  safe_address text := nullif(trim(coalesce(wallet_address, '')), '');
  safe_network text := nullif(trim(coalesce(target_network, '')), '');
  safe_notes text := nullif(trim(coalesce(user_notes, '')), '');
  safe_request_key text := nullif(trim(coalesce(request_key, '')), '');
begin
  if target_user_id is null then
    raise exception 'User is required';
  end if;

  if not public.user_has_trading_academy_access(target_user_id) then
    raise exception 'Trading Academy access is required';
  end if;

  if safe_address is null then
    raise exception 'Wallet address is required';
  end if;

  if safe_network is null then
    raise exception 'Network is required';
  end if;

  insert into public.account_balances (user_id, balance_cents)
  values (target_user_id, 0)
  on conflict (user_id) do nothing;

  select ab.balance_cents
  into available_balance
  from public.account_balances as ab
  where ab.user_id = target_user_id
  for update;

  if safe_request_key is not null then
    select acr.id, acr.transaction_id, acr.status
    into existing_request
    from public.aml_check_requests as acr
    where acr.user_id = target_user_id
      and acr.idempotency_key = safe_request_key
    limit 1;

    if found then
      request_id := existing_request.id;
      transaction_id := existing_request.transaction_id;
      balance_cents := available_balance;
      status := existing_request.status;
      return next;
      return;
    end if;
  end if;

  if available_balance < fee_cents then
    raise exception 'Insufficient account balance';
  end if;

  update public.account_balances as ab
  set balance_cents = ab.balance_cents - fee_cents,
      updated_at = now()
  where ab.user_id = target_user_id
  returning ab.balance_cents into available_balance;

  insert into public.account_balance_transactions (
    user_id,
    transaction_type,
    amount_cents,
    description,
    product_type,
    product_label
  )
  values (
    target_user_id,
    'fee',
    -fee_cents,
    'Trading Academy AML check fee',
    'premium',
    'Trading Academy AML Check'
  )
  returning id into created_transaction_id;

  insert into public.aml_check_requests (
    user_id,
    address,
    network,
    notes,
    amount_charged_cents,
    transaction_id,
    idempotency_key
  )
  values (
    target_user_id,
    safe_address,
    safe_network,
    safe_notes,
    fee_cents,
    created_transaction_id,
    safe_request_key
  )
  returning id, aml_check_requests.status into created_request_id, status;

  request_id := created_request_id;
  transaction_id := created_transaction_id;
  balance_cents := available_balance;
  return next;
end;
$$;

alter table public.trading_signals enable row level security;
alter table public.aml_check_requests enable row level security;
alter table public.premium_support_requests enable row level security;

drop policy if exists "trading_signals_select_academy_or_admin" on public.trading_signals;
create policy "trading_signals_select_academy_or_admin"
on public.trading_signals for select
using (
  public.is_admin()
  or (
    public.has_premium_access()
    and is_active = true
    and status <> 'draft'
  )
);

drop policy if exists "trading_signals_admin_manage" on public.trading_signals;
create policy "trading_signals_admin_manage"
on public.trading_signals for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "aml_check_requests_select_owner_or_admin" on public.aml_check_requests;
create policy "aml_check_requests_select_owner_or_admin"
on public.aml_check_requests for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "aml_check_requests_admin_update" on public.aml_check_requests;
create policy "aml_check_requests_admin_update"
on public.aml_check_requests for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "premium_support_requests_select_owner_or_admin" on public.premium_support_requests;
create policy "premium_support_requests_select_owner_or_admin"
on public.premium_support_requests for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "premium_support_requests_insert_owner_academy" on public.premium_support_requests;
create policy "premium_support_requests_insert_owner_academy"
on public.premium_support_requests for insert
with check (user_id = auth.uid() and public.has_premium_access());

drop policy if exists "premium_support_requests_admin_update" on public.premium_support_requests;
create policy "premium_support_requests_admin_update"
on public.premium_support_requests for update
using (public.is_admin())
with check (public.is_admin());

insert into storage.buckets (id, name, public)
values ('trading-signal-charts', 'trading-signal-charts', true)
on conflict (id) do update set public = true;

drop policy if exists "trading_signal_charts_public_read" on storage.objects;
create policy "trading_signal_charts_public_read"
on storage.objects for select
using (bucket_id = 'trading-signal-charts');

drop policy if exists "trading_signal_charts_admin_insert" on storage.objects;
create policy "trading_signal_charts_admin_insert"
on storage.objects for insert
with check (bucket_id = 'trading-signal-charts' and public.is_admin());

drop policy if exists "trading_signal_charts_admin_update" on storage.objects;
create policy "trading_signal_charts_admin_update"
on storage.objects for update
using (bucket_id = 'trading-signal-charts' and public.is_admin())
with check (bucket_id = 'trading-signal-charts' and public.is_admin());

drop policy if exists "trading_signal_charts_admin_delete" on storage.objects;
create policy "trading_signal_charts_admin_delete"
on storage.objects for delete
using (bucket_id = 'trading-signal-charts' and public.is_admin());

grant select on public.trading_signals, public.aml_check_requests, public.premium_support_requests to authenticated;
grant insert on public.premium_support_requests to authenticated;
grant insert, update, delete on public.trading_signals to authenticated;
grant update on public.aml_check_requests, public.premium_support_requests to authenticated;

grant select, insert, update, delete on public.trading_signals to service_role;
grant select, insert, update, delete on public.aml_check_requests to service_role;
grant select, insert, update, delete on public.premium_support_requests to service_role;
grant select, insert, update on public.account_balances to service_role;
grant select, insert on public.account_balance_transactions to service_role;

grant execute on function public.user_has_trading_academy_access(uuid) to authenticated, service_role;
grant execute on function public.get_trading_academy_leaderboard() to authenticated;
grant execute on function public.submit_trading_academy_aml_check(uuid, text, text, text, text) to service_role;

revoke execute on function public.submit_trading_academy_aml_check(uuid, text, text, text, text) from anon, authenticated;

notify pgrst, 'reload schema';
