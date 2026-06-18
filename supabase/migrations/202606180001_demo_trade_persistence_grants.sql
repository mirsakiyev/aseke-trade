revoke all on table public.demo_trade_states from anon;
grant select, insert, update on table public.demo_trade_states to authenticated;

revoke execute on function public.save_demo_trade_state(jsonb) from anon;
grant execute on function public.save_demo_trade_state(jsonb) to authenticated;

notify pgrst, 'reload schema';
