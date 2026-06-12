alter table public.daily_puzzles
drop constraint if exists daily_puzzles_puzzle_date_key;

alter table public.daily_puzzles
add column if not exists puzzle_window_id text,
add column if not exists window_start_at timestamptz,
add column if not exists window_end_at timestamptz;

update public.daily_puzzles
set
  window_start_at = coalesce(window_start_at, puzzle_date::timestamptz),
  window_end_at = coalesce(window_end_at, puzzle_date::timestamptz + interval '4 hours'),
  puzzle_window_id = coalesce(puzzle_window_id, to_char(puzzle_date::timestamptz at time zone 'UTC', 'YYYY-MM-DD-HH24'))
where puzzle_window_id is null
   or window_start_at is null
   or window_end_at is null;

alter table public.daily_puzzles
alter column puzzle_window_id set not null,
alter column window_start_at set not null,
alter column window_end_at set not null;

create unique index if not exists daily_puzzles_window_id_unique_idx
on public.daily_puzzles(puzzle_window_id);

create index if not exists daily_puzzles_window_start_idx
on public.daily_puzzles(window_start_at desc);

create or replace function public.puzzle_window_start(target_time timestamptz default now())
returns timestamptz
language sql
stable
as $$
  select (
    date_trunc('day', target_time at time zone 'UTC')
    + (floor(extract(hour from target_time at time zone 'UTC') / 4)::integer * interval '4 hours')
  ) at time zone 'UTC';
$$;

create or replace function public.puzzle_window_id(target_time timestamptz default now())
returns text
language sql
stable
as $$
  select to_char(public.puzzle_window_start(target_time) at time zone 'UTC', 'YYYY-MM-DD-HH24');
$$;

