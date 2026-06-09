create table if not exists public.premium_plans (
  id text primary key,
  product_label text not null default 'Premium',
  duration_months integer not null check (duration_months > 0),
  price_cents integer not null check (price_cents > 0),
  is_active boolean not null default true,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_premium_plans_updated_at on public.premium_plans;
create trigger set_premium_plans_updated_at
before update on public.premium_plans
for each row execute function public.set_updated_at();

insert into public.premium_plans (
  id,
  product_label,
  duration_months,
  price_cents,
  is_active,
  is_featured
)
values
  ('premium_1_month', 'Premium', 1, 1000, true, false),
  ('premium_1_year', 'Premium', 12, 5000, true, true)
on conflict (id) do update set
  product_label = excluded.product_label,
  duration_months = excluded.duration_months,
  price_cents = excluded.price_cents,
  is_active = excluded.is_active,
  is_featured = excluded.is_featured,
  updated_at = now();

alter table public.crypto_payments
add column if not exists product_type text;

alter table public.crypto_payments
add column if not exists product_label text;

alter table public.crypto_payments
add column if not exists plan_id text;

alter table public.crypto_payments
add column if not exists plan_duration_months integer;

alter table public.crypto_payments
add column if not exists fiat_amount_cents integer;

alter table public.crypto_payments
add column if not exists fiat_currency text not null default 'USD';

alter table public.crypto_payments
add column if not exists premium_starts_at timestamptz;

alter table public.crypto_payments
add column if not exists premium_expires_at timestamptz;

update public.crypto_payments
set product_type = case
    when payment_type = 'deposit' then 'deposit'
    when guide_id is not null then 'guide'
    else 'course'
  end
where product_type is null;

update public.crypto_payments
set product_label = case
    when payment_type = 'deposit' then 'Account balance deposit'
    when guide_id is not null then 'Premium guide'
    else 'Premium course'
  end
where product_label is null;

update public.crypto_payments
set fiat_amount_cents = round(expected_amount * 100)::integer
where fiat_amount_cents is null;

alter table public.premium_access
alter column access_type set default 'verified_purchase';

update public.premium_access
set access_type = 'verified_purchase'
where access_type = 'lifetime';

alter table public.crypto_payments
alter column product_type set not null;

alter table public.crypto_payments
alter column product_type set default 'course';

alter table public.crypto_payments
drop constraint if exists crypto_payments_product_type_check;

alter table public.crypto_payments
add constraint crypto_payments_product_type_check
check (product_type in ('premium', 'course', 'guide', 'deposit'));

alter table public.crypto_payments
drop constraint if exists crypto_payments_plan_duration_check;

alter table public.crypto_payments
add constraint crypto_payments_plan_duration_check
check (plan_duration_months is null or plan_duration_months > 0);

alter table public.crypto_payments
drop constraint if exists crypto_payments_fiat_amount_check;

alter table public.crypto_payments
add constraint crypto_payments_fiat_amount_check
check (fiat_amount_cents is null or fiat_amount_cents > 0);

alter table public.crypto_payments
drop constraint if exists crypto_payments_fiat_currency_check;

alter table public.crypto_payments
add constraint crypto_payments_fiat_currency_check
check (fiat_currency = 'USD');

alter table public.crypto_payments
drop constraint if exists crypto_payments_item_target_check;

alter table public.crypto_payments
add constraint crypto_payments_item_target_check
check (
  (
    payment_type = 'deposit'
    and product_type = 'deposit'
    and course_id is null
    and guide_id is null
    and plan_id is null
  )
  or (
    payment_type = 'purchase'
    and product_type = 'premium'
    and course_id is null
    and guide_id is null
    and plan_id is not null
    and plan_duration_months is not null
  )
  or (
    payment_type = 'purchase'
    and product_type = 'course'
    and course_id is not null
    and guide_id is null
    and plan_id is null
  )
  or (
    payment_type = 'purchase'
    and product_type = 'guide'
    and course_id is null
    and guide_id is not null
    and plan_id is null
  )
);

create index if not exists crypto_payments_product_type_idx
on public.crypto_payments(product_type);

create index if not exists crypto_payments_plan_id_idx
on public.crypto_payments(plan_id);

create table if not exists public.premium_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_type text not null default 'premium' check (product_type = 'premium'),
  product_label text not null default 'Premium',
  plan_id text not null references public.premium_plans(id),
  plan_duration_months integer not null check (plan_duration_months > 0),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  price_cents integer not null check (price_cents > 0),
  status text not null default 'active' check (status in ('pending', 'active', 'expired', 'cancelled', 'failed')),
  crypto_payment_id uuid references public.crypto_payments(id) on delete set null,
  balance_transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

drop trigger if exists set_premium_subscriptions_updated_at on public.premium_subscriptions;
create trigger set_premium_subscriptions_updated_at
before update on public.premium_subscriptions
for each row execute function public.set_updated_at();

create index if not exists premium_subscriptions_user_id_idx
on public.premium_subscriptions(user_id);

create index if not exists premium_subscriptions_expires_at_idx
on public.premium_subscriptions(expires_at);

create unique index if not exists premium_subscriptions_crypto_payment_unique_idx
on public.premium_subscriptions(crypto_payment_id)
where crypto_payment_id is not null;

alter table public.account_balance_transactions
add column if not exists product_type text;

alter table public.account_balance_transactions
add column if not exists product_label text;

alter table public.account_balance_transactions
add column if not exists plan_id text;

alter table public.account_balance_transactions
add column if not exists plan_duration_months integer;

alter table public.account_balance_transactions
add column if not exists premium_subscription_id uuid references public.premium_subscriptions(id) on delete set null;

create unique index if not exists premium_subscriptions_balance_transaction_unique_idx
on public.premium_subscriptions(balance_transaction_id)
where balance_transaction_id is not null;

alter table public.premium_subscriptions
drop constraint if exists premium_subscriptions_balance_transaction_fkey;

alter table public.premium_subscriptions
add constraint premium_subscriptions_balance_transaction_fkey
foreign key (balance_transaction_id)
references public.account_balance_transactions(id)
on delete set null;

alter table public.premium_plans enable row level security;
alter table public.premium_subscriptions enable row level security;

drop policy if exists "premium_plans_select_active_or_admin" on public.premium_plans;
create policy "premium_plans_select_active_or_admin"
on public.premium_plans for select
using (is_active = true or public.is_admin());

drop policy if exists "premium_subscriptions_select_owner_or_admin" on public.premium_subscriptions;
create policy "premium_subscriptions_select_owner_or_admin"
on public.premium_subscriptions for select
using (user_id = auth.uid() or public.is_admin());

grant select on public.premium_plans to anon, authenticated;
grant select on public.premium_subscriptions to authenticated;

update public.courses
set is_premium = true,
    price_cents = 0,
    updated_at = now()
where slug = 'trading-academy';

update public.guides
set is_premium = true,
    price_cents = 0,
    updated_at = now()
where slug in (
  'trading-foundations-spot-margin-futures',
  'technical-analysis-masterclass',
  'risk-management-masterclass',
  'trading-psychology-execution',
  'futures-trading-leverage',
  'advanced-derivatives-strategy'
);

update public.guides
set title = 'Trading Foundations: Charts, Orders & Market Structure',
    slug = 'trading-foundations-charts-orders-market-structure',
    description = 'Build the chart-reading foundation for market structure, order types, levels, and execution planning.',
    updated_at = now()
where id = '20000000-0000-4000-8000-000000000006';

update public.guides
set title = 'Trading Psychology: Discipline Over Emotions',
    slug = 'trading-psychology-discipline-over-emotions',
    description = 'Improve decision quality around patience, journaling, execution mistakes, tilt, and process consistency.',
    updated_at = now()
where id = '20000000-0000-4000-8000-000000000011';

update public.guides
set title = 'Futures Trading: Leverage, Liquidation & Strategy',
    slug = 'futures-trading-leverage-liquidation-strategy',
    description = 'Learn liquidation risk, margin modes, funding, leverage limits, and safer futures strategy planning.',
    updated_at = now()
where id = '20000000-0000-4000-8000-000000000009';

update public.guides
set title = 'Advanced Derivatives: Options & Margin',
    slug = 'advanced-derivatives-options-margin',
    description = 'Explore options, margin, hedging, scenario planning, and structured derivatives concepts.',
    updated_at = now()
where id = '20000000-0000-4000-8000-000000000010';

create or replace function public.has_premium_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and (
          role = 'admin'
          or (premium_until is not null and premium_until > now())
        )
    )
    or exists (
      select 1
      from public.premium_subscriptions
      where user_id = auth.uid()
        and status = 'active'
        and expires_at > now()
    );
