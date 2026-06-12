drop function if exists public.get_trading_academy_leaderboard();

create or replace function public.get_trading_academy_leaderboard()
returns table (
  rank integer,
  member_key text,
  display_name text,
  avatar_url text,
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
    active_members.joined_at
  from active_members
  join public.profiles as p on p.id = active_members.user_id
  where p.role <> 'admin'
  order by p.level desc, p.total_xp desc, active_members.joined_at asc, p.id asc;
end;
$$;

grant execute on function public.get_trading_academy_leaderboard() to authenticated;

notify pgrst, 'reload schema';
