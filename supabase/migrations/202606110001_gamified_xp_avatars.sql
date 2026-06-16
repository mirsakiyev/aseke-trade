alter table public.profiles
add column if not exists total_xp integer not null default 0;

alter table public.profiles
add column if not exists level integer not null default 1;

alter table public.profiles
add column if not exists premium_starts_at timestamptz;

alter table public.profiles
add column if not exists avatar_url text;

alter table public.profiles
add column if not exists updated_at timestamptz not null default now();

alter table public.profiles
drop constraint if exists profiles_total_xp_check;

alter table public.profiles
add constraint profiles_total_xp_check
check (total_xp >= 0);

alter table public.profiles
drop constraint if exists profiles_level_check;

alter table public.profiles
add constraint profiles_level_check
check (level >= 1);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.get_xp_required_for_next_level(target_level integer)
returns integer
language sql
immutable
as $$
  select greatest(1, round(100 * power(1.2, greatest(target_level, 1) - 1))::integer);
$$;

create or replace function public.get_level_from_xp(target_total_xp integer)
returns integer
language plpgsql
immutable
as $$
declare
  safe_xp integer := greatest(coalesce(target_total_xp, 0), 0);
  next_requirement integer;
  current_level integer := 1;
begin
  loop
    next_requirement := public.get_xp_required_for_next_level(current_level);
    exit when safe_xp < next_requirement;

    safe_xp := safe_xp - next_requirement;
    current_level := current_level + 1;
  end loop;

  return current_level;
end;
$$;

create or replace function public.sync_profile_level()
returns trigger
language plpgsql
as $$
begin
  new.total_xp := greatest(coalesce(new.total_xp, 0), 0);
  new.level := public.get_level_from_xp(new.total_xp);
  return new;
end;
$$;

drop trigger if exists sync_profile_level on public.profiles;
create trigger sync_profile_level
before insert or update of total_xp on public.profiles
for each row execute function public.sync_profile_level();

update public.profiles
set total_xp = coalesce(total_xp, 0),
    level = public.get_level_from_xp(coalesce(total_xp, 0));

alter table public.guides
add column if not exists xp_reward integer not null default 75;

alter table public.guides
drop constraint if exists guides_xp_reward_check;

alter table public.guides
add constraint guides_xp_reward_check
check (xp_reward between 50 and 100);

update public.guides
set xp_reward = case
    when xp_reward between 50 and 100 then xp_reward
    else 75
  end;

create table if not exists public.guide_quizzes (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides(id) on delete cascade,
  question text not null,
  answer_options jsonb not null,
  correct_answer text not null,
  explanation text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guide_id),
  check (jsonb_typeof(answer_options) = 'array'),
  check (jsonb_array_length(answer_options) between 2 and 6),
  check (answer_options ? correct_answer)
);

drop trigger if exists set_guide_quizzes_updated_at on public.guide_quizzes;
create trigger set_guide_quizzes_updated_at
before update on public.guide_quizzes
for each row execute function public.set_updated_at();

create table if not exists public.guide_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  guide_id uuid not null references public.guides(id) on delete cascade,
  guide_quiz_id uuid references public.guide_quizzes(id) on delete set null,
  selected_answer text,
  quiz_passed boolean not null default false,
  xp_awarded integer not null default 0 check (xp_awarded >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, guide_id)
);

drop trigger if exists set_guide_completions_updated_at on public.guide_completions;
create trigger set_guide_completions_updated_at
before update on public.guide_completions
for each row execute function public.set_updated_at();

create table if not exists public.xp_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  source_type text not null check (source_type in ('guide', 'admin_adjustment')),
  source_id uuid not null,
  description text,
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_id)
);

create index if not exists xp_transactions_user_id_idx
on public.xp_transactions(user_id);

create index if not exists xp_transactions_source_idx
on public.xp_transactions(source_type, source_id);

insert into public.premium_plans (
  id,
  product_label,
  duration_months,
  price_cents,
  is_active,
  is_featured
)
values ('admin_custom', 'Trading Academy', 1, 1, true, false)
on conflict (id) do update set
  product_label = excluded.product_label,
  is_active = true,
  updated_at = now();

alter table public.premium_subscriptions
add column if not exists granted_by uuid references auth.users(id) on delete set null;

alter table public.premium_subscriptions
add column if not exists admin_note text;

create index if not exists premium_subscriptions_status_idx
on public.premium_subscriptions(status);

