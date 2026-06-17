alter table public.crypto_payments
add column if not exists amount_nonce_units integer not null default 0
check (amount_nonce_units >= 0);

alter table public.crypto_payments
add column if not exists verification_event_index integer;

alter table public.crypto_payments
add column if not exists verification_token_contract text;

alter table public.crypto_payments
add column if not exists verification_recipient_address text;

alter table public.crypto_payments
add column if not exists verification_confirmations integer;

alter table public.crypto_payments
add column if not exists verification_checked_at timestamptz;

alter table public.crypto_payments
add column if not exists rejected_reason text;

alter table public.crypto_payments
drop constraint if exists crypto_payments_status_check;

alter table public.crypto_payments
add constraint crypto_payments_status_check
check (
  status in (
    'pending',
    'submitted',
    'detected',
    'confirming',
    'verifying',
    'confirmed',
    'credited',
    'underpaid',
    'overpaid',
    'expired',
    'failed',
    'rejected',
    'duplicate'
  )
);

drop index if exists public.crypto_payments_tx_hash_unique_idx;

create index if not exists crypto_payments_tx_hash_idx
on public.crypto_payments(network, tx_hash)
where tx_hash is not null;

create unique index if not exists crypto_payments_active_expected_amount_unique_idx
on public.crypto_payments(payment_method_id, receive_address, asset, network, expected_amount)
where status in ('pending', 'submitted', 'detected', 'confirming', 'verifying');

create table if not exists public.crypto_processed_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.crypto_payments(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  asset text not null check (asset in ('USDT', 'USDC')),
  network text not null check (network in ('TRC20', 'ERC20')),
  tx_hash text not null,
  event_index integer not null default 0 check (event_index >= 0),
  token_contract text not null,
  receive_address text not null,
  amount numeric not null check (amount > 0),
  confirmations integer not null default 0 check (confirmations >= 0),
  credited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (network, tx_hash, event_index)
);

create index if not exists crypto_processed_transactions_user_id_idx
on public.crypto_processed_transactions(user_id);

create index if not exists crypto_processed_transactions_payment_id_idx
on public.crypto_processed_transactions(payment_id);

create table if not exists public.crypto_payment_claim_attempts (
  id uuid primary key default gen_random_uuid(),
  attempted_user_id uuid references auth.users(id) on delete set null,
  payment_id uuid references public.crypto_payments(id) on delete set null,
  payment_user_id uuid references auth.users(id) on delete set null,
  asset text,
  network text,
  tx_hash text,
  status text not null,
  reason text,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists crypto_payment_claim_attempts_user_created_idx
on public.crypto_payment_claim_attempts(attempted_user_id, created_at desc);

create index if not exists crypto_payment_claim_attempts_tx_hash_idx
on public.crypto_payment_claim_attempts(network, tx_hash);

create or replace function public.credit_crypto_deposit(target_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  payment record;
  credit_cents integer;
begin
  select *
  into payment
  from public.crypto_payments
  where id = target_payment_id
  for update;

  if not found then
    raise exception 'Payment not found';
  end if;

  if payment.payment_type <> 'deposit' or payment.status not in ('confirmed', 'credited') then
    return;
  end if;

  if exists (
    select 1
    from public.account_balance_transactions
    where crypto_payment_id = target_payment_id
      and transaction_type = 'deposit'
  ) then
    update public.crypto_payments
    set status = 'credited',
        updated_at = now()
    where id = target_payment_id;
    return;
  end if;

  credit_cents := round(coalesce(payment.received_amount, payment.expected_amount) * 100)::integer;

  if credit_cents <= 0 then
    raise exception 'Deposit amount must be greater than zero';
  end if;

  insert into public.account_balances (user_id, balance_cents)
  values (payment.user_id, credit_cents)
  on conflict (user_id) do update set
    balance_cents = public.account_balances.balance_cents + excluded.balance_cents,
    updated_at = now();

  insert into public.account_balance_transactions (
    user_id,
    crypto_payment_id,
    transaction_type,
    amount_cents,
    description
  )
  values (
    payment.user_id,
    payment.id,
    'deposit',
    credit_cents,
    payment.asset || ' ' || payment.network || ' verified deposit'
  );

  update public.crypto_payments
  set status = 'credited',
      updated_at = now()
  where id = target_payment_id;
end;
$$;

alter table public.crypto_processed_transactions enable row level security;
alter table public.crypto_payment_claim_attempts enable row level security;

drop policy if exists "crypto_processed_transactions_admin_select" on public.crypto_processed_transactions;
create policy "crypto_processed_transactions_admin_select"
on public.crypto_processed_transactions for select
using (public.is_admin());

drop policy if exists "crypto_payment_claim_attempts_admin_select" on public.crypto_payment_claim_attempts;
create policy "crypto_payment_claim_attempts_admin_select"
on public.crypto_payment_claim_attempts for select
using (public.is_admin());

grant select, insert, update on public.crypto_processed_transactions to service_role;
grant select, insert on public.crypto_payment_claim_attempts to service_role;
grant execute on function public.credit_crypto_deposit(uuid) to service_role;

revoke all on public.crypto_processed_transactions from anon, authenticated;
revoke all on public.crypto_payment_claim_attempts from anon, authenticated;
revoke execute on function public.credit_crypto_deposit(uuid) from anon, authenticated;

notify pgrst, 'reload schema';
