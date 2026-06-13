alter table public.xp_transactions
drop constraint if exists xp_transactions_source_type_check;

alter table public.xp_transactions
add constraint xp_transactions_source_type_check
check (source_type in ('guide', 'puzzle_of_day', 'admin_adjustment', 'course_badge', 'loyalty_badge'));

create table if not exists public.user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_type text not null check (badge_type in ('course_completion', 'subscription_loyalty')),
  badge_key text not null,
  name text not null,
  description text not null,
  icon text not null,
  style_variant text not null,
  xp_awarded integer not null check (xp_awarded > 0),
  earned_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, badge_key)
);

drop trigger if exists set_user_badges_updated_at on public.user_badges;
create trigger set_user_badges_updated_at
before update on public.user_badges
for each row execute function public.set_updated_at();

create index if not exists user_badges_user_id_earned_at_idx
on public.user_badges(user_id, earned_at desc);

create index if not exists user_badges_type_idx
on public.user_badges(badge_type);

create or replace function public.course_badge_icon(course_title text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(course_title, '')) like '%trading%' then 'line-chart'
    when lower(coalesce(course_title, '')) like '%defi%' then 'network'
    when lower(coalesce(course_title, '')) like '%blockchain%' then 'blocks'
    when lower(coalesce(course_title, '')) like '%invest%' then 'bar-chart'
    when lower(coalesce(course_title, '')) like '%crypto%' then 'book-open'
    else 'graduation-cap'
  end;
$$;

create or replace function public.course_badge_style(course_title text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(course_title, '')) like '%trading%' then 'course-violet'
    when lower(coalesce(course_title, '')) like '%defi%' then 'course-cyan'
    when lower(coalesce(course_title, '')) like '%blockchain%' then 'course-blue'
    when lower(coalesce(course_title, '')) like '%invest%' then 'course-gold'
    when lower(coalesce(course_title, '')) like '%crypto%' then 'course-emerald'
    else 'course-silver'
  end;
$$;

