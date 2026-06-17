drop function if exists public.submit_trade_route_optimizer_completion(date, text, jsonb, jsonb, jsonb, integer, numeric, jsonb);
drop function if exists public.get_puzzle(timestamptz);
drop function if exists public.submit_puzzle(uuid, text);
drop function if exists public.ensure_puzzle(timestamptz);
drop function if exists public.get_daily_puzzle(date);
drop function if exists public.submit_daily_puzzle(uuid, text);
drop function if exists public.ensure_daily_puzzle(date);
drop function if exists public.puzzle_window_start(timestamptz);
drop function if exists public.puzzle_window_id(timestamptz);

drop table if exists public.route_optimizer_completions cascade;
drop table if exists public.daily_puzzle_solves cascade;
drop table if exists public.daily_puzzles cascade;

delete from public.xp_transactions
where source_type in ('puzzle_of_day', 'trade_route_optimizer');

update public.profiles as p
set total_xp = coalesce((
  select sum(xt.amount)::integer
  from public.xp_transactions as xt
  where xt.user_id = p.id
), 0);

alter table public.xp_transactions
drop constraint if exists xp_transactions_source_type_check;

alter table public.xp_transactions
add constraint xp_transactions_source_type_check
check (source_type in ('guide', 'admin_adjustment', 'course_badge', 'loyalty_badge'));

notify pgrst, 'reload schema';
