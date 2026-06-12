create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  target_audience text not null default 'all' check (target_audience in ('all', 'basic', 'premium', 'specific_user')),
  type text not null check (type in ('market_outlook', 'trading_signal', 'account_update', 'security_update', 'community_message')),
  title text not null check (length(trim(title)) between 1 and 180),
  summary text,
  message text not null check (length(trim(message)) > 0),
  related_signal_id uuid references public.trading_signals(id) on delete set null,
  sent_by_admin_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_specific_user_target_check check ((target_audience = 'specific_user') = (user_id is not null)),
  constraint notifications_premium_types_target_check check (
    type not in ('market_outlook', 'trading_signal') or target_audience = 'premium'
  ),
  constraint notifications_community_all_check check (type <> 'community_message' or target_audience = 'all')
);

create index if not exists notifications_created_at_idx
  on public.notifications(created_at desc);

create index if not exists notifications_target_idx
  on public.notifications(target_audience, type, created_at desc);

create index if not exists notifications_user_id_idx
  on public.notifications(user_id, created_at desc)
  where user_id is not null;

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists notification_reads_user_id_idx
  on public.notification_reads(user_id, read_at desc);

drop trigger if exists set_notifications_updated_at on public.notifications;
create trigger set_notifications_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

drop policy if exists "notifications_select_admin" on public.notifications;
create policy "notifications_select_admin"
on public.notifications
for select
using (public.is_admin());

drop policy if exists "notifications_insert_admin" on public.notifications;
create policy "notifications_insert_admin"
on public.notifications
for insert
with check (public.is_admin());

drop policy if exists "notifications_update_admin" on public.notifications;
create policy "notifications_update_admin"
on public.notifications
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "notifications_delete_admin" on public.notifications;
create policy "notifications_delete_admin"
on public.notifications
for delete
using (public.is_admin());

drop policy if exists "notification_reads_select_owner_or_admin" on public.notification_reads;
create policy "notification_reads_select_owner_or_admin"
on public.notification_reads
for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "notification_reads_insert_owner" on public.notification_reads;
create policy "notification_reads_insert_owner"
on public.notification_reads
for insert
with check (user_id = auth.uid());

drop policy if exists "notification_reads_delete_owner_or_admin" on public.notification_reads;
create policy "notification_reads_delete_owner_or_admin"
on public.notification_reads
for delete
using (user_id = auth.uid() or public.is_admin());

create or replace function public.get_user_notifications()
returns table (
  id uuid,
  user_id uuid,
  target_audience text,
  type text,
  title text,
  summary text,
  message text,
  related_signal_id uuid,
  is_read boolean,
  created_at timestamptz,
  updated_at timestamptz,
  sent_by_admin_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_id uuid := auth.uid();
  requester_is_premium boolean := public.has_premium_access();
begin
  if requester_id is null then
    raise exception 'Login is required to view notifications.';
  end if;

  return query
    select
      n.id,
      n.user_id,
      n.target_audience,
      n.type,
      n.title,
      n.summary,
      n.message,
      n.related_signal_id,
      exists (
        select 1
        from public.notification_reads as nr
        where nr.notification_id = n.id
          and nr.user_id = requester_id
      ) as is_read,
      n.created_at,
      n.updated_at,
      n.sent_by_admin_id
    from public.notifications as n
    where (
        n.target_audience = 'all'
        or (n.target_audience = 'premium' and requester_is_premium)
        or (n.target_audience = 'basic' and not requester_is_premium)
        or (n.target_audience = 'specific_user' and n.user_id = requester_id)
      )
      and (
        requester_is_premium
        or n.type not in ('market_outlook', 'trading_signal')
      )
    order by n.created_at desc;
end;
$$;

create or replace function public.mark_notification_read(target_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_id uuid := auth.uid();
  requester_is_premium boolean := public.has_premium_access();
begin
  if requester_id is null then
    raise exception 'Login is required to update notifications.';
  end if;

  if not exists (
    select 1
    from public.notifications as n
    where n.id = target_notification_id
      and (
        n.target_audience = 'all'
        or (n.target_audience = 'premium' and requester_is_premium)
        or (n.target_audience = 'basic' and not requester_is_premium)
        or (n.target_audience = 'specific_user' and n.user_id = requester_id)
      )
      and (
        requester_is_premium
        or n.type not in ('market_outlook', 'trading_signal')
      )
  ) then
    raise exception 'Notification is not available to this user.';
  end if;

  insert into public.notification_reads (notification_id, user_id)
  values (target_notification_id, requester_id)
  on conflict (notification_id, user_id) do update set read_at = now();
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
  entry_text text := to_char(new.entry_price, 'FM999999999999999999990.##########');
  stop_text text := to_char(new.stop_loss, 'FM999999999999999999990.##########');
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

drop trigger if exists notify_trading_signal_change on public.trading_signals;
create trigger notify_trading_signal_change
after insert or update on public.trading_signals
for each row execute function public.notify_trading_signal_change();

grant select, insert, update, delete on public.notifications to authenticated;
revoke all on public.notification_reads from authenticated;
grant select on public.notification_reads to authenticated;
grant execute on function public.get_user_notifications() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;

notify pgrst, 'reload schema';
