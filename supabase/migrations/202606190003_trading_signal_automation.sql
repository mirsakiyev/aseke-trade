alter table public.trading_signals
add column if not exists last_checked_at timestamptz,
add column if not exists last_auto_update_price numeric(24, 10),
add column if not exists last_auto_update_source text;

create index if not exists trading_signals_active_reconcile_idx
on public.trading_signals(status, is_active, last_checked_at, created_at)
where status = 'active';

create or replace function public.trading_signal_update_count(signal_updates jsonb)
returns integer
language sql
immutable
as $$
  select case
    when jsonb_typeof(coalesce(signal_updates, '[]'::jsonb)) = 'array'
      then jsonb_array_length(coalesce(signal_updates, '[]'::jsonb))
    else 0
  end;
$$;

create or replace function public.save_reconciled_trading_signal(
  next_signal jsonb,
  base_status text,
  base_update_count integer
)
returns public.trading_signals
language plpgsql
security definer
set search_path = public
as $$
declare
  target_signal_id uuid := nullif(next_signal->>'id', '')::uuid;
  current_signal public.trading_signals;
  saved_signal public.trading_signals;
  next_take_profits jsonb := coalesce(next_signal->'take_profits', '[]'::jsonb);
  current_update_count integer;
  additional_prices jsonb := '[]'::jsonb;
begin
  if target_signal_id is null then
    raise exception 'Trading signal id is required.';
  end if;

  if not public.validate_trading_signal_take_profits(next_take_profits) then
    raise exception 'Trading signal take profits are invalid.';
  end if;

  select *
  into current_signal
  from public.trading_signals
  where id = target_signal_id
  for update;

  if current_signal.id is null then
    return null;
  end if;

  current_update_count := public.trading_signal_update_count(current_signal.updates);
  if current_signal.status <> 'active'
    or current_signal.status is distinct from base_status
    or current_update_count <> coalesce(base_update_count, 0) then
    return current_signal;
  end if;

  select coalesce(jsonb_agg(item.value->'price' order by item.ordinality), '[]'::jsonb)
  into additional_prices
  from jsonb_array_elements(next_take_profits) with ordinality as item(value, ordinality)
  where item.ordinality > 3;

  update public.trading_signals
  set
    take_profits = next_take_profits,
    take_profit_1 = nullif(next_take_profits->0->>'price', '')::numeric,
    take_profit_2 = nullif(next_take_profits->1->>'price', '')::numeric,
    take_profit_3 = nullif(next_take_profits->2->>'price', '')::numeric,
    additional_take_profits = coalesce(additional_prices, '[]'::jsonb),
    status = coalesce(nullif(next_signal->>'status', ''), current_signal.status),
    closed_at = nullif(next_signal->>'closed_at', '')::timestamptz,
    final_price = nullif(next_signal->>'final_price', '')::numeric,
    final_roi = nullif(next_signal->>'final_roi', '')::numeric,
    updates = coalesce(next_signal->'updates', current_signal.updates),
    last_checked_at = nullif(next_signal->>'last_checked_at', '')::timestamptz,
    last_auto_update_price = nullif(next_signal->>'last_auto_update_price', '')::numeric,
    last_auto_update_source = nullif(next_signal->>'last_auto_update_source', '')
  where id = target_signal_id
  returning * into saved_signal;

  return saved_signal;
end;
$$;

create or replace function public.notify_trading_signal_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate_admin_id uuid := coalesce(new.created_by_admin_id, auth.uid());
  sender_admin_id uuid;
  latest_update jsonb;
  latest_update_message text;
  signal_label text;
  notification_title text;
  notification_summary text;
  notification_message text;
  entry_text text := public.format_trading_signal_price(new.entry_price);
  stop_text text := public.format_trading_signal_price(new.stop_loss);
  old_update_count integer := 0;
  new_update_count integer := public.trading_signal_update_count(new.updates);
  update_index integer;
