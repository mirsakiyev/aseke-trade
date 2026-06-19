grant usage on schema public to service_role;
grant select, insert, update on table public.demo_trade_states to service_role;
grant select, insert on table public.demo_trade_execution_events to service_role;
grant execute on function public.save_reconciled_demo_trade_state(jsonb, timestamptz, text, jsonb) to service_role;

notify pgrst, 'reload schema';
