create table if not exists public.demo_trade_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  starting_balance numeric(24, 8) not null default 0 check (starting_balance >= 0),
  current_balance numeric(24, 8) not null default 0 check (current_balance >= 0),
  available_balance numeric(24, 8) not null default 0 check (available_balance >= 0),
  realized_pnl numeric(24, 8) not null default 0,
  unrealized_pnl numeric(24, 8) not null default 0,
  open_position jsonb,
  trade_history jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  reset_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(state) = 'object'),
  check (open_position is null or jsonb_typeof(open_position) = 'object'),
  check (jsonb_typeof(trade_history) = 'array'),
  check (jsonb_typeof(settings) = 'object')
);

drop trigger if exists set_demo_trade_states_updated_at on public.demo_trade_states;
create trigger set_demo_trade_states_updated_at
before update on public.demo_trade_states
for each row execute function public.set_updated_at();

alter table public.demo_trade_states enable row level security;

drop policy if exists "Users can read own demo trade state" on public.demo_trade_states;
create policy "Users can read own demo trade state"
on public.demo_trade_states
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own demo trade state" on public.demo_trade_states;
create policy "Users can insert own demo trade state"
on public.demo_trade_states
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own demo trade state" on public.demo_trade_states;
create policy "Users can update own demo trade state"
on public.demo_trade_states
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.validate_demo_trade_state(next_state jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  tp_total numeric := 0;
  tp_item jsonb;
begin
  if next_state is null or jsonb_typeof(next_state) <> 'object' then
    return false;
  end if;

  if coalesce(next_state->>'symbol', '') <> 'BTCUSDT' then
    return false;
  end if;

  if coalesce((next_state->>'startingBalance')::numeric, -1) < 0
    or coalesce((next_state->>'currentBalance')::numeric, -1) < 0
    or coalesce((next_state->>'availableBalance')::numeric, -1) < 0 then
    return false;
  end if;

  if next_state ? 'openPosition'
    and next_state->'openPosition' is not null
    and jsonb_typeof(next_state->'openPosition') <> 'null'
    and jsonb_typeof(next_state->'openPosition') <> 'object' then
    return false;
  end if;

  if jsonb_typeof(coalesce(next_state->'tradeHistory', '[]'::jsonb)) <> 'array' then
    return false;
  end if;

  if next_state->'openPosition' is not null and jsonb_typeof(next_state->'openPosition') = 'object' then
    if coalesce(next_state->'openPosition'->>'symbol', '') <> 'BTCUSDT' then
      return false;
    end if;

    if coalesce((next_state->'openPosition'->>'leverage')::numeric, 0) < 1
      or coalesce((next_state->'openPosition'->>'leverage')::numeric, 0) > 100 then
      return false;
    end if;

    if jsonb_typeof(coalesce(next_state->'openPosition'->'takeProfits', '[]'::jsonb)) <> 'array' then
      return false;
    end if;

    for tp_item in select value from jsonb_array_elements(coalesce(next_state->'openPosition'->'takeProfits', '[]'::jsonb))
    loop
      if coalesce((tp_item->>'price')::numeric, 0) <= 0
        or coalesce((tp_item->>'closePercent')::numeric, 0) <= 0 then
        return false;
      end if;
      tp_total := tp_total + coalesce((tp_item->>'closePercent')::numeric, 0);
    end loop;

    if tp_total > 100.0001 then
      return false;
    end if;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function public.save_demo_trade_state(next_state jsonb)
returns public.demo_trade_states
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid := auth.uid();
  saved_state public.demo_trade_states;
begin
  if target_user_id is null then
    raise exception 'Login is required';
  end if;

  if not public.validate_demo_trade_state(next_state) then
    raise exception 'Demo trade state is invalid';
  end if;

  insert into public.demo_trade_states (
    user_id,
    state,
    starting_balance,
    current_balance,
    available_balance,
    realized_pnl,
    unrealized_pnl,
    open_position,
    trade_history,
    settings,
    reset_at,
    updated_at
  )
  values (
    target_user_id,
    next_state,
    (next_state->>'startingBalance')::numeric,
    (next_state->>'currentBalance')::numeric,
    (next_state->>'availableBalance')::numeric,
    coalesce((next_state->>'realizedPnl')::numeric, 0),
    coalesce((next_state->>'unrealizedPnl')::numeric, 0),
    nullif(next_state->'openPosition', 'null'::jsonb),
    coalesce(next_state->'tradeHistory', '[]'::jsonb),
    coalesce(next_state->'settings', '{}'::jsonb),
    nullif(next_state->>'resetAt', '')::timestamptz,
    now()
  )
  on conflict (user_id) do update
  set
    state = excluded.state,
    starting_balance = excluded.starting_balance,
    current_balance = excluded.current_balance,
    available_balance = excluded.available_balance,
    realized_pnl = excluded.realized_pnl,
    unrealized_pnl = excluded.unrealized_pnl,
    open_position = excluded.open_position,
    trade_history = excluded.trade_history,
    settings = excluded.settings,
    reset_at = excluded.reset_at,
    updated_at = now()
  returning * into saved_state;

  return saved_state;
end;
$$;
