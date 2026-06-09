update public.premium_plans
set product_label = 'Trading Academy',
    duration_months = 1,
    price_cents = 1000,
    updated_at = now()
where id = 'premium_1_month';

update public.premium_plans
set product_label = 'Trading Academy',
    duration_months = 12,
    price_cents = 5000,
    updated_at = now()
where id = 'premium_1_year';

update public.crypto_payments
set product_label = 'Trading Academy',
    updated_at = now()
where product_type = 'premium'
  and coalesce(product_label, '') <> 'Trading Academy';

update public.premium_subscriptions
set product_label = 'Trading Academy',
    updated_at = now()
where product_type = 'premium'
  and coalesce(product_label, '') <> 'Trading Academy';

update public.account_balance_transactions
set product_label = 'Trading Academy',
    description = replace(coalesce(description, ''), 'Premium', 'Trading Academy')
where product_type = 'premium'
  and (
    coalesce(product_label, '') <> 'Trading Academy'
    or coalesce(description, '') like '%Premium%'
  );

notify pgrst, 'reload schema';
