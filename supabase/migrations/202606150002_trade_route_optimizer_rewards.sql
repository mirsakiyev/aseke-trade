alter table public.xp_transactions
drop constraint if exists xp_transactions_source_type_check;

alter table public.xp_transactions
add constraint xp_transactions_source_type_check
check (source_type in ('guide', 'puzzle_of_day', 'admin_adjustment', 'course_badge', 'loyalty_badge', 'trade_route_optimizer'));

create table if not exists public.route_optimizer_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  puzzle_type text not null default 'trade_route_optimizer',
  puzzle_date date not null,
  puzzle_seed text not null,
  selected_route jsonb not null,
  user_result jsonb not null,
  optimal_route jsonb not null,
  score integer not null check (score between 0 and 100),
  starting_balance numeric not null default 1000 check (starting_balance > 0),
  reference_prices_used jsonb not null default '{}'::jsonb,
  xp_awarded integer not null default 0 check (xp_awarded >= 0),
  xp_outcome text not null check (xp_outcome in ('profit', 'loss', 'breakeven')),
  xp_multiplier numeric not null default 0 check (xp_multiplier >= 0),
  rounded_profit numeric not null default 0,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, puzzle_type, puzzle_date)
);

drop trigger if exists set_route_optimizer_completions_updated_at on public.route_optimizer_completions;
create trigger set_route_optimizer_completions_updated_at
before update on public.route_optimizer_completions
for each row execute function public.set_updated_at();

create index if not exists route_optimizer_completions_user_date_idx
on public.route_optimizer_completions(user_id, puzzle_date desc);

create or replace function public.submit_trade_route_optimizer_completion(
  target_puzzle_date date,
  target_puzzle_seed text,
  selected_route jsonb,
  user_result jsonb,
  optimal_route jsonb,
  target_score integer,
  target_starting_balance numeric default 1000,
  reference_prices_used jsonb default '{}'::jsonb
)
returns table (
  completion_id uuid,
  xp_awarded integer,
  xp_outcome text,
  xp_multiplier numeric,
  rounded_profit numeric,
  total_xp integer,
  level integer,
  already_completed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_completion record;
  inserted_completion record;
  next_profile record;
  safe_date date := coalesce(target_puzzle_date, current_date);
  safe_seed text := left(nullif(trim(coalesce(target_puzzle_seed, '')), ''), 180);
  safe_starting_balance numeric := coalesce(target_starting_balance, 1000);
  safe_score integer := coalesce(target_score, 0);
  final_usdt numeric;
  safe_multiplier numeric := 0;
  safe_xp_awarded integer := 0;
  inserted_amount integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Login is required to earn XP';
  end if;

  if safe_seed is null then
    raise exception 'Puzzle seed is required';
  end if;

  if safe_starting_balance <= 0 then
    raise exception 'Starting balance must be positive';
  end if;

  if safe_score < 0 or safe_score > 100 then
    raise exception 'Score must be between 0 and 100';
  end if;

  if jsonb_typeof(selected_route) <> 'object'
    or jsonb_typeof(user_result) <> 'object'
    or jsonb_typeof(optimal_route) <> 'object' then
    raise exception 'Completion payload is invalid';
  end if;

  select roc.*
  into existing_completion
  from public.route_optimizer_completions as roc
  where roc.user_id = auth.uid()
    and roc.puzzle_type = 'trade_route_optimizer'
    and roc.puzzle_date = safe_date
  limit 1;

  if found then
    select p.total_xp, p.level
    into next_profile
    from public.profiles as p
    where p.id = auth.uid();

    completion_id := existing_completion.id;
    xp_awarded := existing_completion.xp_awarded;
    xp_outcome := existing_completion.xp_outcome;
    xp_multiplier := existing_completion.xp_multiplier;
    rounded_profit := existing_completion.rounded_profit;
    total_xp := coalesce(next_profile.total_xp, 0);
    level := coalesce(next_profile.level, 1);
    already_completed := true;
    return next;
    return;
  end if;

  final_usdt := nullif(user_result->>'finalUSDT', '')::numeric;

  if final_usdt is null then
    raise exception 'Final USDT is required';
  end if;

  rounded_profit := round(final_usdt - safe_starting_balance, 2);

  if rounded_profit < 0 then
    xp_outcome := 'loss';
    safe_multiplier := 0;
    safe_xp_awarded := 0;
  elsif rounded_profit = 0 then
    xp_outcome := 'breakeven';
    safe_multiplier := 1;
    safe_xp_awarded := 100;
  else
    xp_outcome := 'profit';
    safe_multiplier := least(1 + ((rounded_profit / safe_starting_balance) * 10), 2);
    safe_xp_awarded := greatest(101, round(100 * safe_multiplier)::integer);
  end if;

  insert into public.route_optimizer_completions (
    user_id,
    puzzle_type,
    puzzle_date,
    puzzle_seed,
    selected_route,
    user_result,
    optimal_route,
    score,
    starting_balance,
    reference_prices_used,
    xp_awarded,
    xp_outcome,
    xp_multiplier,
    rounded_profit,
    completed_at
  )
  values (
    auth.uid(),
    'trade_route_optimizer',
    safe_date,
    safe_seed,
    selected_route,
    user_result,
    optimal_route,
    safe_score,
    safe_starting_balance,
    coalesce(reference_prices_used, '{}'::jsonb),
    safe_xp_awarded,
    xp_outcome,
    safe_multiplier,
    rounded_profit,
    now()
  )
  returning *
  into inserted_completion;

  if safe_xp_awarded > 0 then
    insert into public.xp_transactions (
      user_id,
      amount,
      source_type,
      source_id,
      description
    )
    values (
      auth.uid(),
      safe_xp_awarded,
      'trade_route_optimizer',
      inserted_completion.id,
      'Trade Route Optimizer daily puzzle'
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

  select p.total_xp, p.level
  into next_profile
  from public.profiles as p
  where p.id = auth.uid();

  completion_id := inserted_completion.id;
  xp_awarded := safe_xp_awarded;
  xp_multiplier := safe_multiplier;
  total_xp := coalesce(next_profile.total_xp, 0);
  level := coalesce(next_profile.level, 1);
  already_completed := false;
  return next;
end;
$$;

alter table public.route_optimizer_completions enable row level security;

drop policy if exists "route_optimizer_completions_select_owner_or_admin" on public.route_optimizer_completions;
create policy "route_optimizer_completions_select_owner_or_admin"
on public.route_optimizer_completions for select
using (user_id = auth.uid() or public.is_admin());

grant select on public.route_optimizer_completions to authenticated;
grant execute on function public.submit_trade_route_optimizer_completion(date, text, jsonb, jsonb, jsonb, integer, numeric, jsonb) to authenticated;

notify pgrst, 'reload schema';
