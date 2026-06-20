create or replace function public.demo_trade_state_has_closed_trade(next_state jsonb, target_trade_id text)
returns boolean
language sql
immutable
as $$
  select target_trade_id is not null
    and exists (
      select 1
      from jsonb_array_elements(coalesce(next_state->'tradeHistory', '[]'::jsonb)) as trade(value)
      where trade.value->>'tradeId' = target_trade_id
    );
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
    or public.demo_trade_state_has_closed_trade(
      excluded.state,
      public.demo_trade_states.state->'openPosition'->>'tradeId'
    )
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

revoke execute on function public.save_demo_trade_state(jsonb) from anon;
grant execute on function public.save_demo_trade_state(jsonb) to authenticated;

notify pgrst, 'reload schema';