begin
  if tg_op = 'UPDATE'
    and old.title is not distinct from new.title
    and old.generated_title is not distinct from new.generated_title
    and old.symbol is not distinct from new.symbol
    and old.direction is not distinct from new.direction
    and old.leverage is not distinct from new.leverage
    and old.entry_price is not distinct from new.entry_price
    and old.stop_loss is not distinct from new.stop_loss
    and old.take_profits is not distinct from new.take_profits
    and old.take_profit_1 is not distinct from new.take_profit_1
    and old.take_profit_2 is not distinct from new.take_profit_2
    and old.take_profit_3 is not distinct from new.take_profit_3
    and old.additional_take_profits is not distinct from new.additional_take_profits
    and old.chart_image_url is not distinct from new.chart_image_url
    and old.notes is not distinct from new.notes
    and old.status is not distinct from new.status
    and old.is_active is not distinct from new.is_active
    and old.updates is not distinct from new.updates
    and old.closed_at is not distinct from new.closed_at
    and old.manual_close_price is not distinct from new.manual_close_price
    and old.final_price is not distinct from new.final_price
    and old.final_roi is not distinct from new.final_roi
  then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    old_update_count := public.trading_signal_update_count(old.updates);
  end if;

  if candidate_admin_id is not null then
    select p.id
    into sender_admin_id
    from public.profiles as p
    where p.id = candidate_admin_id
    limit 1;
  end if;

  signal_label := trim(concat_ws(
    ' ',
    nullif(new.symbol, ''),
    coalesce(new.generated_title, new.title, public.generate_trading_signal_title(new.direction, new.leverage))
  ));

  if tg_op = 'INSERT' then
    if jsonb_typeof(new.updates) = 'array' and jsonb_array_length(new.updates) > 0 then
      latest_update := new.updates -> (jsonb_array_length(new.updates) - 1);
      latest_update_message := nullif(trim(coalesce(latest_update->>'message', '')), '');
    end if;

    notification_title := 'New Trading Signal: ' || signal_label;
    notification_summary := coalesce(latest_update_message, 'A new Trading Academy signal is available.');
    notification_message := concat_ws(E'\n',
      'New trading signal posted.',
      'Pair: ' || coalesce(new.symbol, 'N/A'),
      'Direction: ' || upper(coalesce(new.direction, 'N/A')),
      'Leverage: ' || coalesce(new.leverage::text, '1') || 'X',
      'Entry: ' || entry_text,
      'Stop Loss: ' || stop_text,
      case when new.notes is not null and trim(new.notes) <> '' then 'Notes: ' || new.notes else null end
    );

    insert into public.notifications (
      target_audience,
      type,
      title,
      summary,
      message,
      related_signal_id,
      sent_by_admin_id
    )
    values ('premium', 'trading_signal', notification_title, notification_summary, notification_message, new.id, sender_admin_id);

    return new;
  end if;

  if new_update_count > old_update_count then
    for update_index in old_update_count..new_update_count - 1
    loop
      latest_update := new.updates -> update_index;
      latest_update_message := nullif(trim(coalesce(latest_update->>'message', '')), '');
      notification_summary := coalesce(latest_update_message, 'Signal updated.');
      notification_title := case
        when coalesce(latest_update->>'type', '') in ('tp_hit', 'sl_hit', 'manual_close')
          then 'Trading Signal Status Update: ' || signal_label
        else 'Trading Signal Update: ' || signal_label
      end;
      notification_message := concat_ws(E'\n',
        'Trading signal updated.',
        'Pair: ' || coalesce(new.symbol, 'N/A'),
        'Status: ' || upper(replace(coalesce(new.status, 'active'), '_', ' ')),
        'Direction: ' || upper(coalesce(new.direction, 'N/A')),
        'Leverage: ' || coalesce(new.leverage::text, '1') || 'X',
        'Entry: ' || entry_text,
        'Stop Loss: ' || stop_text,
        'Update: ' || notification_summary
      );

      insert into public.notifications (
        target_audience,
        type,
        title,
        summary,
        message,
        related_signal_id,
        sent_by_admin_id
      )
      values ('premium', 'trading_signal', notification_title, notification_summary, notification_message, new.id, sender_admin_id);
    end loop;

    return new;
  end if;

  notification_title := case
    when old.status is distinct from new.status then 'Trading Signal Status Update: ' || signal_label
    else 'Trading Signal Update: ' || signal_label
  end;
  notification_summary := case
    when old.status is distinct from new.status then 'Status changed to ' || upper(replace(new.status, '_', ' ')) || '.'
    when old.take_profits is distinct from new.take_profits then 'Take profit levels updated.'
    else 'Signal details updated.'
  end;
  notification_message := concat_ws(E'\n',
    'Trading signal updated.',
    'Pair: ' || coalesce(new.symbol, 'N/A'),
    'Status: ' || upper(replace(coalesce(new.status, 'active'), '_', ' ')),
    'Direction: ' || upper(coalesce(new.direction, 'N/A')),
    'Leverage: ' || coalesce(new.leverage::text, '1') || 'X',
    'Entry: ' || entry_text,
    'Stop Loss: ' || stop_text,
    'Update: ' || notification_summary
  );

  insert into public.notifications (
    target_audience,
    type,
    title,
    summary,
    message,
    related_signal_id,
    sent_by_admin_id
  )
  values ('premium', 'trading_signal', notification_title, notification_summary, notification_message, new.id, sender_admin_id);

  return new;
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
  reconcile_url text := nullif(current_setting('app.settings.trading_signal_reconcile_url', true), '');
  reconcile_token text := nullif(current_setting('app.settings.trading_signal_reconcile_token', true), '');
begin
  if reconcile_url is not null and reconcile_token is not null and to_regproc('cron.schedule') is not null then
    begin
      execute format('select cron.unschedule(%L)', 'trading-signal-reconcile-every-minute');
    exception
      when others then
        null;
    end;

    execute format(
      'select cron.schedule(%L, %L, %L)',
      'trading-signal-reconcile-every-minute',
      '* * * * *',
      format(
        $job$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || %L,
            'Content-Type', 'application/json'
          ),
          body := '{"scope":"all"}'::jsonb,
          timeout_milliseconds := 5000
        );
        $job$,
        reconcile_url,
        reconcile_token
      )
    );
  end if;
exception
  when others then
    raise notice 'Trading signal reconciliation cron was not scheduled automatically: %', sqlerrm;
end;
$$;

revoke execute on function public.save_reconciled_trading_signal(jsonb, text, integer) from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, update on table public.trading_signals to service_role;
grant execute on function public.save_reconciled_trading_signal(jsonb, text, integer) to service_role;
grant execute on function public.trading_signal_update_count(jsonb) to service_role;

notify pgrst, 'reload schema';