create or replace function public.normalize_answer(value text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(coalesce(value, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.refresh_premium_subscription_statuses(target_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.premium_subscriptions as ps
  set status = case
      when ps.status in ('cancelled', 'failed') then ps.status
      when ps.expires_at <= now() then 'expired'
      when ps.starts_at > now() then 'pending'
      else 'active'
    end,
    updated_at = now()
  where (target_user_id is null or ps.user_id = target_user_id)
    and ps.status <> case
      when ps.status in ('cancelled', 'failed') then ps.status
      when ps.expires_at <= now() then 'expired'
      when ps.starts_at > now() then 'pending'
      else 'active'
    end;
end;
$$;

create or replace function public.sync_user_trading_academy_profile(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_starts_at timestamptz;
  next_expires_at timestamptz;
  target_role text;
begin
  perform public.refresh_premium_subscription_statuses(target_user_id);

  select min(ps.starts_at), max(ps.expires_at)
  into next_starts_at, next_expires_at
  from public.premium_subscriptions as ps
  where ps.user_id = target_user_id
    and ps.status in ('pending', 'active')
    and ps.expires_at > now();

  select p.role
  into target_role
  from public.profiles as p
  where p.id = target_user_id;

  if next_expires_at is null then
    update public.profiles as p
    set role = case when p.role = 'admin' then 'admin' else 'user' end,
        premium_starts_at = null,
        premium_until = null
    where p.id = target_user_id
      and p.role <> 'admin';

    return;
  end if;

  insert into public.profiles (id, role, premium_starts_at, premium_until)
  values (target_user_id, 'premium', next_starts_at, next_expires_at)
  on conflict (id) do update set
    role = case when public.profiles.role = 'admin' then 'admin' else 'premium' end,
    premium_starts_at = excluded.premium_starts_at,
    premium_until = excluded.premium_until;
end;
$$;

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
          or (
            premium_until is not null
            and premium_until > now()
            and (premium_starts_at is null or premium_starts_at <= now())
          )
        )
    )
    or exists (
      select 1
      from public.premium_subscriptions
      where user_id = auth.uid()
        and status in ('pending', 'active')
        and starts_at <= now()
        and expires_at > now()
    );
$$;

create or replace function public.get_guide_quiz(target_guide_id uuid)
returns table (
  id uuid,
  guide_id uuid,
  question text,
  answer_options jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_guide_id is null then
    raise exception 'Guide is required';
  end if;

  if not public.can_access_guide(target_guide_id) then
    raise exception 'Guide is not available to this account';
  end if;

  return query
  select gq.id, gq.guide_id, gq.question, gq.answer_options
  from public.guide_quizzes as gq
  where gq.guide_id = target_guide_id
    and gq.is_active = true
  limit 1;
end;
$$;

create or replace function public.submit_guide_quiz(
  target_guide_id uuid,
  selected_answer text
)
returns table (
  passed boolean,
  xp_awarded integer,
  total_xp integer,
  level integer,
  already_awarded boolean,
  correct_answer text,
  explanation text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  quiz record;
  guide_reward integer;
  inserted_amount integer;
  next_profile record;
  has_existing_award boolean;
begin
  if auth.uid() is null then
    raise exception 'Login is required to earn XP';
  end if;

  if target_guide_id is null then
    raise exception 'Guide is required';
  end if;

  if not public.can_access_guide(target_guide_id) then
    raise exception 'Guide is not available to this account';
  end if;

  select gq.*
  into quiz
  from public.guide_quizzes as gq
  where gq.guide_id = target_guide_id
    and gq.is_active = true
  limit 1;

  if not found then
    raise exception 'This guide does not have an active quiz yet';
  end if;

  select g.xp_reward
  into guide_reward
  from public.guides as g
  where g.id = target_guide_id;

  passed := public.normalize_answer(selected_answer) = public.normalize_answer(quiz.correct_answer);

  select exists (
    select 1
    from public.xp_transactions as xt
    where xt.user_id = auth.uid()
      and xt.source_type = 'guide'
      and xt.source_id = target_guide_id
  )
  into has_existing_award;

  inserted_amount := 0;

  if passed then
    insert into public.xp_transactions (
      user_id,
      amount,
      source_type,
      source_id,
      description
    )
    values (
      auth.uid(),
      guide_reward,
      'guide',
      target_guide_id,
      'Guide quiz passed'
    )
    on conflict (user_id, source_type, source_id) do nothing
    returning amount into inserted_amount;

    inserted_amount := coalesce(inserted_amount, 0);

    if inserted_amount > 0 then
      insert into public.profiles (id, total_xp)
      values (auth.uid(), inserted_amount)
      on conflict (id) do update set
        total_xp = public.profiles.total_xp + excluded.total_xp;
    end if;
  end if;

  insert into public.guide_completions (
    user_id,
    guide_id,
    guide_quiz_id,
    selected_answer,
    quiz_passed,
    xp_awarded,
    completed_at
  )
  values (
    auth.uid(),
    target_guide_id,
    quiz.id,
    selected_answer,
    passed,
    inserted_amount,
    case when passed then now() else null end
  )
  on conflict (user_id, guide_id) do update set
    guide_quiz_id = excluded.guide_quiz_id,
    selected_answer = excluded.selected_answer,
    quiz_passed = public.guide_completions.quiz_passed or excluded.quiz_passed,
    xp_awarded = greatest(public.guide_completions.xp_awarded, excluded.xp_awarded),
    completed_at = coalesce(public.guide_completions.completed_at, excluded.completed_at),
    updated_at = now();

  select p.total_xp, p.level
  into next_profile
  from public.profiles as p
  where p.id = auth.uid();

  xp_awarded := inserted_amount;
  total_xp := coalesce(next_profile.total_xp, 0);
  level := coalesce(next_profile.level, 1);
  already_awarded := has_existing_award or (passed and inserted_amount = 0);
  correct_answer := case when passed or has_existing_award then quiz.correct_answer else null end;
  explanation := case when passed or has_existing_award then quiz.explanation else null end;

  return next;
end;
$$;

create or replace function public.admin_issue_trading_academy_subscription(
  target_user_id uuid,
  target_starts_at timestamptz default now(),
  target_expires_at timestamptz default null,
  duration_count integer default null,
  duration_unit text default 'days',
  admin_note text default null
)
returns table (
  subscription_id uuid,
  starts_at timestamptz,
  expires_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_starts_at timestamptz := coalesce(target_starts_at, now());
  safe_expires_at timestamptz := target_expires_at;
  normalized_unit text := lower(coalesce(duration_unit, 'days'));
begin
  if not public.is_admin() then
    raise exception 'Only admins can issue Trading Academy subscriptions';
  end if;

  if target_user_id is null then
    raise exception 'User is required';
  end if;

  if safe_expires_at is null then
    if coalesce(duration_count, 0) <= 0 then
      raise exception 'Provide an end date or a positive duration';
    end if;

    safe_expires_at := case normalized_unit
      when 'day' then safe_starts_at + make_interval(days => duration_count)
      when 'days' then safe_starts_at + make_interval(days => duration_count)
      when 'week' then safe_starts_at + make_interval(days => duration_count * 7)
      when 'weeks' then safe_starts_at + make_interval(days => duration_count * 7)
      when 'month' then safe_starts_at + make_interval(months => duration_count)
      when 'months' then safe_starts_at + make_interval(months => duration_count)
      else null
    end;
  end if;

  if safe_expires_at is null then
    raise exception 'Unsupported duration unit';
  end if;

  if safe_expires_at <= safe_starts_at then
    raise exception 'End date must be after start date';
  end if;

  insert into public.profiles (id, role)
  values (target_user_id, 'user')
  on conflict (id) do nothing;

  insert into public.premium_subscriptions as ps (
    user_id,
    product_type,
    product_label,
    plan_id,
    plan_duration_months,
    starts_at,
    expires_at,
    price_cents,
    status,
    granted_by,
    admin_note
  )
  values (
    target_user_id,
    'premium',
    'Trading Academy',
    'admin_custom',
    greatest(1, ceil(extract(epoch from (safe_expires_at - safe_starts_at)) / 2592000.0)::integer),
    safe_starts_at,
    safe_expires_at,
    1,
    case
      when safe_expires_at <= now() then 'expired'
      when safe_starts_at > now() then 'pending'
      else 'active'
    end,
    auth.uid(),
    nullif(trim(coalesce(admin_note, '')), '')
  )
  returning ps.id, ps.starts_at, ps.expires_at, ps.status
  into subscription_id, starts_at, expires_at, status;

  perform public.sync_user_trading_academy_profile(target_user_id);

  return next;
end;
$$;

create or replace function public.admin_update_trading_academy_subscription(
  target_subscription_id uuid,
  target_starts_at timestamptz,
  target_expires_at timestamptz,
  admin_note text default null
)
returns table (
  subscription_id uuid,
  starts_at timestamptz,
  expires_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can update Trading Academy subscriptions';
  end if;

  if target_subscription_id is null then
    raise exception 'Subscription is required';
  end if;

  if target_starts_at is null or target_expires_at is null then
    raise exception 'Start and end dates are required';
  end if;

  if target_expires_at <= target_starts_at then
    raise exception 'End date must be after start date';
  end if;

  update public.premium_subscriptions as ps
  set starts_at = target_starts_at,
      expires_at = target_expires_at,
      plan_duration_months = greatest(1, ceil(extract(epoch from (target_expires_at - target_starts_at)) / 2592000.0)::integer),
      status = case
        when target_expires_at <= now() then 'expired'
        when target_starts_at > now() then 'pending'
        else 'active'
      end,
      admin_note = nullif(trim(coalesce(admin_note, ps.admin_note, '')), ''),
      updated_at = now()
  where ps.id = target_subscription_id
  returning ps.user_id, ps.id, ps.starts_at, ps.expires_at, ps.status
  into target_user_id, subscription_id, starts_at, expires_at, status;

  if target_user_id is null then
    raise exception 'Subscription not found';
  end if;

  perform public.sync_user_trading_academy_profile(target_user_id);

  return next;
end;
$$;

alter table public.guide_quizzes enable row level security;
alter table public.guide_completions enable row level security;
alter table public.xp_transactions enable row level security;

drop policy if exists "guide_quizzes_admin_manage" on public.guide_quizzes;
create policy "guide_quizzes_admin_manage"
on public.guide_quizzes for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "guide_completions_select_owner_or_admin" on public.guide_completions;
create policy "guide_completions_select_owner_or_admin"
on public.guide_completions for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "xp_transactions_select_owner_or_admin" on public.xp_transactions;
create policy "xp_transactions_select_owner_or_admin"
on public.xp_transactions for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "premium_subscriptions_admin_manage" on public.premium_subscriptions;
create policy "premium_subscriptions_admin_manage"
on public.premium_subscriptions for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "profiles_update_avatar_owner_or_admin" on public.profiles;
create policy "profiles_update_avatar_owner_or_admin"
on public.profiles for update
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
on storage.objects for select
using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert"
on storage.objects for insert
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
on storage.objects for update
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
on storage.objects for delete
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

insert into public.guide_quizzes (
  guide_id,
  question,
  answer_options,
  correct_answer,
  explanation
)
select
  g.id,
  case g.slug
    when 'crypto-foundations' then 'What is the main role of a blockchain?'
    when 'crypto-safety-security' then 'What should you never share with another person or website?'
    when 'portfolio-building-investing' then 'What does position sizing help control?'
    when 'crypto-market-cycles' then 'What does a market cycle describe?'
    when 'tokenomics-project-research' then 'Why do token unlock schedules matter?'
    when 'trading-foundations-charts-orders-market-structure' then 'What does market structure help traders read?'
    when 'technical-analysis-masterclass' then 'What should a trading setup include before entry?'
    when 'risk-management-masterclass' then 'What is the purpose of a stop loss?'
    when 'futures-trading-leverage-liquidation-strategy' then 'What can high leverage do to liquidation risk?'
    when 'advanced-derivatives-options-margin' then 'What is a hedge designed to do?'
    when 'trading-psychology-discipline-over-emotions' then 'What habit supports disciplined execution?'
    when 'defi-fundamentals' then 'What is a decentralized exchange used for?'
    when 'on-chain-analysis' then 'What does on-chain analysis study?'
    when 'blockchain-development-basics' then 'What are gas fees used for?'
    else 'What is the safest next step after reading this guide?'
  end,
  case g.slug
    when 'crypto-foundations' then '["Recording transactions in a shared ledger","Guaranteeing trading profits","Storing exchange passwords","Replacing all banks instantly"]'::jsonb
    when 'crypto-safety-security' then '["Your seed phrase","A public wallet address","A transaction hash","A token symbol"]'::jsonb
    when 'portfolio-building-investing' then '["How much capital is at risk","The exact market top","A coin logo","Exchange maintenance windows"]'::jsonb
    when 'crypto-market-cycles' then '["How markets move through phases over time","A wallet backup method","A single candle pattern","A fixed profit guarantee"]'::jsonb
    when 'tokenomics-project-research' then '["They can affect supply pressure","They remove all market risk","They prove code is bug-free","They set gas fees"]'::jsonb
    when 'trading-foundations-charts-orders-market-structure' then '["Trend, ranges, and key levels","Seed phrase strength","Exchange customer support","Token artwork"]'::jsonb
    when 'technical-analysis-masterclass' then '["Entry, invalidation, and risk plan","A guaranteed win rate","A random leverage number","A seed phrase"]'::jsonb
    when 'risk-management-masterclass' then '["Limit downside if the idea fails","Guarantee every trade wins","Avoid learning charts","Increase fees"]'::jsonb
    when 'futures-trading-leverage-liquidation-strategy' then '["It can increase liquidation risk","It removes liquidation risk","It freezes funding rates","It guarantees entries"]'::jsonb
    when 'advanced-derivatives-options-margin' then '["Reduce or offset a specific risk","Make losses impossible","Replace research","Hide fees"]'::jsonb
    when 'trading-psychology-discipline-over-emotions' then '["Journaling and reviewing trades","Chasing every candle","Ignoring risk limits","Changing plans mid-trade"]'::jsonb
    when 'defi-fundamentals' then '["Swapping assets through smart contracts","Storing seed phrases online","Guaranteeing APY forever","Deleting blockchain history"]'::jsonb
    when 'on-chain-analysis' then '["Blockchain transaction and wallet activity","Only social media posts","Exchange passwords","Private keys"]'::jsonb
    when 'blockchain-development-basics' then '["Paying for transaction execution","Buying guaranteed profits","Hiding smart contract code","Resetting a wallet"]'::jsonb
    else '["Review the key idea and apply it safely","Share your seed phrase","Trade with no plan","Ignore risk"]'::jsonb
  end,
  case g.slug
    when 'crypto-foundations' then 'Recording transactions in a shared ledger'
    when 'crypto-safety-security' then 'Your seed phrase'
    when 'portfolio-building-investing' then 'How much capital is at risk'
    when 'crypto-market-cycles' then 'How markets move through phases over time'
    when 'tokenomics-project-research' then 'They can affect supply pressure'
    when 'trading-foundations-charts-orders-market-structure' then 'Trend, ranges, and key levels'
    when 'technical-analysis-masterclass' then 'Entry, invalidation, and risk plan'
    when 'risk-management-masterclass' then 'Limit downside if the idea fails'
    when 'futures-trading-leverage-liquidation-strategy' then 'It can increase liquidation risk'
    when 'advanced-derivatives-options-margin' then 'Reduce or offset a specific risk'
    when 'trading-psychology-discipline-over-emotions' then 'Journaling and reviewing trades'
    when 'defi-fundamentals' then 'Swapping assets through smart contracts'
    when 'on-chain-analysis' then 'Blockchain transaction and wallet activity'
    when 'blockchain-development-basics' then 'Paying for transaction execution'
    else 'Review the key idea and apply it safely'
  end,
  'XP is awarded only after the guide quiz is passed, and each guide can award XP once per account.'
from public.guides as g
where g.is_archived = false
on conflict (guide_id) do nothing;

grant select on public.guide_completions, public.xp_transactions to authenticated;
grant select, insert, update, delete on public.guide_quizzes, public.premium_subscriptions to authenticated;
grant execute on function public.get_xp_required_for_next_level(integer) to anon, authenticated;
grant execute on function public.get_level_from_xp(integer) to anon, authenticated;
grant execute on function public.get_guide_quiz(uuid) to anon, authenticated;
grant execute on function public.submit_guide_quiz(uuid, text) to authenticated;
grant execute on function public.admin_issue_trading_academy_subscription(uuid, timestamptz, timestamptz, integer, text, text) to authenticated;
grant execute on function public.admin_update_trading_academy_subscription(uuid, timestamptz, timestamptz, text) to authenticated;

revoke execute on function public.refresh_premium_subscription_statuses(uuid) from public;
revoke execute on function public.sync_user_trading_academy_profile(uuid) from public;
revoke execute on function public.refresh_premium_subscription_statuses(uuid) from anon, authenticated;
revoke execute on function public.sync_user_trading_academy_profile(uuid) from anon, authenticated;

notify pgrst, 'reload schema';
