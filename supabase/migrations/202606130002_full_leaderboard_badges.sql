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
            'id', ub.id,
            'badge_type', ub.badge_type,
            'name', ub.name,
            'description', ub.description,
            'icon', ub.icon,
            'style_variant', ub.style_variant,
            'xp_awarded', ub.xp_awarded,
            'earned_at', ub.earned_at,
            'metadata', case
              when ub.badge_type = 'course_completion' then jsonb_build_object(
                'courseName', ub.metadata->>'courseName'
              )
              else jsonb_build_object(
                'subscriptionMonthNumber', ub.metadata->>'subscriptionMonthNumber'
              )
            end
          )
          order by ub.xp_awarded desc, ub.earned_at desc, ub.name asc
        ),
        '[]'::jsonb
      ) as badges
    from public.user_badges as ub
    where ub.user_id = p.id
  ) as public_badges on true
  where p.role <> 'admin'
  order by p.level desc, p.total_xp desc, active_members.joined_at asc, p.id asc;
end;
$$;

grant execute on function public.get_trading_academy_leaderboard() to authenticated;

notify pgrst, 'reload schema';
