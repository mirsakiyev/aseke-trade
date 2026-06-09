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
  select cp.*
  into payment
  from public.crypto_payments as cp
  where cp.id = target_payment_id
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

  select ps.*
  into existing_subscription
  from public.premium_subscriptions as ps
  where ps.crypto_payment_id = target_payment_id
  limit 1;

  if found then
    subscription_id := existing_subscription.id;
    premium_starts_at := existing_subscription.starts_at;
    premium_expires_at := existing_subscription.expires_at;
    return next;
    return;
  end if;

  select pp.*
  into plan
  from public.premium_plans as pp
  where pp.id = payment.plan_id
    and pp.is_active = true;

  if not found then
    raise exception 'Premium plan is not active';
  end if;

  insert into public.profiles (id, role)
  values (payment.user_id, 'user')
  on conflict (id) do nothing;

  select greatest(coalesce(p.premium_until, now()), now())
  into base_start
  from public.profiles as p
  where p.id = payment.user_id
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

  update public.profiles as p
  set role = case when p.role = 'admin' then 'admin' else 'premium' end,
      premium_until = next_expires_at
  where p.id = payment.user_id;

  update public.crypto_payments as cp
  set premium_starts_at = next_starts_at,
      premium_expires_at = next_expires_at,
      updated_at = now()
  where cp.id = payment.id;

  premium_starts_at := next_starts_at;
  premium_expires_at := next_expires_at;
  return next;
end;
$$;

create or replace function public.spend_account_balance_for_user(
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

    select pp.*
    into plan
    from public.premium_plans as pp
    where pp.id = target_plan_id
      and pp.is_active = true;

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
      select c.title, c.price_cents
      into item_title, item_price_cents
      from public.courses as c
      where c.id = target_course_id
        and c.is_archived = false
        and c.is_premium = true;

      if item_title is null or coalesce(item_price_cents, 0) <= 0 then
        raise exception 'Course is not purchasable';
      end if;

      select exists (
        select 1
        from public.purchases as p
        where p.user_id = target_user_id
          and p.course_id = target_course_id
          and p.status in ('paid', 'active', 'granted')
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
      from public.guides as g
      left join public.courses as c on c.id = g.course_id
      where g.id = target_guide_id
        and g.is_archived = false
        and coalesce(c.is_archived, false) = false
        and (g.is_premium = true or coalesce(c.is_premium, false) = true);

      if item_title is null or coalesce(item_price_cents, 0) <= 0 then
        raise exception 'Guide is not purchasable';
      end if;

      select exists (
        select 1
        from public.purchases as p
        where p.user_id = target_user_id
          and p.guide_id = target_guide_id
          and p.status in ('paid', 'active', 'granted')
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

  select ab.balance_cents
  into available_balance
  from public.account_balances as ab
  where ab.user_id = target_user_id
  for update;

  if available_balance < item_price_cents then
    raise exception 'Insufficient account balance';
  end if;

  update public.account_balances as ab
  set balance_cents = ab.balance_cents - item_price_cents,
      updated_at = now()
  where ab.user_id = target_user_id
  returning ab.balance_cents into available_balance;

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

    select greatest(coalesce(p.premium_until, now()), now())
    into base_start
    from public.profiles as p
    where p.id = target_user_id
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

    update public.account_balance_transactions as abt
    set premium_subscription_id = created_subscription_id
    where abt.id = created_transaction_id;

    update public.profiles as p
    set role = case when p.role = 'admin' then 'admin' else 'premium' end,
        premium_until = next_expires_at
    where p.id = target_user_id;
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
