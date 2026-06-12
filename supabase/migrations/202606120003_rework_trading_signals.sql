create or replace function public.generate_trading_signal_title(signal_direction text, signal_leverage integer)
returns text
language sql
immutable
as $$
  select upper(coalesce(nullif(signal_direction, ''), 'long')) || ' ' || coalesce(signal_leverage, 1)::text || 'X';
$$;

create or replace function public.migrate_trading_signal_take_profits(
  tp1 numeric,
  tp2 numeric,
  tp3 numeric,
  additional jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  prices text[] := array[]::text[];
  item jsonb;
  safe_price text;
  tp_count integer;
  base_tenths integer;
  remainder_tenths integer;
  current_percent numeric;
  result jsonb := '[]'::jsonb;
  index integer;
begin
  if tp1 is not null and tp1 > 0 then
    prices := prices || tp1::text;
  end if;

  if tp2 is not null and tp2 > 0 then
    prices := prices || tp2::text;
  end if;

  if tp3 is not null and tp3 > 0 then
    prices := prices || tp3::text;
  end if;

  if jsonb_typeof(coalesce(additional, '[]'::jsonb)) = 'array' then
    for item in select value from jsonb_array_elements(coalesce(additional, '[]'::jsonb))
    loop
      safe_price := nullif(trim(both '"' from item::text), '');
      if safe_price is not null and safe_price ~ '^\d+(\.\d+)?$' and safe_price::numeric > 0 then
        prices := prices || safe_price;
      end if;
    end loop;
  end if;

  tp_count := coalesce(array_length(prices, 1), 0);
  if tp_count = 0 then
    prices := array['1'];
    tp_count := 1;
  end if;

  base_tenths := floor(1000.0 / tp_count);
  remainder_tenths := 1000 - (base_tenths * tp_count);

  for index in 1..tp_count
  loop
    current_percent := (base_tenths + case when index = tp_count then remainder_tenths else 0 end) / 10.0;
    result := result || jsonb_build_object(
      'id', 'tp-' || index::text,
      'price', prices[index],
      'positionSizePercent', current_percent,
      'isHit', false,
      'hitAt', null
    );
  end loop;

  return result;
end;
$$;

create or replace function public.validate_trading_signal_take_profits(items jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  item jsonb;
  price_text text;
  percent_text text;
  total_percent numeric := 0;
begin
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    return false;
  end if;

  for item in select value from jsonb_array_elements(items)
  loop
    price_text := nullif(trim(coalesce(item->>'price', '')), '');
    percent_text := nullif(trim(coalesce(item->>'positionSizePercent', item->>'position_size_percent', '')), '');

    if price_text is null or price_text !~ '^\d+(\.\d+)?$' or price_text::numeric <= 0 then
      return false;
    end if;

    if percent_text is null or percent_text !~ '^\d+(\.\d+)?$' or percent_text::numeric < 0 then
      return false;
    end if;

    total_percent := total_percent + percent_text::numeric;
  end loop;

  return abs(total_percent - 100) <= 0.0001;
end;
$$;

alter table public.trading_signals
add column if not exists leverage integer not null default 1,
add column if not exists generated_title text,
add column if not exists take_profits jsonb,
add column if not exists original_signal jsonb,
add column if not exists updates jsonb,
add column if not exists closed_at timestamptz,
add column if not exists manual_close_price numeric(24, 10),
add column if not exists final_price numeric(24, 10),
add column if not exists final_roi numeric(14, 4);

alter table public.trading_signals
alter column take_profit_1 drop not null,
alter column take_profit_2 drop not null,
alter column take_profit_3 drop not null;

alter table public.trading_signals
drop constraint if exists trading_signals_direction_check,
drop constraint if exists trading_signals_status_check,
drop constraint if exists trading_signals_leverage_check,
drop constraint if exists trading_signals_take_profits_check,
drop constraint if exists trading_signals_updates_check,
drop constraint if exists trading_signals_original_signal_check;

update public.trading_signals
set
  direction = case when lower(direction) = 'short' then 'short' else 'long' end,
  status = case
    when lower(status) = 'hit_tp' then 'hit_tp'
    when lower(status) = 'hit_sl' then 'hit_sl'
    when lower(status) in ('closed', 'cancelled') then 'manually_closed'
    else 'active'
  end,
  leverage = least(100, greatest(1, coalesce(nullif(leverage, 0), 1)));

update public.trading_signals
set
  take_profits = case
    when take_profits is null or jsonb_typeof(take_profits) <> 'array' or jsonb_array_length(take_profits) = 0
      then public.migrate_trading_signal_take_profits(take_profit_1, take_profit_2, take_profit_3, additional_take_profits)
    else take_profits
  end,
  generated_title = public.generate_trading_signal_title(direction, leverage),
  title = public.generate_trading_signal_title(direction, leverage),
  updates = case
    when updates is null or jsonb_typeof(updates) <> 'array' or jsonb_array_length(updates) = 0
      then jsonb_build_array(jsonb_build_object(
        'id', id::text || '-created',
        'type', 'signal_created',
        'message', 'Signal created',
        'createdAt', created_at,
        'metadata', null
      ))
    else updates
  end;

update public.trading_signals
set
  original_signal = coalesce(original_signal, jsonb_build_object(
    'generatedTitle', generated_title,
    'symbol', symbol,
    'direction', direction,
    'leverage', leverage,
    'entryPrice', entry_price,
    'stopLoss', stop_loss,
    'takeProfits', take_profits,
    'priceAtCreation', price_at_creation,
    'notes', notes,
    'createdAt', created_at
  )),
  closed_at = case
    when status in ('hit_tp', 'hit_sl', 'manually_closed') then coalesce(closed_at, updated_at, created_at)
    else closed_at
  end,
  final_price = case
    when status = 'hit_sl' then coalesce(final_price, stop_loss)
    else final_price
  end;

alter table public.trading_signals
alter column generated_title set not null,
alter column take_profits set not null,
alter column take_profits set default '[]'::jsonb,
alter column updates set not null,
alter column updates set default '[]'::jsonb,
alter column original_signal set not null;

alter table public.trading_signals
add constraint trading_signals_direction_check check (direction in ('long', 'short')),
add constraint trading_signals_status_check check (status in ('active', 'hit_tp', 'hit_sl', 'manually_closed')),
add constraint trading_signals_leverage_check check (leverage between 1 and 100),
add constraint trading_signals_take_profits_check check (public.validate_trading_signal_take_profits(take_profits)),
add constraint trading_signals_updates_check check (jsonb_typeof(updates) = 'array'),
add constraint trading_signals_original_signal_check check (jsonb_typeof(original_signal) = 'object');

create or replace function public.prepare_trading_signal_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.leverage is null then
    new.leverage := 1;
  end if;

  new.generated_title := public.generate_trading_signal_title(new.direction, new.leverage);
  new.title := new.generated_title;

  if new.take_profits is null or jsonb_typeof(new.take_profits) <> 'array' or jsonb_array_length(new.take_profits) = 0 then
    new.take_profits := public.migrate_trading_signal_take_profits(
      new.take_profit_1,
      new.take_profit_2,
      new.take_profit_3,
      new.additional_take_profits
    );
  end if;

  if new.updates is null or jsonb_typeof(new.updates) <> 'array' then
    new.updates := '[]'::jsonb;
  end if;

  if tg_op = 'INSERT' then
    if new.original_signal is null then
      new.original_signal := jsonb_build_object(
        'generatedTitle', new.generated_title,
        'symbol', new.symbol,
        'direction', new.direction,
        'leverage', new.leverage,
        'entryPrice', new.entry_price,
        'stopLoss', new.stop_loss,
        'takeProfits', new.take_profits,
        'priceAtCreation', new.price_at_creation,
        'notes', new.notes,
        'createdAt', coalesce(new.created_at, now())
      );
    end if;

    if jsonb_array_length(new.updates) = 0 then
      new.updates := jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'type', 'signal_created',
        'message', 'Signal created',
        'createdAt', coalesce(new.created_at, now()),
        'metadata', null
      ));
    end if;
  else
    new.created_at := old.created_at;

    if old.original_signal is not null then
      new.original_signal := old.original_signal;
    elsif new.original_signal is null then
      new.original_signal := jsonb_build_object(
        'generatedTitle', old.generated_title,
        'symbol', old.symbol,
        'direction', old.direction,
        'leverage', old.leverage,
        'entryPrice', old.entry_price,
        'stopLoss', old.stop_loss,
        'takeProfits', old.take_profits,
        'priceAtCreation', old.price_at_creation,
        'notes', old.notes,
        'createdAt', old.created_at
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_trading_signal_record on public.trading_signals;
create trigger prepare_trading_signal_record
before insert or update on public.trading_signals
for each row execute function public.prepare_trading_signal_record();

drop index if exists trading_signals_status_idx;
create index if not exists trading_signals_status_idx
on public.trading_signals(status, created_at desc);

drop policy if exists "trading_signals_select_academy_or_admin" on public.trading_signals;
create policy "trading_signals_select_academy_or_admin"
on public.trading_signals for select
using (
  public.is_admin()
  or public.has_premium_access()
);

notify pgrst, 'reload schema';
