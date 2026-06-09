grant usage on schema public to service_role;

grant select on public.courses, public.guides to service_role;
grant select on public.premium_plans to service_role;

grant select, insert, update, delete on public.crypto_payment_methods to service_role;
grant select, insert, update on public.crypto_payments to service_role;
grant select, insert on public.premium_access to service_role;
grant select, insert, update on public.premium_subscriptions to service_role;
grant select, insert, update on public.account_balances to service_role;
grant select, insert, update on public.account_balance_transactions to service_role;
grant select, insert on public.purchases to service_role;
grant select, insert, update on public.profiles to service_role;

grant execute on function public.credit_crypto_deposit(uuid) to service_role;
grant execute on function public.activate_premium_subscription_from_payment(uuid) to service_role;
grant execute on function public.spend_account_balance_for_user(uuid, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