$$;

create or replace function public.activate_premium_subscription_from_payment(target_payment_id uuid)
returns table (
  subscription_id uuid,
  premium_starts_at timestamptz,
  premium_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  payment record;
  plan record;
  existing_subscription record;
  base_start timestamptz;
  next_starts_at timestamptz;
  next_expires_at timestamptz;
begin
  select *
  into payment
  from public.crypto_payments
  where id = target_payment_id
  for update;

  if not found then
    raise exception 'Payment not found';
  end if;

  if payment.payment_type <> 'purchase'
    or payment.product_type <> 'premium'
    or payment.status <> 'confirmed'
  then
    return;
  end if;

  select *
  into existing_subscription
  from public.premium_subscriptions
  where crypto_payment_id = target_payment_id
  limit 1;

  if found then
    subscription_id := existing_subscription.id;
    premium_starts_at := existing_subscription.starts_at;
    premium_expires_at := existing_subscription.expires_at;
    return next;
    return;
  end if;

  select *
  into plan
  from public.premium_plans
  where id = payment.plan_id
    and is_active = true;

  if not found then
    raise exception 'Premium plan is not active';
  end if;

  insert into public.profiles (id, role)
  values (payment.user_id, 'user')
  on conflict (id) do nothing;

  select greatest(coalesce(premium_until, now()), now())
  into base_start
  from public.profiles
  where id = payment.user_id
  for update;

  next_starts_at := base_start;
  next_expires_at := next_starts_at + make_interval(months => plan.duration_months);

  insert into public.premium_subscriptions (
    user_id,
    product_type,
    product_label,
    plan_id,
    plan_duration_months,
    starts_at,
    expires_at,
    price_cents,
    status,
    crypto_payment_id
  )
  values (
    payment.user_id,
    'premium',
    plan.product_label,
    plan.id,
    plan.duration_months,
    next_starts_at,
    next_expires_at,
    plan.price_cents,
    'active',
    payment.id
  )
  returning id into subscription_id;

  update public.profiles
  set role = case when role = 'admin' then 'admin' else 'premium' end,
      premium_until = next_expires_at
  where id = payment.user_id;

  update public.crypto_payments
  set premium_starts_at = next_starts_at,
      premium_expires_at = next_expires_at,
      updated_at = now()
  where id = payment.id;

  premium_starts_at := next_starts_at;
  premium_expires_at := next_expires_at;
  return next;
end;
$$;

drop function if exists public.spend_account_balance_for_user(uuid, uuid, uuid);

create function public.spend_account_balance_for_user(
  target_user_id uuid,
  target_course_id uuid default null,
  target_guide_id uuid default null,
  target_plan_id text default null
)
returns table (
  transaction_id uuid,
  balance_cents integer,
  purchase_id uuid,
  subscription_id uuid,
  premium_expires_at timestamptz
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
  created_subscription_id uuid;
  plan record;
  base_start timestamptz;
  next_starts_at timestamptz;
  next_expires_at timestamptz;
begin
  if target_user_id is null then
    raise exception 'User is required';
  end if;

  if target_plan_id is not null then
    if target_course_id is not null or target_guide_id is not null then
      raise exception 'Premium plan purchase cannot include a course or guide';
    end if;

    select *
    into plan
    from public.premium_plans
    where id = target_plan_id
      and is_active = true;

    if not found then
      raise exception 'Premium plan is not active';
    end if;

    item_title := plan.product_label;
    item_price_cents := plan.price_cents;
  else
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
    description,
    product_type,
    product_label,
    plan_id,
    plan_duration_months
  )
  values (
    target_user_id,
    target_course_id,
    target_guide_id,
    'purchase',
    -item_price_cents,
    case
      when target_plan_id is not null then 'Balance purchase: Premium'
      else 'Balance purchase: ' || item_title
    end,
    case when target_plan_id is not null then 'premium' else null end,
    case when target_plan_id is not null then plan.product_label else item_title end,
    target_plan_id,
    case when target_plan_id is not null then plan.duration_months else null end
  )
  returning id into created_transaction_id;

  if target_plan_id is not null then
    insert into public.profiles (id, role)
    values (target_user_id, 'user')
    on conflict (id) do nothing;

    select greatest(coalesce(premium_until, now()), now())
    into base_start
    from public.profiles
    where id = target_user_id
    for update;

    next_starts_at := base_start;
    next_expires_at := next_starts_at + make_interval(months => plan.duration_months);

    insert into public.premium_subscriptions (
      user_id,
      product_type,
      product_label,
      plan_id,
      plan_duration_months,
      starts_at,
      expires_at,
      price_cents,
      status,
      balance_transaction_id
    )
    values (
      target_user_id,
      'premium',
      plan.product_label,
      plan.id,
      plan.duration_months,
      next_starts_at,
      next_expires_at,
      plan.price_cents,
      'active',
      created_transaction_id
    )
    returning id into created_subscription_id;

    update public.account_balance_transactions
    set premium_subscription_id = created_subscription_id
    where id = created_transaction_id;

    update public.profiles
    set role = case when role = 'admin' then 'admin' else 'premium' end,
        premium_until = next_expires_at
    where id = target_user_id;
  else
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
  end if;

  transaction_id := created_transaction_id;
  balance_cents := available_balance;
  purchase_id := created_purchase_id;
  subscription_id := created_subscription_id;
  premium_expires_at := next_expires_at;
  return next;
end;
$$;

grant execute on function public.activate_premium_subscription_from_payment(uuid) to service_role;
grant execute on function public.spend_account_balance_for_user(uuid, uuid, uuid, text) to service_role;

revoke execute on function public.activate_premium_subscription_from_payment(uuid) from anon, authenticated;
revoke execute on function public.spend_account_balance_for_user(uuid, uuid, uuid, text) from anon, authenticated;

notify pgrst, 'reload schema';
