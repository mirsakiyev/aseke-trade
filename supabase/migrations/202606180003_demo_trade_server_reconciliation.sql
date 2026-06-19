alter table public.demo_trade_states
add column if not exists last_checked_at timestamptz,
add column if not exists close_reason text check (close_reason is null or close_reason in ('stop_loss', 'take_profit', 'liquidation', 'manual')),
add column if not exists close_price numeric(24, 8),
add column if not exists close_time timestamptz;

create table if not exists public.demo_trade_execution_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id text not null,
  event_key text not null,
  event_type text not null check (event_type in ('limit_fill', 'stop_loss', 'take_profit', 'liquidation', 'manual')),
  symbol text not null default 'BTCUSDT',
  side text not null check (side in ('long', 'short')),
  take_profit_id text,
  trigger_price numeric(24, 8) not null,
  execution_price numeric(24, 8) not null,
  close_percent numeric(9, 4),
  quantity_closed numeric(24, 12) not null default 0,
  realized_pnl numeric(24, 8) not null default 0,
  occurred_at timestamptz not null,
  source text not null default 'historical_candle',
  candle_open_time timestamptz,
  candle_close_time timestamptz,
  was_ambiguous boolean not null default false,
  state_before jsonb,
  state_after jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, trade_id, event_key)
);

create index if not exists demo_trade_execution_events_user_time_idx
on public.demo_trade_execution_events(user_id, occurred_at desc);

create index if not exists demo_trade_execution_events_trade_idx
on public.demo_trade_execution_events(trade_id, occurred_at);

alter table public.demo_trade_execution_events enable row level security;

drop policy if exists "Users can read own demo trade execution events" on public.demo_trade_execution_events;
create policy "Users can read own demo trade execution events"
on public.demo_trade_execution_events
for select
using (auth.uid() = user_id);

create or replace function public.demo_trade_state_last_checked_at(next_state jsonb)
returns timestamptz
language plpgsql
immutable
as $$
begin
  return nullif(next_state->'openPosition'->>'lastCheckedAt', '')::timestamptz;
exception
  when others then
    return null;
end;
$$;

create or replace function public.demo_trade_state_close_reason(next_state jsonb)
returns text
language sql
immutable
as $$
  select nullif(coalesce(
    next_state->'tradeHistory'->0->>'closeReason',
    next_state->'openPosition'->>'closeReason'
  ), '')
$$;

create or replace function public.demo_trade_state_close_price(next_state jsonb)
returns numeric
language plpgsql
immutable
as $$
begin
  return nullif(coalesce(
    next_state->'tradeHistory'->0->>'exitPrice',
    next_state->'openPosition'->>'exitPrice'
  ), '')::numeric;
exception
  when others then
    return null;
end;
$$;

create or replace function public.demo_trade_state_close_time(next_state jsonb)
returns timestamptz
language plpgsql
immutable
as $$
begin
  return nullif(coalesce(
    next_state->'tradeHistory'->0->>'closedAt',
    next_state->'openPosition'->>'closedAt'
  ), '')::timestamptz;
exception
  when others then
    return null;
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
  incoming_updated_at timestamptz := public.demo_trade_state_updated_at(next_state);
  saved_state public.demo_trade_states;
begin
  if target_user_id is null then
    raise exception 'Login is required';
  end if;

  if incoming_updated_at is null or not public.validate_demo_trade_state(next_state) then
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
    last_checked_at,
    close_reason,
    close_price,
    close_time,
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
    public.demo_trade_state_last_checked_at(next_state),
    public.demo_trade_state_close_reason(next_state),
    public.demo_trade_state_close_price(next_state),
    public.demo_trade_state_close_time(next_state),
    incoming_updated_at
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
    last_checked_at = excluded.last_checked_at,
    close_reason = excluded.close_reason,
    close_price = excluded.close_price,
    close_time = excluded.close_time,
    updated_at = incoming_updated_at
  where coalesce(
    public.demo_trade_state_updated_at(public.demo_trade_states.state),
    '-infinity'::timestamptz
  ) <= incoming_updated_at
  returning * into saved_state;

  if saved_state is null then
    select *
    into saved_state
    from public.demo_trade_states
    where user_id = target_user_id;
  end if;

  return saved_state;
end;
$$;

create or replace function public.save_reconciled_demo_trade_state(
  next_state jsonb,
  base_updated_at timestamptz,
  base_trade_id text,
  execution_events jsonb default '[]'::jsonb
)
returns public.demo_trade_states
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid := nullif(next_state->>'userId', '')::uuid;
  incoming_updated_at timestamptz := public.demo_trade_state_updated_at(next_state);
  current_state public.demo_trade_states;
  saved_state public.demo_trade_states;
  current_trade_id text;
  current_updated_at timestamptz;
  event_item jsonb;