create or replace function public.award_user_badge(
  target_user_id uuid,
  target_badge_type text,
  target_badge_key text,
  target_name text,
  target_description text,
  target_icon text,
  target_style_variant text,
  target_xp_awarded integer,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  next_badge_id uuid;
  inserted_amount integer;
  transaction_source_type text;
begin
  if target_user_id is null then
    raise exception 'User is required';
  end if;

  if target_badge_type not in ('course_completion', 'subscription_loyalty') then
    raise exception 'Unsupported badge type';
  end if;

  if coalesce(target_xp_awarded, 0) <= 0 then
    raise exception 'Badge XP must be positive';
  end if;

  transaction_source_type := case
    when target_badge_type = 'course_completion' then 'course_badge'
    else 'loyalty_badge'
  end;

  insert into public.user_badges (
    user_id,
    badge_type,
    badge_key,
    name,
    description,
    icon,
    style_variant,
    xp_awarded,
    metadata
  )
  values (
    target_user_id,
    target_badge_type,
    target_badge_key,
    trim(target_name),
    trim(target_description),
    trim(target_icon),
    trim(target_style_variant),
    target_xp_awarded,
    coalesce(target_metadata, '{}'::jsonb)
  )
  on conflict (user_id, badge_key) do update set
    name = excluded.name,
    description = excluded.description,
    icon = excluded.icon,
    style_variant = excluded.style_variant,
    xp_awarded = excluded.xp_awarded,
    metadata = public.user_badges.metadata || excluded.metadata,
    updated_at = now()
  returning id into next_badge_id;

  inserted_amount := 0;

  insert into public.xp_transactions (
    user_id,
    amount,
    source_type,
    source_id,
    description
  )
  values (
    target_user_id,
    target_xp_awarded,
    transaction_source_type,
    next_badge_id,
    case
      when target_badge_type = 'course_completion' then 'COURSE_BADGE_EARNED: ' || trim(target_name)
      else 'LOYALTY_BADGE_EARNED: ' || trim(target_name)
    end
  )
  on conflict (user_id, source_type, source_id) do nothing
  returning amount into inserted_amount;

  inserted_amount := coalesce(inserted_amount, 0);

  if inserted_amount > 0 then
    insert into public.profiles (id, total_xp)
    values (target_user_id, inserted_amount)
    on conflict (id) do update set
      total_xp = public.profiles.total_xp + excluded.total_xp;
  end if;

  return next_badge_id;
end;
$$;

revoke execute on function public.award_user_badge(uuid, text, text, text, text, text, text, integer, jsonb) from public;

create or replace function public.check_and_award_course_badge_for_course(
  target_user_id uuid,
  target_course_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  course_record record;
  required_guides integer := 0;
  guides_with_quizzes integer := 0;
  completed_guides integer := 0;
  completed_guide_ids jsonb := '[]'::jsonb;
  completed_quiz_ids jsonb := '[]'::jsonb;
  next_badge_id uuid;
begin
  if target_user_id is null then
    target_user_id := auth.uid();
  end if;

  if target_user_id is null then
    raise exception 'Login is required to evaluate badges';
  end if;

  if target_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Only admins can evaluate another user';
  end if;

  if target_course_id is null then
    return null;
  end if;

  select c.*
  into course_record
  from public.courses as c
  where c.id = target_course_id
    and c.is_archived = false;

  if not found then
    return null;
  end if;

  select
    count(distinct g.id)::integer,
    count(distinct case when gq.id is not null then g.id end)::integer,
    count(distinct case when gc.quiz_passed = true then g.id end)::integer
  into required_guides, guides_with_quizzes, completed_guides
  from public.guides as g
  left join public.guide_quizzes as gq
    on gq.guide_id = g.id
   and gq.is_active = true
  left join public.guide_completions as gc
    on gc.guide_id = g.id
   and gc.user_id = target_user_id
   and gc.quiz_passed = true
  where g.course_id = target_course_id
    and g.is_archived = false;

  if required_guides = 0
    or guides_with_quizzes <> required_guides
    or completed_guides <> required_guides
  then
    return null;
  end if;

  select coalesce(jsonb_agg(g.id order by g.sort_order, g.title), '[]'::jsonb)
  into completed_guide_ids
  from public.guides as g
  where g.course_id = target_course_id
    and g.is_archived = false;

  select coalesce(jsonb_agg(gc.guide_quiz_id order by gc.completed_at), '[]'::jsonb)
  into completed_quiz_ids
  from public.guide_completions as gc
  join public.guides as g on g.id = gc.guide_id
  where gc.user_id = target_user_id
    and gc.quiz_passed = true
    and gc.guide_quiz_id is not null
    and g.course_id = target_course_id
    and g.is_archived = false;

  next_badge_id := public.award_user_badge(
    target_user_id,
    'course_completion',
    'course_completion:' || course_record.id::text,
    course_record.title,
    'Completed every guide quiz in ' || course_record.title || '.',
    public.course_badge_icon(course_record.title),
    public.course_badge_style(course_record.title),
    100,
    jsonb_build_object(
      'courseId', course_record.id,
      'courseName', course_record.title,
      'completedGuideIds', completed_guide_ids,
      'completedQuizIds', completed_quiz_ids
    )
  );

  return next_badge_id;
end;
$$;

create or replace function public.check_and_award_course_badges(target_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  course_record record;
begin
  if target_user_id is null then
    target_user_id := auth.uid();
  end if;

  if target_user_id is null then
    raise exception 'Login is required to evaluate badges';
  end if;

  if target_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Only admins can evaluate another user';
  end if;

  for course_record in
    select distinct c.id
    from public.courses as c
    join public.guides as g on g.course_id = c.id
    where c.is_archived = false
      and g.is_archived = false
  loop
    perform public.check_and_award_course_badge_for_course(target_user_id, course_record.id);
  end loop;
end;
$$;

create or replace function public.check_and_award_subscription_loyalty_badges(target_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  period_record record;
  period_cutoff timestamptz;
  earned_months integer;
  month_number integer;
  xp_award integer;
  period_key text;
  next_style_variant text;
  next_icon text;
begin
  if target_user_id is null then
    target_user_id := auth.uid();
  end if;

  if target_user_id is null then
    raise exception 'Login is required to evaluate badges';
  end if;

  if target_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Only admins can evaluate another user';
  end if;

  perform public.refresh_premium_subscription_statuses(target_user_id);

  for period_record in
    with ordered_subscriptions as (
      select
        ps.starts_at,
        ps.expires_at,
        max(ps.expires_at) over (
          order by ps.starts_at, ps.expires_at
          rows between unbounded preceding and 1 preceding
        ) as previous_period_end
      from public.premium_subscriptions as ps
      where ps.user_id = target_user_id
        and ps.product_type = 'premium'
        and ps.status not in ('cancelled', 'failed')
        and ps.starts_at <= now()
        and ps.expires_at > ps.starts_at
    ),
    grouped_subscriptions as (
      select
        starts_at,
        expires_at,
        sum(
          case
            when previous_period_end is null then 1
            when starts_at > previous_period_end then 1
            else 0
          end
        ) over (order by starts_at, expires_at) as period_number
      from ordered_subscriptions
    )
    select
      min(starts_at) as period_start,
      max(expires_at) as period_end
    from grouped_subscriptions
    group by period_number
    order by min(starts_at)
  loop
    period_cutoff := least(period_record.period_end, now());
    earned_months := greatest(
      0,
      (
        extract(year from age(period_cutoff, period_record.period_start))::integer * 12
        + extract(month from age(period_cutoff, period_record.period_start))::integer
      )
    );

    if earned_months >= 2 then
      period_key := to_char(period_record.period_start at time zone 'utc', 'YYYYMMDDHH24MISS');

      for month_number in 2..earned_months loop
        xp_award := 500 + ((month_number - 2) * 100);
        next_style_variant := case
          when month_number >= 12 then 'loyalty-diamond'
          when month_number >= 6 then 'loyalty-platinum'
          else 'loyalty-gold'
        end;
        next_icon := case
          when month_number >= 12 then 'diamond'
          when month_number >= 6 then 'star'
          else 'crown'
        end;

        perform public.award_user_badge(
          target_user_id,
          'subscription_loyalty',
          'subscription_loyalty:' || period_key || ':month:' || month_number::text,
          month_number::text || ' Month Loyal Subscriber',
          'Maintained continuous Trading Academy access for ' || month_number::text || ' months.',
          next_icon,
          next_style_variant,
          xp_award,
          jsonb_build_object(
            'subscriptionMonthNumber', month_number,
            'continuousMonths', earned_months,
            'subscriptionPeriodStart', period_record.period_start,
            'subscriptionPeriodEnd', period_record.period_end
          )
        );
      end loop;
    end if;
  end loop;
end;
$$;

create or replace function public.evaluate_user_badges(target_user_id uuid default null)
returns table (
  id uuid,
  user_id uuid,
  badge_type text,
  badge_key text,
  name text,
  description text,
  icon text,
  style_variant text,
  xp_awarded integer,
  earned_at timestamptz,
  metadata jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_user_id is null then
    target_user_id := auth.uid();
  end if;

  if target_user_id is null then
    raise exception 'Login is required to evaluate badges';
  end if;

  if target_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Only admins can evaluate another user';
  end if;

  perform public.check_and_award_course_badges(target_user_id);
  perform public.check_and_award_subscription_loyalty_badges(target_user_id);

  return query
  select
    ub.id,
    ub.user_id,
    ub.badge_type,
    ub.badge_key,
    ub.name,
    ub.description,
    ub.icon,
    ub.style_variant,
    ub.xp_awarded,
    ub.earned_at,
    ub.metadata
  from public.user_badges as ub
  where ub.user_id = target_user_id
  order by ub.xp_awarded desc, ub.earned_at desc, ub.name asc;
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

  if passed then
    perform public.check_and_award_course_badges(auth.uid());
  end if;

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

drop function if exists public.get_trading_academy_leaderboard();

create or replace function public.get_trading_academy_leaderboard()
returns table (
  rank integer,
  member_key text,
  display_name text,
  avatar_url text,
  level integer,
  total_xp integer,
  joined_at timestamptz,
  badges jsonb,
  badge_count integer
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
  with active_members as (
    select
      ps.user_id,
      min(ps.starts_at) as joined_at
    from public.premium_subscriptions as ps
    where ps.product_type = 'premium'
      and ps.status in ('pending', 'active')
      and ps.starts_at <= now()
      and ps.expires_at > now()
    group by ps.user_id
  )
  select
    row_number() over (
      order by p.level desc, p.total_xp desc, active_members.joined_at asc, p.id asc
    )::integer as rank,
    substr(md5(p.id::text), 1, 16) as member_key,
    coalesce(nullif(p.username, ''), nullif(p.full_name, ''), 'Academy learner') as display_name,
    nullif(p.avatar_url, '') as avatar_url,
    p.level,
    p.total_xp,
    active_members.joined_at,
    coalesce(public_badges.badges, '[]'::jsonb) as badges,
    coalesce(public_badges.badge_count, 0)::integer as badge_count
  from active_members
  join public.profiles as p on p.id = active_members.user_id
  left join lateral (
    select
      count(*)::integer as badge_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', ranked_badges.id,
            'badge_type', ranked_badges.badge_type,
            'name', ranked_badges.name,
            'description', ranked_badges.description,
            'icon', ranked_badges.icon,
            'style_variant', ranked_badges.style_variant,
            'xp_awarded', ranked_badges.xp_awarded,
            'earned_at', ranked_badges.earned_at,
            'metadata', case
              when ranked_badges.badge_type = 'course_completion' then jsonb_build_object(
                'courseName', ranked_badges.metadata->>'courseName'
              )
              else jsonb_build_object(
                'subscriptionMonthNumber', ranked_badges.metadata->>'subscriptionMonthNumber'
              )
            end
          )
          order by ranked_badges.xp_awarded desc, ranked_badges.earned_at desc
        ),
        '[]'::jsonb
      ) as badges
    from (
      select
        ub.*
      from public.user_badges as ub
      where ub.user_id = p.id
      order by ub.xp_awarded desc, ub.earned_at desc, ub.name asc
    ) as ranked_badges
  ) as public_badges on true
  where p.role <> 'admin'
  order by p.level desc, p.total_xp desc, active_members.joined_at asc, p.id asc;
end;
$$;

alter table public.user_badges enable row level security;

drop policy if exists "user_badges_select_owner_or_admin" on public.user_badges;
create policy "user_badges_select_owner_or_admin"
on public.user_badges for select
using (auth.uid() = user_id or public.is_admin());

grant select on public.user_badges to authenticated;
grant execute on function public.check_and_award_course_badge_for_course(uuid, uuid) to authenticated;
grant execute on function public.check_and_award_course_badges(uuid) to authenticated;
grant execute on function public.check_and_award_subscription_loyalty_badges(uuid) to authenticated;
grant execute on function public.evaluate_user_badges(uuid) to authenticated;
grant execute on function public.submit_guide_quiz(uuid, text) to authenticated;
grant execute on function public.get_trading_academy_leaderboard() to authenticated;

notify pgrst, 'reload schema';