create or replace function public.ensure_puzzle(target_time timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  puzzle_id uuid;
  puzzle_index integer;
  safe_window_start timestamptz := public.puzzle_window_start(target_time);
  safe_window_end timestamptz := safe_window_start + interval '4 hours';
  safe_window_id text := public.puzzle_window_id(target_time);
  titles text[] := array[
    'Seed Phrase Scramble',
    'Block Time Riddle',
    'Wallet Safety Check',
    'Gas Fee Logic',
    'Bitcoin Halving Clue',
    'Ethereum Builder Trivia',
    'Cold Storage Riddle'
  ];
  prompts text[] := array[
    'Unscramble this wallet safety phrase: DSEE RHPAES. What two words does it make?',
    'I group transactions, point to the block before me, and become part of a chain. What am I?',
    'You should never type this recovery backup into a random website. What is it called?',
    'On Ethereum, users pay this cost to execute transactions and smart contracts. What is it called?',
    'This Bitcoin event cuts new issuance roughly every four years. What is it called?',
    'This kind of contract runs on-chain and follows code instead of a human middleman. What is it called?',
    'A wallet setup that keeps private keys offline is usually called what?'
  ];
  answers text[] := array[
    'seed phrase',
    'block',
    'seed phrase',
    'gas fee',
    'halving',
    'smart contract',
    'cold wallet'
  ];
  categories text[] := array[
    'word puzzle',
    'blockchain riddle',
    'wallet safety',
    'ethereum trivia',
    'bitcoin trivia',
    'smart contracts',
    'wallet safety'
  ];
begin
  select dp.id
  into puzzle_id
  from public.daily_puzzles as dp
  where dp.puzzle_window_id = safe_window_id;

  if puzzle_id is not null then
    return puzzle_id;
  end if;

  puzzle_index := (abs(('x' || substr(md5(safe_window_id), 1, 8))::bit(32)::integer) % array_length(titles, 1)) + 1;

  insert into public.daily_puzzles (
    puzzle_date,
    puzzle_window_id,
    window_start_at,
    window_end_at,
    title,
    prompt,
    answer,
    category
  )
  values (
    safe_window_start::date,
    safe_window_id,
    safe_window_start,
    safe_window_end,
    titles[puzzle_index],
    prompts[puzzle_index],
    answers[puzzle_index],
    categories[puzzle_index]
  )
  on conflict (puzzle_window_id) do nothing
  returning id into puzzle_id;

  if puzzle_id is null then
    select dp.id
    into puzzle_id
    from public.daily_puzzles as dp
    where dp.puzzle_window_id = safe_window_id;
  end if;

  return puzzle_id;
end;
$$;

create or replace function public.get_puzzle(target_time timestamptz default now())
returns table (
  id uuid,
  puzzle_date date,
  puzzle_window_id text,
  window_start_at timestamptz,
  next_refresh_at timestamptz,
  title text,
  prompt text,
  category text,
  reward_claimed boolean,
  user_completed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  puzzle_id uuid;
begin
  puzzle_id := public.ensure_puzzle(target_time);

  return query
  select
    dp.id,
    dp.puzzle_date,
    dp.puzzle_window_id,
    dp.window_start_at,
    dp.window_end_at,
    dp.title,
    dp.prompt,
    dp.category,
    dp.first_solver_user_id is not null,
    exists (
      select 1
      from public.daily_puzzle_solves as dps
      where dps.puzzle_id = dp.id
        and dps.user_id = auth.uid()
        and dps.is_correct = true
    )
  from public.daily_puzzles as dp
  where dp.id = puzzle_id;
end;
$$;

create or replace function public.submit_puzzle(
  target_puzzle_id uuid,
  submitted_answer text
)
returns table (
  is_correct boolean,
  is_first_solver boolean,
  xp_awarded integer,
  reward_already_claimed boolean,
  total_xp integer,
  level integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  puzzle record;
  inserted_amount integer := 0;
  next_profile record;
  already_solved boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Login is required to solve the puzzle';
  end if;

  if target_puzzle_id is null then
    raise exception 'Puzzle is required';
  end if;

  select dp.*
  into puzzle
  from public.daily_puzzles as dp
  where dp.id = target_puzzle_id
  for update;

  if not found then
    raise exception 'Puzzle not found';
  end if;

  select exists (
    select 1
    from public.daily_puzzle_solves as dps
    where dps.puzzle_id = target_puzzle_id
      and dps.user_id = auth.uid()
      and dps.is_correct = true
  )
  into already_solved;

  if already_solved then
    select p.total_xp, p.level
    into next_profile
    from public.profiles as p
    where p.id = auth.uid();

    is_correct := true;
    is_first_solver := false;
    xp_awarded := 0;
    reward_already_claimed := true;
    total_xp := coalesce(next_profile.total_xp, 0);
    level := coalesce(next_profile.level, 1);
    return next;
    return;
  end if;

  is_correct := public.normalize_answer(submitted_answer) = public.normalize_answer(puzzle.answer);
  is_first_solver := false;
  reward_already_claimed := puzzle.first_solver_user_id is not null;

  if is_correct and puzzle.first_solver_user_id is null then
    update public.daily_puzzles as dp
    set first_solver_user_id = auth.uid(),
        first_solved_at = now(),
        updated_at = now()
    where dp.id = puzzle.id
      and dp.first_solver_user_id is null;

    is_first_solver := found;
  end if;

  insert into public.daily_puzzle_solves (
    puzzle_id,
    user_id,
    submitted_answer,
    is_correct,
    is_first_solver
  )
  values (
    target_puzzle_id,
    auth.uid(),
    submitted_answer,
    is_correct,
    is_first_solver
  );

  if is_first_solver then
    insert into public.xp_transactions (
      user_id,
      amount,
      source_type,
      source_id,
      description
    )
    values (
      auth.uid(),
      100,
      'puzzle_of_day',
      target_puzzle_id,
      'Puzzle first solver'
    )
    on conflict (user_id, source_type, source_id) do nothing
    returning amount into inserted_amount;

    inserted_amount := coalesce(inserted_amount, 0);

    if inserted_amount > 0 then
      insert into public.profiles (id, total_xp)
      values (auth.uid(), inserted_amount)
      on conflict (id) do update set
        total_xp = public.profiles.total_xp + excluded.total_xp;
    end if;
  end if;

  select p.total_xp, p.level
  into next_profile
  from public.profiles as p
  where p.id = auth.uid();

  xp_awarded := inserted_amount;
  reward_already_claimed := reward_already_claimed or (is_correct and not is_first_solver);
  total_xp := coalesce(next_profile.total_xp, 0);
  level := coalesce(next_profile.level, 1);

  return next;
end;
$$;

create or replace function public.ensure_daily_puzzle(target_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.ensure_puzzle(target_date::timestamptz);
end;
$$;

drop function if exists public.get_daily_puzzle(date);

create or replace function public.get_daily_puzzle(target_date date default current_date)
returns table (
  id uuid,
  puzzle_date date,
  puzzle_window_id text,
  window_start_at timestamptz,
  next_refresh_at timestamptz,
  title text,
  prompt text,
  category text,
  reward_claimed boolean,
  user_completed boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query select * from public.get_puzzle(target_date::timestamptz);
end;
$$;

create or replace function public.submit_daily_puzzle(
  target_puzzle_id uuid,
  submitted_answer text
)
returns table (
  is_correct boolean,
  is_first_solver boolean,
  xp_awarded integer,
  reward_already_claimed boolean,
  total_xp integer,
  level integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query select * from public.submit_puzzle(target_puzzle_id, submitted_answer);
end;
$$;

grant execute on function public.get_puzzle(timestamptz) to anon, authenticated;
grant execute on function public.submit_puzzle(uuid, text) to authenticated;
grant execute on function public.get_daily_puzzle(date) to anon, authenticated;
grant execute on function public.submit_daily_puzzle(uuid, text) to authenticated;
grant execute on function public.puzzle_window_start(timestamptz) to service_role;
grant execute on function public.puzzle_window_id(timestamptz) to service_role;

revoke execute on function public.ensure_puzzle(timestamptz) from anon, authenticated;
revoke execute on function public.ensure_daily_puzzle(date) from anon, authenticated;

notify pgrst, 'reload schema';
