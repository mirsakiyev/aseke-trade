create or replace function public.admin_update_trading_academy_subscription(
  target_subscription_id uuid,
  target_starts_at timestamptz,
  target_expires_at timestamptz,
  admin_note text default null
)
returns table (
  subscription_id uuid,
  starts_at timestamptz,
  expires_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can update Trading Academy subscriptions';
  end if;

  if target_subscription_id is null then
    raise exception 'Subscription is required';
  end if;

  if target_starts_at is null or target_expires_at is null then
    raise exception 'Start and end dates are required';
  end if;

  if target_expires_at <= target_starts_at then
    raise exception 'End date must be after start date';
  end if;

  update public.premium_subscriptions as ps
  set starts_at = target_starts_at,
      expires_at = target_expires_at,
      plan_duration_months = greatest(
        1,
        ceil(extract(epoch from (target_expires_at - target_starts_at)) / 2592000.0)::integer
      ),
      status = case
        when target_expires_at <= now() then 'expired'
        when target_starts_at > now() then 'pending'
        else 'active'
      end,
      -- $4 is the admin_note function argument. Using its positional name avoids
      -- ambiguity with premium_subscriptions.admin_note inside this UPDATE.
      admin_note = nullif(trim(coalesce($4, ps.admin_note, '')), ''),
      updated_at = now()
  where ps.id = target_subscription_id
  returning ps.user_id, ps.id, ps.starts_at, ps.expires_at, ps.status
  into target_user_id, subscription_id, starts_at, expires_at, status;

  if target_user_id is null then
    raise exception 'Subscription not found';
  end if;

  perform public.sync_user_trading_academy_profile(target_user_id);

  return next;
end;
$$;

grant execute on function public.admin_update_trading_academy_subscription(uuid, timestamptz, timestamptz, text)
to authenticated;

notify pgrst, 'reload schema';