begin
  if target_user_id is null then
    raise exception 'Demo trade user id is required';
  end if;

  if incoming_updated_at is null or not public.validate_demo_trade_state(next_state) then
    raise exception 'Demo trade state is invalid';
  end if;

  select *
  into current_state
  from public.demo_trade_states
  where user_id = target_user_id
  for update;

  if current_state.user_id is not null then
    current_trade_id := current_state.state->'openPosition'->>'tradeId';
    current_updated_at := public.demo_trade_state_updated_at(current_state.state);

    if current_trade_id is distinct from base_trade_id
      or coalesce(current_updated_at, '-infinity'::timestamptz) > coalesce(base_updated_at, '-infinity'::timestamptz) then
      return current_state;
    end if;
  end if;

  for event_item in select value from jsonb_array_elements(coalesce(execution_events, '[]'::jsonb))
  loop
    insert into public.demo_trade_execution_events (
      user_id,
      trade_id,
      event_key,
      event_type,
      symbol,
      side,
      take_profit_id,
      trigger_price,
      execution_price,
      close_percent,
      quantity_closed,
      realized_pnl,
      occurred_at,
      source,
      candle_open_time,
      candle_close_time,
      was_ambiguous,
      state_before,
      state_after
    )
    values (
      target_user_id,
      event_item->>'tradeId',
      event_item->>'eventKey',
      event_item->>'eventType',
      coalesce(event_item->>'symbol', 'BTCUSDT'),
      event_item->>'side',
      nullif(event_item->>'takeProfitId', ''),
      (event_item->>'triggerPrice')::numeric,
      (event_item->>'executionPrice')::numeric,
      nullif(event_item->>'closePercent', '')::numeric,
      coalesce((event_item->>'quantityClosed')::numeric, 0),
      coalesce((event_item->>'realizedPnl')::numeric, 0),
      (event_item->>'occurredAt')::timestamptz,
      coalesce(event_item->>'source', 'historical_candle'),
      nullif(event_item->>'candleOpenTime', '')::timestamptz,
      nullif(event_item->>'candleCloseTime', '')::timestamptz,
      coalesce((event_item->>'wasAmbiguous')::boolean, false),
      current_state.state,
      next_state
    )
    on conflict (user_id, trade_id, event_key) do nothing;
  end loop;

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
    last_checked_at,
    close_reason,
    close_price,
    close_time,
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
    public.demo_trade_state_last_checked_at(next_state),
    public.demo_trade_state_close_reason(next_state),
    public.demo_trade_state_close_price(next_state),
    public.demo_trade_state_close_time(next_state),
    incoming_updated_at
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
    last_checked_at = excluded.last_checked_at,
    close_reason = excluded.close_reason,
    close_price = excluded.close_price,
    close_time = excluded.close_time,
    updated_at = incoming_updated_at
  returning * into saved_state;

  return saved_state;
end;
$$;

do $$
begin
  execute 'create extension if not exists pg_cron with schema extensions';
exception
  when others then
    raise notice 'pg_cron extension is not available in this environment: %', sqlerrm;
end;
$$;

do $$
begin
  execute 'create extension if not exists pg_net with schema extensions';
exception
  when others then
    raise notice 'pg_net extension is not available in this environment: %', sqlerrm;
end;
$$;

do $$
declare
  reconcile_url text := nullif(current_setting('app.settings.demo_trade_reconcile_url', true), '');
  reconcile_token text := nullif(current_setting('app.settings.demo_trade_reconcile_token', true), '');
begin
  if reconcile_url is not null and reconcile_token is not null and to_regproc('cron.schedule') is not null then
    begin
      execute format('select cron.unschedule(%L)', 'demo-trade-reconcile-every-5-minutes');
    exception
      when others then
        null;
    end;

    execute format(
      'select cron.schedule(%L, %L, %L)',
      'demo-trade-reconcile-every-5-minutes',
      '*/5 * * * *',
      format(
        $job$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || %L,
            'Content-Type', 'application/json'
          ),
          body := '{"scope":"all"}'::jsonb
        );
        $job$,
        reconcile_url,
        reconcile_token
      )
    );
  end if;
exception
  when others then
    raise notice 'Demo trade reconciliation cron was not scheduled automatically: %', sqlerrm;
end;
$$;

revoke execute on function public.save_reconciled_demo_trade_state(jsonb, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_reconciled_demo_trade_state(jsonb, timestamptz, text, jsonb) to service_role;
grant select on table public.demo_trade_execution_events to authenticated;

notify pgrst, 'reload schema';
