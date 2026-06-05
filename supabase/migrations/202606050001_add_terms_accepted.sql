alter table public.profiles
add column if not exists terms_accepted boolean not null default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'terms_accepted', 'false') <> 'true' then
    raise exception 'Terms of Agreement must be accepted.';
  end if;

  insert into public.profiles (id, full_name, terms_accepted)
  values (new.id, new.raw_user_meta_data ->> 'full_name', true)
  on conflict (id) do update set
    full_name = excluded.full_name,
    terms_accepted = true;

  return new;
end;
$$;
