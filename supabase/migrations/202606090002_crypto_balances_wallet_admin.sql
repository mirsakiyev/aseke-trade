alter table public.crypto_payment_methods
add column if not exists notes text;

alter table public.crypto_payment_methods
add column if not exists updated_at timestamptz not null default now();

alter table public.crypto_payment_methods
drop constraint if exists crypto_payment_methods_asset_network_key;

create unique index if not exists crypto_payment_methods_active_asset_network_unique_idx
on public.crypto_payment_methods(asset, network)
where is_active = true;

create index if not exists crypto_payment_methods_active_idx
on public.crypto_payment_methods(is_active);

drop trigger if exists set_crypto_payment_methods_updated_at on public.crypto_payment_methods;
create trigger set_crypto_payment_methods_updated_at
before update on public.crypto_payment_methods
for each row execute function public.set_updated_at();

alter table public.crypto_payments
add column if not exists payment_type text not null default 'purchase';

alter table public.crypto_payments
drop constraint if exists crypto_payments_payment_type_check;

alter table public.crypto_payments
add constraint crypto_payments_payment_type_check
check (payment_type in ('purchase', 'deposit'));

alter table public.crypto_payments
drop constraint if exists crypto_payments_check;

alter table public.crypto_payments
drop constraint if exists crypto_payments_item_target_check;

alter table public.crypto_payments
add constraint crypto_payments_item_target_check
check (
  (
    payment_type = 'purchase'
    and ((course_id is not null and guide_id is null) or (course_id is null and guide_id is not null))
  )
  or (
    payment_type = 'deposit'
    and course_id is null
    and guide_id is null
  )
);

create index if not exists crypto_payments_payment_type_idx
on public.crypto_payments(payment_type);

