alter table public.demo_trade_execution_events
drop constraint if exists demo_trade_execution_events_event_type_check;

alter table public.demo_trade_execution_events
add constraint demo_trade_execution_events_event_type_check
check (event_type in ('limit_fill', 'stop_loss', 'take_profit', 'liquidation', 'manual'));

notify pgrst, 'reload schema';
