create or replace function public.format_trading_signal_price(input_price numeric)
returns text
language sql
immutable
as $$
  select case
    when input_price is null then 'N/A'
    when abs(input_price) >= 1000 then
      trim(trailing '.' from trim(trailing '0' from to_char(round(input_price, 2), 'FM999,999,999,999,999,990.99')))
    when abs(input_price) >= 1 then
      trim(trailing '.' from trim(trailing '0' from to_char(round(input_price, 6), 'FM999,999,999,999,999,990.999999')))
    else
      trim(trailing '.' from trim(trailing '0' from to_char(round(input_price, 10), 'FM999,999,999,999,999,990.9999999999')))
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

  if candidate_admin_id is not null then
    select p.id
    into sender_admin_id
    from public.profiles as p
    where p.id = candidate_admin_id
    limit 1;
  end if;

  if jsonb_typeof(new.updates) = 'array' and jsonb_array_length(new.updates) > 0 then
    latest_update := new.updates -> (jsonb_array_length(new.updates) - 1);
    latest_update_message := nullif(trim(coalesce(latest_update->>'message', '')), '');
  end if;

  signal_label := trim(concat_ws(
    ' ',
    nullif(new.symbol, ''),
    coalesce(new.generated_title, new.title, public.generate_trading_signal_title(new.direction, new.leverage))
  ));

  if tg_op = 'INSERT' then
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
  else
    notification_title := case
      when old.status is distinct from new.status then 'Trading Signal Status Update: ' || signal_label
      else 'Trading Signal Update: ' || signal_label
    end;

    notification_summary := coalesce(
      latest_update_message,
      case
        when old.status is distinct from new.status then 'Status changed to ' || upper(replace(new.status, '_', ' ')) || '.'
        when old.take_profits is distinct from new.take_profits then 'Take profit levels updated.'
        else 'Signal details updated.'
      end
    );

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
  end if;

  insert into public.notifications (
    target_audience,
    type,
    title,
    summary,
    message,
    related_signal_id,
    sent_by_admin_id
  )
  values (
    'premium',
    'trading_signal',
    notification_title,
    notification_summary,
    notification_message,
    new.id,
    sender_admin_id
  );

  return new;
end;
$$;

update public.notifications as n
set message = regexp_replace(
  regexp_replace(
    n.message,
    '(^|\n)Entry: [^\n]*',
    E'\\1Entry: ' || public.format_trading_signal_price(s.entry_price),
    'g'
  ),
  '(^|\n)Stop Loss: [^\n]*',
  E'\\1Stop Loss: ' || public.format_trading_signal_price(s.stop_loss),
  'g'
)
from public.trading_signals as s
where n.related_signal_id = s.id
  and n.type = 'trading_signal';