create table if not exists public.account_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_cents integer not null default 0 check (balance_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_account_balances_updated_at on public.account_balances;
create trigger set_account_balances_updated_at
before update on public.account_balances
for each row execute function public.set_updated_at();

create table if not exists public.account_balance_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  crypto_payment_id uuid references public.crypto_payments(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  guide_id uuid references public.guides(id) on delete set null,
  transaction_type text not null check (transaction_type in ('deposit', 'purchase', 'refund', 'adjustment')),
  amount_cents integer not null check (amount_cents <> 0),
  description text,
  created_at timestamptz not null default now()
);

create unique index if not exists account_balance_transactions_deposit_payment_unique_idx
on public.account_balance_transactions(crypto_payment_id)
where crypto_payment_id is not null and transaction_type = 'deposit';

create index if not exists account_balance_transactions_user_id_idx
on public.account_balance_transactions(user_id);

create index if not exists account_balance_transactions_created_at_idx
on public.account_balance_transactions(created_at);

create or replace function public.credit_crypto_deposit(target_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  payment record;
  credit_cents integer;
begin
  select *
  into payment
  from public.crypto_payments
  where id = target_payment_id
  for update;

  if not found then
    raise exception 'Payment not found';
  end if;

  if payment.payment_type <> 'deposit' or payment.status <> 'confirmed' then
    return;
  end if;

  if exists (
    select 1
    from public.account_balance_transactions
    where crypto_payment_id = target_payment_id
      and transaction_type = 'deposit'
  ) then
    return;
  end if;

  credit_cents := round(coalesce(payment.received_amount, payment.expected_amount) * 100)::integer;

  if credit_cents <= 0 then
    raise exception 'Deposit amount must be greater than zero';
  end if;

  insert into public.account_balances (user_id, balance_cents)
  values (payment.user_id, credit_cents)
  on conflict (user_id) do update set
    balance_cents = public.account_balances.balance_cents + excluded.balance_cents,
    updated_at = now();

  insert into public.account_balance_transactions (
    user_id,
    crypto_payment_id,
    transaction_type,
    amount_cents,
    description
  )
  values (
    payment.user_id,
    payment.id,
    'deposit',
    credit_cents,
    payment.asset || ' ' || payment.network || ' verified deposit'
  );
end;
$$;

create or replace function public.spend_account_balance_for_user(
  target_user_id uuid,
  target_course_id uuid default null,
  target_guide_id uuid default null
)
returns table (
  transaction_id uuid,
  balance_cents integer,
  purchase_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  item_title text;
  item_price_cents integer;
  existing_access boolean;
  available_balance integer;
  created_transaction_id uuid;
  created_purchase_id uuid;
begin
  if target_user_id is null then
    raise exception 'User is required';
  end if;

  if (target_course_id is null and target_guide_id is null)
    or (target_course_id is not null and target_guide_id is not null)
  then
    raise exception 'Choose exactly one course or guide';
  end if;

  if target_course_id is not null then
    select title, price_cents
    into item_title, item_price_cents
    from public.courses
    where id = target_course_id
      and is_archived = false
      and is_premium = true;

    if item_title is null or coalesce(item_price_cents, 0) <= 0 then
      raise exception 'Course is not purchasable';
    end if;

    select exists (
      select 1
      from public.purchases
      where user_id = target_user_id
        and course_id = target_course_id
        and status in ('paid', 'active', 'granted')
    )
    into existing_access;
  else
    select
      g.title,
      case
        when g.price_cents > 0 then g.price_cents
        else coalesce(c.price_cents, 0)
      end
    into item_title, item_price_cents
    from public.guides g
    left join public.courses c on c.id = g.course_id
    where g.id = target_guide_id
      and g.is_archived = false
      and coalesce(c.is_archived, false) = false
      and (g.is_premium = true or coalesce(c.is_premium, false) = true);

    if item_title is null or coalesce(item_price_cents, 0) <= 0 then
      raise exception 'Guide is not purchasable';
    end if;

    select exists (
      select 1
      from public.purchases
      where user_id = target_user_id
        and guide_id = target_guide_id
        and status in ('paid', 'active', 'granted')
    )
    into existing_access;
  end if;

  if existing_access then
    raise exception 'This account already has access';
  end if;

  insert into public.account_balances (user_id, balance_cents)
  values (target_user_id, 0)
  on conflict (user_id) do nothing;

  select balance_cents
  into available_balance
  from public.account_balances
  where user_id = target_user_id
  for update;

  if available_balance < item_price_cents then
    raise exception 'Insufficient account balance';
  end if;

  update public.account_balances
  set balance_cents = balance_cents - item_price_cents,
      updated_at = now()
  where user_id = target_user_id
  returning balance_cents into available_balance;

  insert into public.account_balance_transactions (
    user_id,
    course_id,
    guide_id,
    transaction_type,
    amount_cents,
    description
  )
  values (
    target_user_id,
    target_course_id,
    target_guide_id,
    'purchase',
    -item_price_cents,
    'Balance purchase: ' || item_title
  )
  returning id into created_transaction_id;

  insert into public.purchases (
    user_id,
    course_id,
    guide_id,
    status,
    payment_provider,
    payment_reference,
    amount_cents
  )
  values (
    target_user_id,
    target_course_id,
    target_guide_id,
    'paid',
    'account_balance',
    created_transaction_id::text,
    item_price_cents
  )
  returning id into created_purchase_id;

  transaction_id := created_transaction_id;
  balance_cents := available_balance;
  purchase_id := created_purchase_id;
  return next;
end;
$$;

alter table public.account_balances enable row level security;
alter table public.account_balance_transactions enable row level security;

drop policy if exists "crypto_payment_methods_admin_manage" on public.crypto_payment_methods;
create policy "crypto_payment_methods_admin_manage"
on public.crypto_payment_methods for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "account_balances_select_owner_or_admin" on public.account_balances;
create policy "account_balances_select_owner_or_admin"
on public.account_balances for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "account_balance_transactions_select_owner_or_admin" on public.account_balance_transactions;
create policy "account_balance_transactions_select_owner_or_admin"
on public.account_balance_transactions for select
using (user_id = auth.uid() or public.is_admin());

grant select on public.account_balances, public.account_balance_transactions to authenticated;
grant insert, update, delete on public.crypto_payment_methods to authenticated;
grant execute on function public.credit_crypto_deposit(uuid) to service_role;
grant execute on function public.spend_account_balance_for_user(uuid, uuid, uuid) to service_role;

revoke execute on function public.credit_crypto_deposit(uuid) from anon, authenticated;
revoke execute on function public.spend_account_balance_for_user(uuid, uuid, uuid) from anon, authenticated;

notify pgrst, 'reload schema';
