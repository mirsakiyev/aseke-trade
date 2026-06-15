create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text not null,
  subject text not null,
  category text not null check (category in ('Account', 'Billing', 'Trading Academy', 'Technical Issue', 'General Question', 'Other')),
  message text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(name)) between 1 and 120),
  check (length(trim(email)) between 3 and 180),
  check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  check (length(trim(subject)) between 1 and 180),
  check (length(trim(message)) between 1 and 2500)
);

drop trigger if exists set_support_requests_updated_at on public.support_requests;
create trigger set_support_requests_updated_at
before update on public.support_requests
for each row execute function public.set_updated_at();

create index if not exists support_requests_status_idx
on public.support_requests(status, created_at desc);

create index if not exists support_requests_created_at_idx
on public.support_requests(created_at desc);

create index if not exists support_requests_user_id_idx
on public.support_requests(user_id, created_at desc)
where user_id is not null;

create or replace function public.submit_support_request(
  request_name text,
  request_email text,
  request_subject text,
  request_category text,
  request_message text
)
returns public.support_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_name text := left(btrim(regexp_replace(coalesce(request_name, ''), '[[:cntrl:]]', '', 'g')), 120);
  safe_email text := lower(left(btrim(regexp_replace(coalesce(request_email, ''), '[[:cntrl:]]', '', 'g')), 180));
  safe_subject text := left(btrim(regexp_replace(coalesce(request_subject, ''), '[[:cntrl:]]', '', 'g')), 180);
  safe_category text := left(btrim(regexp_replace(coalesce(request_category, ''), '[[:cntrl:]]', '', 'g')), 60);
  safe_message text := left(btrim(regexp_replace(coalesce(request_message, ''), '[[:cntrl:]]', ' ', 'g')), 2500);
  created_request public.support_requests;
begin
  if safe_name = '' then
    raise exception 'Name is required';
  end if;

  if safe_email = '' or safe_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address';
  end if;

  if safe_subject = '' then
    raise exception 'Subject is required';
  end if;

  if safe_category not in ('Account', 'Billing', 'Trading Academy', 'Technical Issue', 'General Question', 'Other') then
    raise exception 'Choose a support category';
  end if;

  if safe_message = '' then
    raise exception 'Message is required';
  end if;

  insert into public.support_requests (
    user_id,
    name,
    email,
    subject,
    category,
    message
  )
  values (
    auth.uid(),
    safe_name,
    safe_email,
    safe_subject,
    safe_category,
    safe_message
  )
  returning * into created_request;

  return created_request;
end;
$$;

alter table public.support_requests enable row level security;

drop policy if exists "support_requests_select_admin" on public.support_requests;
create policy "support_requests_select_admin"
on public.support_requests for select
using (public.is_admin());

drop policy if exists "support_requests_update_admin" on public.support_requests;
create policy "support_requests_update_admin"
on public.support_requests for update
using (public.is_admin())
with check (public.is_admin());

grant select, update on public.support_requests to authenticated;
grant select, insert, update, delete on public.support_requests to service_role;
grant execute on function public.submit_support_request(text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
