-- AI Futures Analyst backend schema and security boundary.
-- The feature ships disabled and in shadow mode. No provider or service-role
-- secret is stored by this migration.

create or replace function public.ai_futures_validate_symbols(value text[])
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  symbol_item text;
begin
  if value is null or cardinality(value) = 0 or cardinality(value) > 20 then
    return false;
  end if;

  foreach symbol_item in array value
  loop
    if symbol_item is null
      or symbol_item <> upper(symbol_item)
      or symbol_item !~ '^[A-Z0-9]{5,20}$'
    then
      return false;
    end if;
  end loop;

  return cardinality(value) = cardinality(array(select distinct unnest(value)));
end;
$$;

create or replace function public.ai_futures_validate_score_weights(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  required_keys constant text[] := array[
    'multi_timeframe_trend',
    'market_structure',
    'momentum',
    'volume_volatility',
    'futures_positioning',
    'sentiment',
    'entry_reward_risk'
  ];
  key_item text;
  numeric_value numeric;
  total numeric := 0;
  key_count integer;
begin
  if value is not null and jsonb_typeof(value) = 'object' then
    select count(*) into key_count from jsonb_object_keys(value);
  end if;

  if value is null
    or jsonb_typeof(value) <> 'object'
    or key_count <> cardinality(required_keys)
  then
    return false;
  end if;

  foreach key_item in array required_keys
  loop
    if not (value ? key_item) or jsonb_typeof(value -> key_item) <> 'number' then
      return false;
    end if;

    numeric_value := (value ->> key_item)::numeric;
    if numeric_value < 0 or numeric_value > 100 then
      return false;
    end if;
    total := total + numeric_value;
  end loop;

  return total = 100;
exception
  when others then
    return false;
end;
$$;

create or replace function public.ai_futures_validate_take_profits(
  value jsonb,
  setup_direction text,
  entry_low numeric,
  entry_high numeric
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  item jsonb;
  item_price numeric;
  item_allocation numeric;
  item_r_multiple numeric;
  previous_price numeric := null;
  previous_r_multiple numeric := null;
  allocation_total numeric := 0;
begin
  if setup_direction not in ('long', 'short')
    or entry_low is null
    or entry_high is null
    or entry_low <= 0
    or entry_high < entry_low
    or value is null
    or jsonb_typeof(value) <> 'array'
    or jsonb_array_length(value) < 1
    or jsonb_array_length(value) > 10
  then
    return false;
  end if;

  for item in select element from jsonb_array_elements(value) as entries(element)
  loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item -> 'price') <> 'number'
      or jsonb_typeof(item -> 'allocation_percent') <> 'number'
      or jsonb_typeof(item -> 'r_multiple') <> 'number'
    then
      return false;
    end if;

    item_price := (item ->> 'price')::numeric;
    item_allocation := (item ->> 'allocation_percent')::numeric;
    item_r_multiple := (item ->> 'r_multiple')::numeric;

    if item_price <= 0
      or item_allocation <= 0
      or item_allocation > 100
      or item_r_multiple <= 0
      or (previous_r_multiple is not null and item_r_multiple <= previous_r_multiple)
    then
      return false;
    end if;

    if setup_direction = 'long' then
      if item_price <= entry_high or (previous_price is not null and item_price <= previous_price) then
        return false;
      end if;
    else
      if item_price >= entry_low or (previous_price is not null and item_price >= previous_price) then
        return false;
      end if;
    end if;

    allocation_total := allocation_total + item_allocation;
    previous_price := item_price;
    previous_r_multiple := item_r_multiple;
  end loop;

  return allocation_total = 100;
exception
  when others then
    return false;
end;
$$;

create or replace function public.ai_futures_validate_provider_settings(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  key_item text;
  key_count integer;
begin
  if value is null
    or jsonb_typeof(value) <> 'object'
    or value ->> 'market_data' <> 'binance_usdm'
    or value ->> 'sentiment' <> 'alternative_me'
  then
    return false;
  end if;

  select count(*) into key_count from jsonb_object_keys(value);
  if key_count <> 2
    or jsonb_typeof(value -> 'market_data') <> 'string'
    or jsonb_typeof(value -> 'sentiment') <> 'string'
  then
    return false;
  end if;

  for key_item in select key_name from jsonb_object_keys(value) as keys(key_name)
  loop
    if lower(key_item) ~ '(secret|token|password|credential|api.?key|private.?key)' then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create table if not exists public.ai_futures_configs (
  id uuid primary key default gen_random_uuid(),
  version bigint generated by default as identity unique,
  feature_enabled boolean not null default false,
  shadow_mode boolean not null default true,
  ai_calls_enabled boolean not null default false,
  allow_deterministic_only boolean not null default false,
  emergency_kill_switch boolean not null default false,
  configured_symbols text[] not null default array['BTCUSDT']::text[],
  trading_style text not null default 'intraday' check (trading_style = 'intraday'),
  timeframe_profile text not null default 'intraday_15m_1h_4h'
    check (timeframe_profile ~ '^[a-z0-9_]{3,80}$'),
  score_weights jsonb not null default '{"multi_timeframe_trend":20,"market_structure":20,"momentum":15,"volume_volatility":10,"futures_positioning":15,"sentiment":5,"entry_reward_risk":15}'::jsonb,
  minimum_setup_score numeric(6, 3) not null default 75 check (minimum_setup_score between 0 and 100),
  minimum_score_difference numeric(6, 3) not null default 15 check (minimum_score_difference between 0 and 100),
  minimum_reward_risk numeric(10, 4) not null default 1.8 check (minimum_reward_risk > 0 and minimum_reward_risk <= 20),
  maximum_custom_risk_percent numeric(8, 4) not null default 3 check (maximum_custom_risk_percent > 0 and maximum_custom_risk_percent <= 3),
  maximum_leverage integer not null default 10 check (maximum_leverage between 1 and 10),
  maximum_margin_percent numeric(8, 4) not null default 50 check (maximum_margin_percent > 0 and maximum_margin_percent <= 50),
  candle_stale_after_seconds integer not null default 1200 check (candle_stale_after_seconds between 60 and 86400),
  live_price_stale_after_seconds integer not null default 30 check (live_price_stale_after_seconds between 5 and 600),
  futures_metrics_stale_after_seconds integer not null default 900 check (futures_metrics_stale_after_seconds between 30 and 86400),
  sentiment_stale_after_seconds integer not null default 172800 check (sentiment_stale_after_seconds between 3600 and 604800),
  per_user_requests_per_minute integer not null default 3 check (per_user_requests_per_minute between 1 and 60),
  per_user_min_refresh_seconds integer not null default 20 check (per_user_min_refresh_seconds between 0 and 3600),
  generation_lease_seconds integer not null default 120 check (generation_lease_seconds between 15 and 900),
  maximum_generation_attempts integer not null default 3 check (maximum_generation_attempts between 1 and 10),
  provider_timeout_ms integer not null default 8000 check (provider_timeout_ms between 1000 and 30000),
  provider_retry_count integer not null default 1 check (provider_retry_count between 0 and 3),
  feature_version text not null default 'ai-futures-features-v1' check (length(feature_version) between 1 and 100),
  engine_version text not null default 'ai-futures-engine-v1' check (length(engine_version) between 1 and 100),
  prompt_version text not null default 'ai-futures-prompt-v1' check (length(prompt_version) between 1 and 100),
  model_name text not null default 'gpt-5.6' check (length(model_name) between 1 and 100),
  provider_settings jsonb not null default '{"market_data":"binance_usdm","sentiment":"alternative_me"}'::jsonb
    check (public.ai_futures_validate_provider_settings(provider_settings)),
  created_by uuid references auth.users(id) on delete set null,
  change_reason text check (change_reason is null or length(change_reason) <= 1000),
  created_at timestamptz not null default now(),
  check (public.ai_futures_validate_symbols(configured_symbols)),
  check (public.ai_futures_validate_score_weights(score_weights))
);

create index if not exists ai_futures_configs_created_idx
on public.ai_futures_configs(created_at desc, version desc);

create table if not exists public.ai_futures_config_audit (
  id bigint generated by default as identity primary key,
  config_id uuid not null references public.ai_futures_configs(id) on delete restrict,
  config_version bigint not null,
  action text not null check (action in ('created')),
  actor_user_id uuid references auth.users(id) on delete set null,
  config_snapshot jsonb not null check (jsonb_typeof(config_snapshot) = 'object'),
  occurred_at timestamptz not null default now()
);

create index if not exists ai_futures_config_audit_time_idx
on public.ai_futures_config_audit(occurred_at desc);

create table if not exists public.ai_risk_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  planning_balance numeric(24, 8) not null check (planning_balance > 0 and planning_balance <= 10000000),
  risk_model text not null check (risk_model in ('conservative', 'balanced', 'aggressive', 'custom')),
  risk_percent numeric(8, 4) not null check (risk_percent > 0 and risk_percent <= 3),
  max_leverage integer not null check (max_leverage between 1 and 10),
  max_margin_percent numeric(8, 4) not null check (max_margin_percent > 0 and max_margin_percent <= 50),
  trading_style text not null default 'intraday' check (trading_style = 'intraday'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (risk_model = 'conservative' and risk_percent = 0.5 and max_leverage <= 3)
    or (risk_model = 'balanced' and risk_percent = 1 and max_leverage <= 5)
    or (risk_model = 'aggressive' and risk_percent = 2 and max_leverage <= 10)
    or risk_model = 'custom'
  )
);

drop trigger if exists set_ai_risk_profiles_updated_at on public.ai_risk_profiles;
create trigger set_ai_risk_profiles_updated_at
before update on public.ai_risk_profiles
for each row execute function public.set_updated_at();

create table if not exists public.ai_market_snapshots (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol = upper(symbol) and symbol ~ '^[A-Z0-9]{5,20}$'),
  timeframe text not null check (timeframe in ('15m', '1h', '4h')),
  timeframe_profile text not null default 'intraday_15m_1h_4h',
  candle_close_at timestamptz not null,
  source text not null default 'binance_usdm' check (source = 'binance_usdm'),
  data_status text not null default 'ready' check (data_status in ('ready', 'stale', 'incomplete')),
  market_data_as_of timestamptz not null,
  normalized_market_data jsonb not null check (jsonb_typeof(normalized_market_data) = 'object'),
  calculated_features jsonb not null check (jsonb_typeof(calculated_features) = 'object'),
  futures_metrics jsonb not null check (jsonb_typeof(futures_metrics) = 'object'),
  sentiment_metrics jsonb not null check (jsonb_typeof(sentiment_metrics) = 'object'),
  exchange_filters jsonb not null check (jsonb_typeof(exchange_filters) = 'object'),
  source_timestamps jsonb not null check (jsonb_typeof(source_timestamps) = 'array'),
  feature_version text not null check (length(feature_version) between 1 and 100),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (symbol, timeframe, timeframe_profile, candle_close_at, source, feature_version)
);

create index if not exists ai_market_snapshots_latest_idx
on public.ai_market_snapshots(symbol, timeframe, candle_close_at desc);

create index if not exists ai_market_snapshots_status_idx
on public.ai_market_snapshots(data_status, market_data_as_of desc);

create table if not exists public.ai_market_setups (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.ai_market_snapshots(id) on delete restrict,
  config_id uuid not null references public.ai_futures_configs(id) on delete restrict,
  generation_status text not null default 'generating'
    check (generation_status in ('generating', 'ready', 'failed')),
  verdict text check (verdict in ('NO_TRADE', 'WAIT_FOR_ENTRY', 'LONG_SETUP', 'SHORT_SETUP', 'DATA_UNAVAILABLE', 'RISK_LIMIT_EXCEEDED')),
  direction text check (direction is null or direction in ('long', 'short')),
  entry_zone_low numeric(28, 12) check (entry_zone_low is null or entry_zone_low > 0),
  entry_zone_high numeric(28, 12) check (entry_zone_high is null or entry_zone_high > 0),
  stop_loss numeric(28, 12) check (stop_loss is null or stop_loss > 0),
  take_profits jsonb not null default '[]'::jsonb check (jsonb_typeof(take_profits) = 'array'),
  invalidation_level numeric(28, 12) check (invalidation_level is null or invalidation_level > 0),
  setup_quality_score numeric(6, 3) check (setup_quality_score is null or setup_quality_score between 0 and 100),
  score_components jsonb not null default '{}'::jsonb check (jsonb_typeof(score_components) = 'object'),
  reward_risk_ratio numeric(12, 6) check (reward_risk_ratio is null or reward_risk_ratio > 0),
  market_regime text check (market_regime is null or market_regime in ('trending', 'ranging', 'high_volatility', 'uncertain')),
  deterministic_candidate jsonb not null default '{}'::jsonb check (jsonb_typeof(deterministic_candidate) = 'object'),
  ai_structured_output jsonb check (ai_structured_output is null or jsonb_typeof(ai_structured_output) = 'object'),
  model_name text not null check (length(model_name) between 1 and 100),
  prompt_version text not null check (length(prompt_version) between 1 and 100),
  engine_version text not null check (length(engine_version) between 1 and 100),
  setup_expires_at timestamptz,
  generated_at timestamptz,
  generation_lease_token uuid,
  generation_lease_owner text check (generation_lease_owner is null or length(generation_lease_owner) <= 200),
  generation_lease_expires_at timestamptz,
  generation_attempts integer not null default 1 check (generation_attempts between 1 and 100),
  failure_code text check (failure_code is null or length(failure_code) <= 100),
  failure_detail text check (failure_detail is null or length(failure_detail) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_id, config_id, engine_version, prompt_version),
  check (entry_zone_low is null or entry_zone_high is null or entry_zone_high >= entry_zone_low),
  check (setup_expires_at is null or setup_expires_at > created_at),
  check (
    generation_status <> 'ready'
    or (
      verdict is not null
      and generated_at is not null
      and (
        verdict not in ('LONG_SETUP', 'SHORT_SETUP', 'WAIT_FOR_ENTRY')
        or (
          direction in ('long', 'short')
          and (verdict = 'WAIT_FOR_ENTRY' or direction = case when verdict = 'LONG_SETUP' then 'long' else 'short' end)
          and entry_zone_low is not null
          and entry_zone_high is not null
          and stop_loss is not null
          and setup_quality_score is not null
          and reward_risk_ratio is not null
          and setup_expires_at is not null
          and public.ai_futures_validate_take_profits(take_profits, direction, entry_zone_low, entry_zone_high)
          and (
            (direction = 'long' and stop_loss < entry_zone_low)
            or (direction = 'short' and stop_loss > entry_zone_high)
          )
        )
      )
    )
  ),
  check (
    generation_status <> 'ready'
    or verdict <> 'WAIT_FOR_ENTRY'
    or (
      direction in ('long', 'short')
      and entry_zone_low is not null
      and entry_zone_high is not null
      and setup_expires_at is not null
    )
  )
);

create index if not exists ai_market_setups_snapshot_idx
on public.ai_market_setups(snapshot_id, created_at desc);

create index if not exists ai_market_setups_current_idx
on public.ai_market_setups(generation_status, verdict, setup_expires_at, created_at desc);

create index if not exists ai_market_setups_generation_lease_idx
on public.ai_market_setups(generation_status, generation_lease_expires_at)
where generation_status = 'generating';

create table if not exists public.ai_analysis_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 160),
  config_id uuid not null references public.ai_futures_configs(id) on delete restrict,
  snapshot_id uuid references public.ai_market_snapshots(id) on delete restrict,
  setup_id uuid references public.ai_market_setups(id) on delete restrict,
  status text not null check (status in ('accepted', 'processing', 'completed', 'failed', 'rate_limited', 'maintenance', 'shadow', 'unavailable')),
  retry_after_seconds integer check (retry_after_seconds is null or retry_after_seconds between 0 and 86400),
  error_code text check (error_code is null or length(error_code) <= 100),
  request_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(request_metadata) = 'object'),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, idempotency_key)
);

drop trigger if exists set_ai_analysis_requests_updated_at on public.ai_analysis_requests;
create trigger set_ai_analysis_requests_updated_at
before update on public.ai_analysis_requests
for each row execute function public.set_updated_at();

create index if not exists ai_analysis_requests_user_time_idx
on public.ai_analysis_requests(user_id, requested_at desc);

create index if not exists ai_analysis_requests_status_idx
on public.ai_analysis_requests(status, requested_at desc);

create table if not exists public.ai_rate_limit_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_started_at timestamptz not null,
  bucket_seconds integer not null check (bucket_seconds between 1 and 86400),
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket_started_at, bucket_seconds)
);

create index if not exists ai_rate_limit_buckets_expiry_idx
on public.ai_rate_limit_buckets(bucket_started_at);

create table if not exists public.ai_user_trade_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  setup_id uuid not null references public.ai_market_setups(id) on delete restrict,
  request_id uuid not null unique references public.ai_analysis_requests(id) on delete restrict,
  status text not null check (status in ('ready', 'risk_limit_exceeded')),
  direction text not null check (direction in ('long', 'short')),
  risk_profile_snapshot jsonb not null check (jsonb_typeof(risk_profile_snapshot) = 'object'),
  planning_balance numeric(30, 18) not null check (planning_balance > 0),
  risk_percent numeric(8, 4) not null check (risk_percent > 0 and risk_percent <= 3),
  risk_budget numeric(30, 18) not null check (risk_budget >= 0),
  max_leverage integer not null check (max_leverage between 1 and 10),
  max_margin_percent numeric(8, 4) not null check (max_margin_percent > 0 and max_margin_percent <= 50),
  leverage integer not null check (leverage between 1 and 10),
  entry_price numeric(28, 12) not null check (entry_price > 0),
  stop_loss numeric(28, 12) not null check (stop_loss > 0),
  quantity numeric(30, 14) check (quantity is null or quantity > 0),
  quantity_step_size numeric(30, 14) not null check (quantity_step_size > 0),
  position_notional numeric(30, 18) check (position_notional is null or position_notional > 0),
  required_isolated_margin numeric(30, 18) check (required_isolated_margin is null or required_isolated_margin > 0),
  planned_maximum_loss numeric(30, 18) check (planned_maximum_loss is null or planned_maximum_loss > 0),
  estimated_liquidation_price numeric(28, 12) check (estimated_liquidation_price is null or estimated_liquidation_price > 0),
  entry_fee_rate numeric(12, 10) not null check (entry_fee_rate >= 0 and entry_fee_rate <= 0.1),
  exit_fee_rate numeric(12, 10) not null check (exit_fee_rate >= 0 and exit_fee_rate <= 0.1),
  slippage_rate numeric(12, 10) not null check (slippage_rate >= 0 and slippage_rate <= 0.1),
  created_at timestamptz not null default now(),
  check (leverage <= max_leverage),
  check (risk_budget = trunc(planning_balance * risk_percent / 100, 18)),
  check (planned_maximum_loss is null or planned_maximum_loss <= risk_budget),
  check (required_isolated_margin is null or required_isolated_margin <= planning_balance * max_margin_percent / 100),
  check (quantity is null or mod(quantity, quantity_step_size) = 0),
  check (
    (status = 'ready'
      and risk_budget > 0
      and quantity is not null
      and position_notional is not null
      and required_isolated_margin is not null
      and planned_maximum_loss is not null)
    or (status = 'risk_limit_exceeded'
      and quantity is null
      and position_notional is null
      and required_isolated_margin is null
      and planned_maximum_loss is null
      and estimated_liquidation_price is null)
  ),
  check (
    estimated_liquidation_price is null
    or (direction = 'long' and estimated_liquidation_price < stop_loss)
    or (direction = 'short' and estimated_liquidation_price > stop_loss)
  )
);

create index if not exists ai_user_trade_plans_user_time_idx
on public.ai_user_trade_plans(user_id, created_at desc);

create index if not exists ai_user_trade_plans_setup_idx
on public.ai_user_trade_plans(setup_id, created_at desc);

create table if not exists public.ai_setup_outcomes (
  setup_id uuid primary key references public.ai_market_setups(id) on delete restrict,
  status text not null default 'awaiting_entry'
    check (status in ('awaiting_entry', 'entry_triggered', 'tp_partial', 'tp_hit', 'sl_hit', 'expired', 'invalidated')),
  entry_triggered_at timestamptz,
  entry_price numeric(28, 12) check (entry_price is null or entry_price > 0),
  highest_tp_hit integer check (highest_tp_hit is null or highest_tp_hit between 1 and 10),
  final_price numeric(28, 12) check (final_price is null or final_price > 0),
  maximum_favorable_excursion_r numeric(18, 8),
  maximum_adverse_excursion_r numeric(18, 8),
  realized_result_r numeric(18, 8),
  estimated_result_after_costs_r numeric(18, 8),
  last_checked_at timestamptz,
  finalized_at timestamptz,
  processing_lease_token uuid,
  processing_lease_owner text check (processing_lease_owner is null or length(processing_lease_owner) <= 200),
  processing_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (entry_triggered_at is null or entry_price is not null),
  check (
    (status in ('tp_hit', 'sl_hit', 'expired', 'invalidated') and finalized_at is not null)
    or (status not in ('tp_hit', 'sl_hit', 'expired', 'invalidated') and finalized_at is null)
  )
);

drop trigger if exists set_ai_setup_outcomes_updated_at on public.ai_setup_outcomes;
create trigger set_ai_setup_outcomes_updated_at
before update on public.ai_setup_outcomes
for each row execute function public.set_updated_at();

create index if not exists ai_setup_outcomes_active_idx
on public.ai_setup_outcomes(status, last_checked_at, processing_lease_expires_at)
where status in ('awaiting_entry', 'entry_triggered', 'tp_partial');

create table if not exists public.ai_setup_outcome_events (
  id uuid primary key default gen_random_uuid(),
  setup_id uuid not null references public.ai_market_setups(id) on delete restrict,
  event_key text not null check (length(event_key) between 1 and 240),
  event_type text not null
    check (event_type in ('entry_triggered', 'take_profit_hit', 'stop_loss_hit', 'expired', 'invalidated')),
  take_profit_index integer check (take_profit_index is null or take_profit_index between 1 and 10),
  trigger_price numeric(28, 12) check (trigger_price is null or trigger_price > 0),
  execution_price numeric(28, 12) check (execution_price is null or execution_price > 0),
  occurred_at timestamptz not null,
  candle_open_at timestamptz,
  candle_close_at timestamptz,
  was_ambiguous boolean not null default false,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (setup_id, event_key),
  check (candle_close_at is null or candle_open_at is null or candle_close_at >= candle_open_at),
  check ((event_type = 'take_profit_hit' and take_profit_index is not null) or event_type <> 'take_profit_hit')
);

create index if not exists ai_setup_outcome_events_setup_time_idx
on public.ai_setup_outcome_events(setup_id, occurred_at);

create table if not exists public.ai_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('market_pipeline', 'setup_generation', 'outcome_reconciliation', 'on_demand')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed', 'skipped')),
  worker_id text check (worker_id is null or length(worker_id) <= 200),
  snapshot_id uuid references public.ai_market_snapshots(id) on delete set null,
  setup_id uuid references public.ai_market_setups(id) on delete set null,
  counters jsonb not null default '{}'::jsonb check (jsonb_typeof(counters) = 'object'),
  error_code text check (error_code is null or length(error_code) <= 100),
  error_detail text check (error_detail is null or length(error_detail) <= 1000),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  check (finished_at is null or finished_at >= started_at),
  check ((status = 'running' and finished_at is null) or status <> 'running')
);

create index if not exists ai_pipeline_runs_job_time_idx
on public.ai_pipeline_runs(job_type, started_at desc);

create index if not exists ai_pipeline_runs_failures_idx
on public.ai_pipeline_runs(status, started_at desc)
where status in ('partial', 'failed');

create table if not exists public.ai_provider_events (
  id bigint generated by default as identity primary key,
  pipeline_run_id uuid references public.ai_pipeline_runs(id) on delete set null,
  provider text not null check (length(provider) between 1 and 100),
  data_category text not null check (length(data_category) between 1 and 100),
  status text not null check (status in ('success', 'timeout', 'rate_limited', 'invalid_response', 'stale', 'error')),
  source_timestamp timestamptz,
  http_status integer check (http_status is null or http_status between 100 and 599),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  retry_count integer not null default 0 check (retry_count between 0 and 10),
  error_code text check (error_code is null or length(error_code) <= 100),
  error_detail text check (error_detail is null or length(error_detail) <= 1000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create index if not exists ai_provider_events_health_idx
on public.ai_provider_events(provider, data_category, occurred_at desc);

create index if not exists ai_provider_events_failures_idx
on public.ai_provider_events(status, occurred_at desc)
where status <> 'success';

create table if not exists public.ai_model_usage_logs (
  id bigint generated by default as identity primary key,
  setup_id uuid references public.ai_market_setups(id) on delete set null,
  pipeline_run_id uuid references public.ai_pipeline_runs(id) on delete set null,
  provider_request_id text check (provider_request_id is null or length(provider_request_id) <= 240),
  model_name text not null check (length(model_name) between 1 and 100),
  prompt_version text not null check (length(prompt_version) between 1 and 100),
  status text not null check (status in ('success', 'timeout', 'refusal', 'invalid_schema', 'rate_limited', 'error')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_code text check (error_code is null or length(error_code) <= 100),
  created_at timestamptz not null default now(),
  check (total_tokens is null or coalesce(input_tokens, 0) + coalesce(output_tokens, 0) <= total_tokens)
);

create index if not exists ai_model_usage_logs_time_idx
on public.ai_model_usage_logs(created_at desc);

create index if not exists ai_model_usage_logs_failures_idx
on public.ai_model_usage_logs(status, created_at desc)
where status <> 'success';

create table if not exists public.ai_setup_admin_notes (
  id uuid primary key default gen_random_uuid(),
  setup_id uuid not null references public.ai_market_setups(id) on delete restrict,
  note text not null check (length(trim(note)) between 1 and 4000),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists ai_setup_admin_notes_setup_time_idx
on public.ai_setup_admin_notes(setup_id, created_at desc);

create or replace function public.ai_futures_reject_immutable_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception '% is append-only; % is not allowed', tg_table_name, lower(tg_op);
end;
$$;

create or replace function public.ai_futures_protect_setup_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'AI setup history cannot be deleted';
  end if;

  if old.generation_status in ('ready', 'failed') then
    raise exception 'Completed AI setups are immutable; add an admin note instead';
  end if;

  if new.id is distinct from old.id
    or new.snapshot_id is distinct from old.snapshot_id
    or new.config_id is distinct from old.config_id
    or new.model_name is distinct from old.model_name
    or new.prompt_version is distinct from old.prompt_version
    or new.engine_version is distinct from old.engine_version
    or new.created_at is distinct from old.created_at
  then
    raise exception 'AI setup identity and version fields are immutable';
  end if;

  return new;
end;
$$;

create or replace function public.ai_futures_protect_outcome_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.setup_id is distinct from new.setup_id or old.created_at is distinct from new.created_at then
    raise exception 'AI setup outcome identity fields are immutable';
  end if;

  if old.status in ('tp_hit', 'sl_hit', 'expired', 'invalidated') then
    raise exception 'Final AI setup outcomes are immutable';
  end if;

  if (old.status = 'awaiting_entry' and new.status not in ('awaiting_entry', 'entry_triggered', 'expired', 'invalidated'))
    or (old.status = 'entry_triggered' and new.status not in ('entry_triggered', 'tp_partial', 'tp_hit', 'sl_hit', 'expired', 'invalidated'))
    or (old.status = 'tp_partial' and new.status not in ('tp_partial', 'tp_hit', 'sl_hit', 'expired', 'invalidated'))
  then
    raise exception 'Invalid AI setup outcome state transition from % to %', old.status, new.status;
  end if;

  if old.entry_triggered_at is not null
    and (
      old.entry_triggered_at is distinct from new.entry_triggered_at
      or old.entry_price is distinct from new.entry_price
    )
  then
    raise exception 'AI setup entry history is immutable after entry is recorded';
  end if;

  return new;
end;
$$;

create or replace function public.ai_futures_validate_outcome_event_time()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_setup_created_at timestamptz;
begin
  select setup.created_at
  into source_setup_created_at
  from public.ai_market_setups as setup
  where setup.id = new.setup_id;

  if source_setup_created_at is null
    or new.occurred_at < source_setup_created_at
    or new.occurred_at > clock_timestamp()
    or (new.candle_open_at is not null and new.candle_open_at < source_setup_created_at)
    or (new.candle_close_at is not null and new.candle_close_at > clock_timestamp())
  then
    raise exception 'AI outcome events must use closed data occurring after setup creation';
  end if;

  return new;
end;
$$;

create or replace function public.ai_futures_log_config_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ai_futures_config_audit (
    config_id,
    config_version,
    action,
    actor_user_id,
    config_snapshot
  )
  values (
    new.id,
    new.version,
    'created',
    new.created_by,
    to_jsonb(new)
  );

  return new;
end;
$$;

drop trigger if exists protect_ai_futures_configs_history on public.ai_futures_configs;
create trigger protect_ai_futures_configs_history
before update or delete on public.ai_futures_configs
for each row execute function public.ai_futures_reject_immutable_change();

drop trigger if exists log_ai_futures_config_creation on public.ai_futures_configs;
create trigger log_ai_futures_config_creation
after insert on public.ai_futures_configs
for each row execute function public.ai_futures_log_config_creation();

drop trigger if exists protect_ai_futures_config_audit on public.ai_futures_config_audit;
create trigger protect_ai_futures_config_audit
before update or delete on public.ai_futures_config_audit
for each row execute function public.ai_futures_reject_immutable_change();

drop trigger if exists protect_ai_market_snapshots_history on public.ai_market_snapshots;
create trigger protect_ai_market_snapshots_history
before update or delete on public.ai_market_snapshots
for each row execute function public.ai_futures_reject_immutable_change();

drop trigger if exists protect_ai_market_setups_history on public.ai_market_setups;
create trigger protect_ai_market_setups_history
before update or delete on public.ai_market_setups
for each row execute function public.ai_futures_protect_setup_history();

drop trigger if exists set_ai_market_setups_updated_at on public.ai_market_setups;
create trigger set_ai_market_setups_updated_at
before update on public.ai_market_setups
for each row execute function public.set_updated_at();

drop trigger if exists protect_ai_user_trade_plans_history on public.ai_user_trade_plans;
create trigger protect_ai_user_trade_plans_history
before update or delete on public.ai_user_trade_plans
for each row execute function public.ai_futures_reject_immutable_change();

drop trigger if exists protect_ai_setup_outcome_events_history on public.ai_setup_outcome_events;
create trigger protect_ai_setup_outcome_events_history
before update or delete on public.ai_setup_outcome_events
for each row execute function public.ai_futures_reject_immutable_change();

drop trigger if exists validate_ai_setup_outcome_event_time on public.ai_setup_outcome_events;
create trigger validate_ai_setup_outcome_event_time
before insert on public.ai_setup_outcome_events
for each row execute function public.ai_futures_validate_outcome_event_time();

drop trigger if exists protect_ai_setup_outcome_transition on public.ai_setup_outcomes;
create trigger protect_ai_setup_outcome_transition
before update on public.ai_setup_outcomes
for each row execute function public.ai_futures_protect_outcome_transition();

drop trigger if exists protect_ai_provider_events_history on public.ai_provider_events;
create trigger protect_ai_provider_events_history
before update or delete on public.ai_provider_events
for each row execute function public.ai_futures_reject_immutable_change();

drop trigger if exists protect_ai_model_usage_logs_history on public.ai_model_usage_logs;
create trigger protect_ai_model_usage_logs_history
before update or delete on public.ai_model_usage_logs
for each row execute function public.ai_futures_reject_immutable_change();

drop trigger if exists protect_ai_setup_admin_notes_history on public.ai_setup_admin_notes;
create trigger protect_ai_setup_admin_notes_history
before update or delete on public.ai_setup_admin_notes
for each row execute function public.ai_futures_reject_immutable_change();

insert into public.ai_futures_configs (
  id,
  feature_enabled,
  shadow_mode,
  ai_calls_enabled,
  allow_deterministic_only,
  emergency_kill_switch,
  configured_symbols,
  change_reason
)
values (
  'a1000000-0000-4000-8000-000000000001',
  false,
  true,
  false,
  false,
  false,
  array['BTCUSDT']::text[],
  'Safe initial configuration: feature disabled, shadow mode enabled, AI calls disabled.'
)
on conflict (id) do nothing;

create or replace function public.ai_futures_user_has_academy_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and (
    exists (
      select 1
      from public.profiles as profile
      where profile.id = p_user_id
        and (
          profile.role = 'admin'
          or (
            profile.premium_until is not null
            and profile.premium_until > now()
            and (profile.premium_starts_at is null or profile.premium_starts_at <= now())
          )
        )
    )
    or exists (
      select 1
      from public.premium_subscriptions as subscription
      where subscription.user_id = p_user_id
        and subscription.product_type = 'premium'
        and subscription.status in ('pending', 'active')
        and subscription.starts_at <= now()
        and subscription.expires_at > now()
    )
  );
$$;

-- The older helper accepted an arbitrary user id and was executable by every
-- authenticated account. Keep it available to trusted server code only.
revoke execute on function public.user_has_trading_academy_access(uuid) from public, anon, authenticated;
grant execute on function public.user_has_trading_academy_access(uuid) to service_role;

create or replace function public.admin_create_ai_futures_config(
  p_feature_enabled boolean default null,
  p_shadow_mode boolean default null,
  p_ai_calls_enabled boolean default null,
  p_allow_deterministic_only boolean default null,
  p_emergency_kill_switch boolean default null,
  p_configured_symbols text[] default null,
  p_score_weights jsonb default null,
  p_minimum_setup_score numeric default null,
  p_minimum_score_difference numeric default null,
  p_minimum_reward_risk numeric default null,
  p_maximum_custom_risk_percent numeric default null,
  p_maximum_leverage integer default null,
  p_maximum_margin_percent numeric default null,
  p_candle_stale_after_seconds integer default null,
  p_live_price_stale_after_seconds integer default null,
  p_futures_metrics_stale_after_seconds integer default null,
  p_sentiment_stale_after_seconds integer default null,
  p_per_user_requests_per_minute integer default null,
  p_per_user_min_refresh_seconds integer default null,
  p_generation_lease_seconds integer default null,
  p_maximum_generation_attempts integer default null,
  p_provider_timeout_ms integer default null,
  p_provider_retry_count integer default null,
  p_feature_version text default null,
  p_engine_version text default null,
  p_prompt_version text default null,
  p_model_name text default null,
  p_provider_settings jsonb default null,
  p_change_reason text default null
)
returns public.ai_futures_configs
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_config public.ai_futures_configs;
  saved_config public.ai_futures_configs;
  safe_reason text := nullif(trim(coalesce(p_change_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can create AI Futures configuration versions';
  end if;

  if safe_reason is null then
    raise exception 'A configuration change reason is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_futures_config_version', 0));

  select *
  into previous_config
  from public.ai_futures_configs
  order by version desc
  limit 1;

  if previous_config.id is null then
    raise exception 'Initial AI Futures configuration is missing';
  end if;

  insert into public.ai_futures_configs (
    feature_enabled, shadow_mode, ai_calls_enabled, allow_deterministic_only,
    emergency_kill_switch, configured_symbols, trading_style, timeframe_profile,
    score_weights, minimum_setup_score, minimum_score_difference,
    minimum_reward_risk, maximum_custom_risk_percent, maximum_leverage,
    maximum_margin_percent, candle_stale_after_seconds,
    live_price_stale_after_seconds, futures_metrics_stale_after_seconds,
    sentiment_stale_after_seconds, per_user_requests_per_minute,
    per_user_min_refresh_seconds, generation_lease_seconds,
    maximum_generation_attempts, provider_timeout_ms, provider_retry_count,
    feature_version, engine_version, prompt_version, model_name,
    provider_settings, created_by, change_reason
  )
  values (
    coalesce(p_feature_enabled, previous_config.feature_enabled),
    coalesce(p_shadow_mode, previous_config.shadow_mode),
    coalesce(p_ai_calls_enabled, previous_config.ai_calls_enabled),
    coalesce(p_allow_deterministic_only, previous_config.allow_deterministic_only),
    coalesce(p_emergency_kill_switch, previous_config.emergency_kill_switch),
    coalesce(p_configured_symbols, previous_config.configured_symbols),
    previous_config.trading_style,
    previous_config.timeframe_profile,
    coalesce(p_score_weights, previous_config.score_weights),
    coalesce(p_minimum_setup_score, previous_config.minimum_setup_score),
    coalesce(p_minimum_score_difference, previous_config.minimum_score_difference),
    coalesce(p_minimum_reward_risk, previous_config.minimum_reward_risk),
    coalesce(p_maximum_custom_risk_percent, previous_config.maximum_custom_risk_percent),
    coalesce(p_maximum_leverage, previous_config.maximum_leverage),
    coalesce(p_maximum_margin_percent, previous_config.maximum_margin_percent),
    coalesce(p_candle_stale_after_seconds, previous_config.candle_stale_after_seconds),
    coalesce(p_live_price_stale_after_seconds, previous_config.live_price_stale_after_seconds),
    coalesce(p_futures_metrics_stale_after_seconds, previous_config.futures_metrics_stale_after_seconds),
    coalesce(p_sentiment_stale_after_seconds, previous_config.sentiment_stale_after_seconds),
    coalesce(p_per_user_requests_per_minute, previous_config.per_user_requests_per_minute),
    coalesce(p_per_user_min_refresh_seconds, previous_config.per_user_min_refresh_seconds),
    coalesce(p_generation_lease_seconds, previous_config.generation_lease_seconds),
    coalesce(p_maximum_generation_attempts, previous_config.maximum_generation_attempts),
    coalesce(p_provider_timeout_ms, previous_config.provider_timeout_ms),
    coalesce(p_provider_retry_count, previous_config.provider_retry_count),
    coalesce(nullif(trim(p_feature_version), ''), previous_config.feature_version),
    coalesce(nullif(trim(p_engine_version), ''), previous_config.engine_version),
    coalesce(nullif(trim(p_prompt_version), ''), previous_config.prompt_version),
    coalesce(nullif(trim(p_model_name), ''), previous_config.model_name),
    coalesce(p_provider_settings, previous_config.provider_settings),
    auth.uid(),
    safe_reason
  )
  returning * into saved_config;

  return saved_config;
end;
$$;

create or replace function public.claim_ai_futures_analysis_request(
  p_user_id uuid,
  p_idempotency_key text,
  p_request_metadata jsonb default '{}'::jsonb
)
returns table (
  request_id uuid,
  request_status text,
  allowed boolean,
  replayed boolean,
  retry_after_seconds integer,
  active_config_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_idempotency_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  safe_metadata jsonb := coalesce(p_request_metadata, '{}'::jsonb);
  active_config public.ai_futures_configs;
  existing_request public.ai_analysis_requests;
  created_request public.ai_analysis_requests;
  latest_allowed_request_at timestamptz;
  bucket_start timestamptz := date_trunc('minute', clock_timestamp());
  bucket_count integer := null;
  retry_seconds integer := null;
  blocked_status text := null;
  blocked_code text := null;
begin
  if p_user_id is null then
    raise exception 'Authenticated user is required';
  end if;

  if safe_idempotency_key is null or length(safe_idempotency_key) not between 8 and 160 then
    raise exception 'A valid idempotency key is required';
  end if;

  if jsonb_typeof(safe_metadata) <> 'object' then
    raise exception 'Request metadata must be an object';
  end if;

  if not public.ai_futures_user_has_academy_access(p_user_id) then
    raise exception using
      errcode = '42501',
      message = 'Active Trading Academy access is required';
  end if;

  -- Serializes different idempotency keys from the same user, preventing
  -- concurrent refreshes from bypassing either limiter.
  perform pg_advisory_xact_lock(hashtextextended('ai-futures-user:' || p_user_id::text, 0));

  delete from public.ai_rate_limit_buckets as old_bucket
  where old_bucket.user_id = p_user_id
    and old_bucket.bucket_started_at < clock_timestamp() - interval '1 day';

  select config.*
  into active_config
  from public.ai_futures_configs as config
  order by config.version desc
  limit 1;

  if active_config.id is null then
    raise exception 'AI Futures configuration is unavailable';
  end if;

  if active_config.emergency_kill_switch or not active_config.feature_enabled then
    blocked_status := 'maintenance';
    blocked_code := case
      when active_config.emergency_kill_switch then 'emergency_kill_switch'
      else 'feature_disabled'
    end;
  elsif active_config.shadow_mode then
    blocked_status := 'shadow';
    blocked_code := 'shadow_mode';
  elsif not active_config.ai_calls_enabled and not active_config.allow_deterministic_only then
    blocked_status := 'unavailable';
    blocked_code := 'ai_calls_disabled';
  end if;

  -- Safety controls are evaluated before idempotent replay. An old completed
  -- response must never bypass shadow mode, feature disablement, or the kill
  -- switch, and responses generated under an older config are not replayed.
  select request.*
  into existing_request
  from public.ai_analysis_requests as request
  where request.user_id = p_user_id
    and request.idempotency_key = safe_idempotency_key
  limit 1;

  if existing_request.id is not null then
    request_id := existing_request.id;
    retry_after_seconds := existing_request.retry_after_seconds;
    active_config_id := active_config.id;

    if blocked_status is not null then
      request_status := blocked_status;
      allowed := false;
      replayed := false;
    elsif existing_request.config_id is distinct from active_config.id then
      request_status := 'configuration_changed';
      allowed := false;
      replayed := false;
      retry_after_seconds := null;
    else
      request_status := existing_request.status;
      allowed := existing_request.status in ('accepted', 'processing', 'completed');
      replayed := true;
    end if;

    return next;
    return;
  end if;

  if blocked_status is not null then
    insert into public.ai_analysis_requests (
      user_id, idempotency_key, config_id, status, error_code, request_metadata
    )
    values (
      p_user_id, safe_idempotency_key, active_config.id, blocked_status, blocked_code, safe_metadata
    )
    returning * into created_request;

    request_id := created_request.id;
    request_status := created_request.status;
    allowed := false;
    replayed := false;
    retry_after_seconds := null;
    active_config_id := active_config.id;
    return next;
    return;
  end if;

  if active_config.per_user_min_refresh_seconds > 0 then
    select request.requested_at
    into latest_allowed_request_at
    from public.ai_analysis_requests as request
    where request.user_id = p_user_id
      and request.status in ('accepted', 'processing', 'completed')
    order by request.requested_at desc
    limit 1;

    if latest_allowed_request_at is not null
      and latest_allowed_request_at + make_interval(secs => active_config.per_user_min_refresh_seconds) > clock_timestamp()
    then
      retry_seconds := greatest(
        1,
        ceil(extract(epoch from (
          latest_allowed_request_at
          + make_interval(secs => active_config.per_user_min_refresh_seconds)
          - clock_timestamp()
        )))::integer
      );
    end if;
  end if;

  if retry_seconds is null then
    insert into public.ai_rate_limit_buckets as bucket (
      user_id, bucket_started_at, bucket_seconds, request_count, updated_at
    )
    values (p_user_id, bucket_start, 60, 1, clock_timestamp())
    on conflict (user_id, bucket_started_at, bucket_seconds) do update
    set request_count = bucket.request_count + 1,
        updated_at = clock_timestamp()
    where bucket.request_count < active_config.per_user_requests_per_minute
    returning request_count into bucket_count;

    if bucket_count is null then
      retry_seconds := greatest(
        1,
        ceil(extract(epoch from (bucket_start + interval '1 minute' - clock_timestamp())))::integer
      );
    end if;
  end if;

  if retry_seconds is not null then
    insert into public.ai_analysis_requests (
      user_id, idempotency_key, config_id, status, retry_after_seconds,
      error_code, request_metadata
    )
    values (
      p_user_id, safe_idempotency_key, active_config.id, 'rate_limited', retry_seconds,
      'analysis_rate_limited', safe_metadata
    )
    returning * into created_request;

    request_id := created_request.id;
    request_status := created_request.status;
    allowed := false;
    replayed := false;
    retry_after_seconds := retry_seconds;
    active_config_id := active_config.id;
    return next;
    return;
  end if;

  insert into public.ai_analysis_requests (
    user_id, idempotency_key, config_id, status, request_metadata
  )
  values (
    p_user_id, safe_idempotency_key, active_config.id, 'accepted', safe_metadata
  )
  returning * into created_request;

  request_id := created_request.id;
  request_status := created_request.status;
  allowed := true;
  replayed := false;
  retry_after_seconds := null;
  active_config_id := active_config.id;
  return next;
end;
$$;

create or replace function public.claim_ai_futures_setup_generation(
  p_snapshot_id uuid,
  p_config_id uuid,
  p_engine_version text,
  p_prompt_version text,
  p_model_name text,
  p_worker_id text,
  p_lease_seconds integer default null
)
returns table (
  setup_id uuid,
  claimed boolean,
  setup_generation_status text,
  lease_token uuid,
  lease_expires_at timestamptz,
  existing_verdict text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  active_config public.ai_futures_configs;
  snapshot_row public.ai_market_snapshots;
  setup_row public.ai_market_setups;
  next_lease_token uuid := gen_random_uuid();
  safe_worker_id text := nullif(left(trim(coalesce(p_worker_id, '')), 200), '');
  safe_lease_seconds integer;
begin
  if p_snapshot_id is null or p_config_id is null then
    raise exception 'Snapshot and configuration are required';
  end if;

  if nullif(trim(coalesce(p_engine_version, '')), '') is null
    or nullif(trim(coalesce(p_prompt_version, '')), '') is null
    or nullif(trim(coalesce(p_model_name, '')), '') is null
    or safe_worker_id is null
  then
    raise exception 'Engine, prompt, model, and worker identifiers are required';
  end if;

  select config.*
  into active_config
  from public.ai_futures_configs as config
  order by config.version desc
  limit 1;

  if active_config.id is null or active_config.id <> p_config_id then
    raise exception 'The requested AI Futures configuration is no longer current';
  end if;

  if not active_config.feature_enabled or active_config.emergency_kill_switch then
    raise exception 'AI Futures generation is disabled';
  end if;

  if not active_config.ai_calls_enabled and not active_config.allow_deterministic_only then
    raise exception 'AI Futures generation providers are disabled';
  end if;

  if trim(p_engine_version) <> active_config.engine_version
    or trim(p_prompt_version) <> active_config.prompt_version
    or trim(p_model_name) <> active_config.model_name
  then
    raise exception 'Setup generation versions do not match the active configuration';
  end if;

  select snapshot.*
  into snapshot_row
  from public.ai_market_snapshots as snapshot
  where snapshot.id = p_snapshot_id;

  if snapshot_row.id is null
    or snapshot_row.data_status <> 'ready'
    or not (snapshot_row.symbol = any(active_config.configured_symbols))
    or snapshot_row.timeframe <> '15m'
    or snapshot_row.timeframe_profile <> active_config.timeframe_profile
    or snapshot_row.feature_version <> active_config.feature_version
    or snapshot_row.market_data_as_of
      + make_interval(secs => active_config.candle_stale_after_seconds) <= clock_timestamp()
  then
    raise exception 'A fresh, version-matched 15-minute market snapshot is required';
  end if;

  safe_lease_seconds := least(
    900,
    greatest(15, coalesce(p_lease_seconds, active_config.generation_lease_seconds))
  );

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'ai-futures-setup', p_snapshot_id, p_config_id, p_engine_version, p_prompt_version),
    0
  ));

  insert into public.ai_market_setups (
    snapshot_id, config_id, generation_status, model_name, prompt_version,
    engine_version, generation_lease_token, generation_lease_owner,
    generation_lease_expires_at, generation_attempts
  )
  values (
    p_snapshot_id, p_config_id, 'generating', trim(p_model_name), trim(p_prompt_version),
    trim(p_engine_version), next_lease_token, safe_worker_id,
    clock_timestamp() + make_interval(secs => safe_lease_seconds), 1
  )
  on conflict (snapshot_id, config_id, engine_version, prompt_version) do nothing
  returning * into setup_row;

  if setup_row.id is not null then
    setup_id := setup_row.id;
    claimed := true;
    setup_generation_status := setup_row.generation_status;
    lease_token := setup_row.generation_lease_token;
    lease_expires_at := setup_row.generation_lease_expires_at;
    existing_verdict := setup_row.verdict;
    return next;
    return;
  end if;

  select setup.*
  into setup_row
  from public.ai_market_setups as setup
  where setup.snapshot_id = p_snapshot_id
    and setup.config_id = p_config_id
    and setup.engine_version = trim(p_engine_version)
    and setup.prompt_version = trim(p_prompt_version)
  for update;

  if setup_row.generation_status = 'generating'
    and coalesce(setup_row.generation_lease_expires_at, '-infinity'::timestamptz) <= clock_timestamp()
    and setup_row.generation_attempts < active_config.maximum_generation_attempts
  then
    update public.ai_market_setups as setup
    set generation_lease_token = next_lease_token,
        generation_lease_owner = safe_worker_id,
        generation_lease_expires_at = clock_timestamp() + make_interval(secs => safe_lease_seconds),
        generation_attempts = setup.generation_attempts + 1
    where setup.id = setup_row.id
    returning * into setup_row;

    setup_id := setup_row.id;
    claimed := true;
    setup_generation_status := setup_row.generation_status;
    lease_token := setup_row.generation_lease_token;
    lease_expires_at := setup_row.generation_lease_expires_at;
    existing_verdict := setup_row.verdict;
    return next;
    return;
  end if;

  if setup_row.generation_status = 'generating'
    and coalesce(setup_row.generation_lease_expires_at, '-infinity'::timestamptz) <= clock_timestamp()
    and setup_row.generation_attempts >= active_config.maximum_generation_attempts
  then
    update public.ai_market_setups as setup
    set generation_status = 'failed',
        verdict = 'DATA_UNAVAILABLE',
        failure_code = 'generation_attempts_exhausted',
        failure_detail = 'The setup generation lease expired too many times.',
        generated_at = clock_timestamp(),
        generation_lease_token = null,
        generation_lease_owner = null,
        generation_lease_expires_at = null
    where setup.id = setup_row.id
    returning * into setup_row;
  end if;

  setup_id := setup_row.id;
  claimed := false;
  setup_generation_status := setup_row.generation_status;
  lease_token := null;
  lease_expires_at := setup_row.generation_lease_expires_at;
  existing_verdict := setup_row.verdict;
  return next;
end;
$$;

create or replace function public.renew_ai_futures_setup_generation_lease(
  p_setup_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  next_expiry timestamptz;
begin
  if p_setup_id is null or p_lease_token is null then
    raise exception 'Setup and lease token are required';
  end if;

  update public.ai_market_setups as setup
  set generation_lease_expires_at = clock_timestamp()
      + make_interval(secs => least(900, greatest(15, coalesce(p_lease_seconds, 120))))
  where setup.id = p_setup_id
    and setup.generation_status = 'generating'
    and setup.generation_lease_token = p_lease_token
    and setup.generation_lease_expires_at > clock_timestamp()
  returning setup.generation_lease_expires_at into next_expiry;

  if next_expiry is null then
    raise exception using errcode = '40001', message = 'AI setup generation lease was lost';
  end if;

  return next_expiry;
end;
$$;

create or replace function public.complete_ai_futures_setup_generation(
  p_setup_id uuid,
  p_lease_token uuid,
  p_verdict text,
  p_direction text default null,
  p_entry_zone_low numeric default null,
  p_entry_zone_high numeric default null,
  p_stop_loss numeric default null,
  p_take_profits jsonb default '[]'::jsonb,
  p_invalidation_level numeric default null,
  p_setup_quality_score numeric default null,
  p_score_components jsonb default '{}'::jsonb,
  p_reward_risk_ratio numeric default null,
  p_market_regime text default null,
  p_deterministic_candidate jsonb default '{}'::jsonb,
  p_ai_structured_output jsonb default null,
  p_setup_expires_at timestamptz default null
)
returns public.ai_market_setups
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_setup public.ai_market_setups;
  control_config public.ai_futures_configs;
begin
  if p_setup_id is null or p_lease_token is null then
    raise exception 'Setup and lease token are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_futures_config_version', 0));

  select config.*
  into control_config
  from public.ai_futures_configs as config
  order by config.version desc
  limit 1;

  if control_config.id is null
    or not control_config.feature_enabled
    or control_config.emergency_kill_switch
  then
    raise exception 'AI Futures generation was disabled before completion';
  end if;

  update public.ai_market_setups as setup
  set generation_status = 'ready',
      verdict = p_verdict,
      direction = p_direction,
      entry_zone_low = p_entry_zone_low,
      entry_zone_high = p_entry_zone_high,
      stop_loss = p_stop_loss,
      take_profits = coalesce(p_take_profits, '[]'::jsonb),
      invalidation_level = p_invalidation_level,
      setup_quality_score = p_setup_quality_score,
      score_components = coalesce(p_score_components, '{}'::jsonb),
      reward_risk_ratio = p_reward_risk_ratio,
      market_regime = p_market_regime,
      deterministic_candidate = coalesce(p_deterministic_candidate, '{}'::jsonb),
      ai_structured_output = p_ai_structured_output,
      setup_expires_at = p_setup_expires_at,
      generated_at = clock_timestamp(),
      generation_lease_token = null,
      generation_lease_owner = null,
      generation_lease_expires_at = null,
      failure_code = null,
      failure_detail = null
  where setup.id = p_setup_id
    and setup.generation_status = 'generating'
    and setup.config_id = control_config.id
    and setup.generation_lease_token = p_lease_token
    and setup.generation_lease_expires_at > clock_timestamp()
  returning * into saved_setup;

  if saved_setup.id is null then
    raise exception using errcode = '40001', message = 'AI setup generation lease was lost';
  end if;

  if saved_setup.verdict in ('LONG_SETUP', 'SHORT_SETUP', 'WAIT_FOR_ENTRY') then
    insert into public.ai_setup_outcomes (setup_id)
    values (saved_setup.id)
    on conflict (setup_id) do nothing;
  end if;

  return saved_setup;
end;
$$;

create or replace function public.fail_ai_futures_setup_generation(
  p_setup_id uuid,
  p_lease_token uuid,
  p_failure_code text,
  p_failure_detail text default null
)
returns public.ai_market_setups
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_setup public.ai_market_setups;
  safe_code text := nullif(left(trim(coalesce(p_failure_code, '')), 100), '');
  safe_detail text := nullif(left(trim(coalesce(p_failure_detail, '')), 1000), '');
begin
  if p_setup_id is null or p_lease_token is null or safe_code is null then
    raise exception 'Setup, lease token, and failure code are required';
  end if;

  update public.ai_market_setups as setup
  set generation_status = 'failed',
      verdict = 'DATA_UNAVAILABLE',
      generated_at = clock_timestamp(),
      failure_code = safe_code,
      failure_detail = safe_detail,
      generation_lease_token = null,
      generation_lease_owner = null,
      generation_lease_expires_at = null
  where setup.id = p_setup_id
    and setup.generation_status = 'generating'
    and setup.generation_lease_token = p_lease_token
    and setup.generation_lease_expires_at > clock_timestamp()
  returning * into saved_setup;

  if saved_setup.id is null then
    raise exception using errcode = '40001', message = 'AI setup generation lease was lost';
  end if;

  return saved_setup;
end;
$$;

create or replace function public.claim_ai_setup_outcomes_for_reconciliation(
  p_worker_id text,
  p_limit integer default 100,
  p_lease_seconds integer default 120
)
returns setof public.ai_setup_outcomes
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_worker_id text := nullif(left(trim(coalesce(p_worker_id, '')), 200), '');
  safe_limit integer := least(500, greatest(1, coalesce(p_limit, 100)));
  safe_lease_seconds integer := least(900, greatest(15, coalesce(p_lease_seconds, 120)));
begin
  if safe_worker_id is null then
    raise exception 'Outcome reconciliation worker id is required';
  end if;

  return query
  with candidates as (
    select outcome.setup_id
    from public.ai_setup_outcomes as outcome
    join public.ai_market_setups as setup on setup.id = outcome.setup_id
    where outcome.status in ('awaiting_entry', 'entry_triggered', 'tp_partial')
      and setup.generation_status = 'ready'
      and coalesce(outcome.processing_lease_expires_at, '-infinity'::timestamptz) <= clock_timestamp()
    order by outcome.last_checked_at asc nulls first, outcome.created_at asc
    for update of outcome skip locked
    limit safe_limit
  )
  update public.ai_setup_outcomes as outcome
  set processing_lease_token = gen_random_uuid(),
      processing_lease_owner = safe_worker_id,
      processing_lease_expires_at = clock_timestamp() + make_interval(secs => safe_lease_seconds)
  from candidates
  where outcome.setup_id = candidates.setup_id
  returning outcome.*;
end;
$$;

create or replace function public.save_ai_setup_outcome_reconciliation(
  p_setup_id uuid,
  p_lease_token uuid,
  p_next_outcome jsonb,
  p_events jsonb default '[]'::jsonb
)
returns public.ai_setup_outcomes
language plpgsql
security definer
set search_path = public
as $$
declare
  current_outcome public.ai_setup_outcomes;
  saved_outcome public.ai_setup_outcomes;
  setup_created_at timestamptz;
  next_status text;
  next_last_checked_at timestamptz;
  event_item jsonb;
  event_occurred_at timestamptz;
  event_candle_open_at timestamptz;
  event_candle_close_at timestamptz;
  inserted_event_count integer;
begin
  if p_setup_id is null or p_lease_token is null then
    raise exception 'Setup and outcome lease token are required';
  end if;

  if p_next_outcome is null or jsonb_typeof(p_next_outcome) <> 'object' then
    raise exception 'Next outcome must be an object';
  end if;

  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 50 then
    raise exception 'Outcome events must be an array containing at most 50 events';
  end if;

  select outcome.*
  into current_outcome
  from public.ai_setup_outcomes as outcome
  where outcome.setup_id = p_setup_id
  for update;

  if current_outcome.setup_id is null then
    raise exception 'AI setup outcome was not found';
  end if;

  select setup.created_at
  into setup_created_at
  from public.ai_market_setups as setup
  where setup.id = p_setup_id;

  if setup_created_at is null then
    raise exception 'AI market setup was not found';
  end if;

  if current_outcome.processing_lease_token is distinct from p_lease_token
    or coalesce(current_outcome.processing_lease_expires_at, '-infinity'::timestamptz) <= clock_timestamp()
  then
    raise exception using errcode = '40001', message = 'AI setup outcome lease was lost';
  end if;

  next_status := nullif(p_next_outcome ->> 'status', '');
  if next_status is null then
    raise exception 'Next outcome status is required';
  end if;

  next_last_checked_at := nullif(p_next_outcome ->> 'last_checked_at', '')::timestamptz;
  if next_last_checked_at is not null
    and current_outcome.last_checked_at is not null
    and next_last_checked_at < current_outcome.last_checked_at
  then
    raise exception 'Outcome reconciliation cannot move its candle cursor backwards';
  end if;

  if next_last_checked_at is not null
    and (next_last_checked_at < setup_created_at or next_last_checked_at > clock_timestamp())
  then
    raise exception 'Outcome reconciliation cannot process future candles';
  end if;

  for event_item in select element from jsonb_array_elements(p_events) as entries(element)
  loop
    if jsonb_typeof(event_item) <> 'object' then
      raise exception 'Outcome event must be an object';
    end if;

    event_occurred_at := nullif(event_item ->> 'occurred_at', '')::timestamptz;
    event_candle_open_at := nullif(event_item ->> 'candle_open_at', '')::timestamptz;
    event_candle_close_at := nullif(event_item ->> 'candle_close_at', '')::timestamptz;

    if event_occurred_at is null
      or event_occurred_at < setup_created_at
      or event_occurred_at > clock_timestamp()
      or (event_candle_open_at is not null and event_candle_open_at < setup_created_at)
      or (event_candle_close_at is not null and event_candle_close_at > clock_timestamp())
    then
      raise exception 'Outcome events must use closed market data occurring after setup creation';
    end if;

    insert into public.ai_setup_outcome_events (
      setup_id, event_key, event_type, take_profit_index, trigger_price,
      execution_price, occurred_at, candle_open_at, candle_close_at,
      was_ambiguous, metadata
    )
    values (
      p_setup_id,
      nullif(event_item ->> 'event_key', ''),
      nullif(event_item ->> 'event_type', ''),
      nullif(event_item ->> 'take_profit_index', '')::integer,
      nullif(event_item ->> 'trigger_price', '')::numeric,
      nullif(event_item ->> 'execution_price', '')::numeric,
      event_occurred_at,
      event_candle_open_at,
      event_candle_close_at,
      coalesce(nullif(event_item ->> 'was_ambiguous', '')::boolean, false),
      coalesce(event_item -> 'metadata', '{}'::jsonb)
    )
    on conflict (setup_id, event_key) do nothing;

    get diagnostics inserted_event_count = row_count;
    if inserted_event_count = 0 and not exists (
      select 1
      from public.ai_setup_outcome_events as existing_event
      where existing_event.setup_id = p_setup_id
        and existing_event.event_key = nullif(event_item ->> 'event_key', '')
        and existing_event.event_type = nullif(event_item ->> 'event_type', '')
        and existing_event.take_profit_index is not distinct from nullif(event_item ->> 'take_profit_index', '')::integer
        and existing_event.trigger_price is not distinct from nullif(event_item ->> 'trigger_price', '')::numeric
        and existing_event.execution_price is not distinct from nullif(event_item ->> 'execution_price', '')::numeric
        and existing_event.occurred_at = event_occurred_at
        and existing_event.candle_open_at is not distinct from event_candle_open_at
        and existing_event.candle_close_at is not distinct from event_candle_close_at
    ) then
      raise exception 'Outcome event idempotency key conflicts with previously stored event data';
    end if;
  end loop;

  update public.ai_setup_outcomes as outcome
  set status = next_status,
      entry_triggered_at = nullif(p_next_outcome ->> 'entry_triggered_at', '')::timestamptz,
      entry_price = nullif(p_next_outcome ->> 'entry_price', '')::numeric,
      highest_tp_hit = nullif(p_next_outcome ->> 'highest_tp_hit', '')::integer,
      final_price = nullif(p_next_outcome ->> 'final_price', '')::numeric,
      maximum_favorable_excursion_r = nullif(p_next_outcome ->> 'maximum_favorable_excursion_r', '')::numeric,
      maximum_adverse_excursion_r = nullif(p_next_outcome ->> 'maximum_adverse_excursion_r', '')::numeric,
      realized_result_r = nullif(p_next_outcome ->> 'realized_result_r', '')::numeric,
      estimated_result_after_costs_r = nullif(p_next_outcome ->> 'estimated_result_after_costs_r', '')::numeric,
      last_checked_at = next_last_checked_at,
      finalized_at = nullif(p_next_outcome ->> 'finalized_at', '')::timestamptz,
      processing_lease_token = null,
      processing_lease_owner = null,
      processing_lease_expires_at = null
  where outcome.setup_id = p_setup_id
    and outcome.processing_lease_token = p_lease_token
  returning * into saved_outcome;

  if saved_outcome.setup_id is null then
    raise exception using errcode = '40001', message = 'AI setup outcome lease was lost';
  end if;

  return saved_outcome;
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'Outcome reconciliation payload contains an invalid typed value';
end;
$$;

alter table public.ai_futures_configs enable row level security;
alter table public.ai_futures_config_audit enable row level security;
alter table public.ai_risk_profiles enable row level security;
alter table public.ai_market_snapshots enable row level security;
alter table public.ai_market_setups enable row level security;
alter table public.ai_analysis_requests enable row level security;
alter table public.ai_rate_limit_buckets enable row level security;
alter table public.ai_user_trade_plans enable row level security;
alter table public.ai_setup_outcomes enable row level security;
alter table public.ai_setup_outcome_events enable row level security;
alter table public.ai_pipeline_runs enable row level security;
alter table public.ai_provider_events enable row level security;
alter table public.ai_model_usage_logs enable row level security;
alter table public.ai_setup_admin_notes enable row level security;

drop policy if exists "ai_risk_profiles_owner_select" on public.ai_risk_profiles;
create policy "ai_risk_profiles_owner_select"
on public.ai_risk_profiles for select
using (user_id = auth.uid() and public.has_premium_access());

drop policy if exists "ai_risk_profiles_owner_insert" on public.ai_risk_profiles;
create policy "ai_risk_profiles_owner_insert"
on public.ai_risk_profiles for insert
with check (user_id = auth.uid() and public.has_premium_access());

drop policy if exists "ai_risk_profiles_owner_update" on public.ai_risk_profiles;
create policy "ai_risk_profiles_owner_update"
on public.ai_risk_profiles for update
using (user_id = auth.uid() and public.has_premium_access())
with check (user_id = auth.uid() and public.has_premium_access());

drop policy if exists "ai_risk_profiles_owner_delete" on public.ai_risk_profiles;
create policy "ai_risk_profiles_owner_delete"
on public.ai_risk_profiles for delete
using (user_id = auth.uid() and public.has_premium_access());

drop policy if exists "ai_analysis_requests_owner_or_admin_select" on public.ai_analysis_requests;
create policy "ai_analysis_requests_owner_or_admin_select"
on public.ai_analysis_requests for select
using (
  public.is_admin()
  or (user_id = auth.uid() and public.has_premium_access())
);

drop policy if exists "ai_user_trade_plans_owner_or_admin_select" on public.ai_user_trade_plans;
create policy "ai_user_trade_plans_owner_or_admin_select"
on public.ai_user_trade_plans for select
using (
  public.is_admin()
  or (user_id = auth.uid() and public.has_premium_access())
);

drop policy if exists "ai_futures_configs_admin_select" on public.ai_futures_configs;
create policy "ai_futures_configs_admin_select"
on public.ai_futures_configs for select
using (public.is_admin());

drop policy if exists "ai_futures_config_audit_admin_select" on public.ai_futures_config_audit;
create policy "ai_futures_config_audit_admin_select"
on public.ai_futures_config_audit for select
using (public.is_admin());

drop policy if exists "ai_market_snapshots_admin_select" on public.ai_market_snapshots;
create policy "ai_market_snapshots_admin_select"
on public.ai_market_snapshots for select
using (public.is_admin());

drop policy if exists "ai_market_setups_admin_select" on public.ai_market_setups;
create policy "ai_market_setups_admin_select"
on public.ai_market_setups for select
using (public.is_admin());

drop policy if exists "ai_rate_limit_buckets_admin_select" on public.ai_rate_limit_buckets;
create policy "ai_rate_limit_buckets_admin_select"
on public.ai_rate_limit_buckets for select
using (public.is_admin());

drop policy if exists "ai_setup_outcomes_admin_select" on public.ai_setup_outcomes;
create policy "ai_setup_outcomes_admin_select"
on public.ai_setup_outcomes for select
using (public.is_admin());

drop policy if exists "ai_setup_outcome_events_admin_select" on public.ai_setup_outcome_events;
create policy "ai_setup_outcome_events_admin_select"
on public.ai_setup_outcome_events for select
using (public.is_admin());

drop policy if exists "ai_pipeline_runs_admin_select" on public.ai_pipeline_runs;
create policy "ai_pipeline_runs_admin_select"
on public.ai_pipeline_runs for select
using (public.is_admin());

drop policy if exists "ai_provider_events_admin_select" on public.ai_provider_events;
create policy "ai_provider_events_admin_select"
on public.ai_provider_events for select
using (public.is_admin());

drop policy if exists "ai_model_usage_logs_admin_select" on public.ai_model_usage_logs;
create policy "ai_model_usage_logs_admin_select"
on public.ai_model_usage_logs for select
using (public.is_admin());

drop policy if exists "ai_setup_admin_notes_admin_select" on public.ai_setup_admin_notes;
create policy "ai_setup_admin_notes_admin_select"
on public.ai_setup_admin_notes for select
using (public.is_admin());

drop policy if exists "ai_setup_admin_notes_admin_insert" on public.ai_setup_admin_notes;
create policy "ai_setup_admin_notes_admin_insert"
on public.ai_setup_admin_notes for insert
with check (public.is_admin() and created_by = auth.uid());

revoke all on table public.ai_futures_configs from anon, authenticated;
revoke all on table public.ai_futures_config_audit from anon, authenticated;
revoke all on table public.ai_risk_profiles from anon, authenticated;
revoke all on table public.ai_market_snapshots from anon, authenticated;
revoke all on table public.ai_market_setups from anon, authenticated;
revoke all on table public.ai_analysis_requests from anon, authenticated;
revoke all on table public.ai_rate_limit_buckets from anon, authenticated;
revoke all on table public.ai_user_trade_plans from anon, authenticated;
revoke all on table public.ai_setup_outcomes from anon, authenticated;
revoke all on table public.ai_setup_outcome_events from anon, authenticated;
revoke all on table public.ai_pipeline_runs from anon, authenticated;
revoke all on table public.ai_provider_events from anon, authenticated;
revoke all on table public.ai_model_usage_logs from anon, authenticated;
revoke all on table public.ai_setup_admin_notes from anon, authenticated;

grant select, insert, update, delete on table public.ai_risk_profiles to authenticated;
grant select on table public.ai_analysis_requests, public.ai_user_trade_plans to authenticated;
grant select on table
  public.ai_futures_configs,
  public.ai_futures_config_audit,
  public.ai_market_snapshots,
  public.ai_market_setups,
  public.ai_rate_limit_buckets,
  public.ai_setup_outcomes,
  public.ai_setup_outcome_events,
  public.ai_pipeline_runs,
  public.ai_provider_events,
  public.ai_model_usage_logs,
  public.ai_setup_admin_notes
to authenticated;
grant insert on table public.ai_setup_admin_notes to authenticated;

grant usage on schema public to service_role;
grant select on table public.ai_futures_configs, public.ai_futures_config_audit to service_role;
grant select, insert, update on table public.ai_risk_profiles to service_role;
grant select, insert on table public.ai_market_snapshots to service_role;
grant select, insert, update on table public.ai_market_setups to service_role;
grant select, insert, update on table public.ai_analysis_requests to service_role;
grant select, insert, update, delete on table public.ai_rate_limit_buckets to service_role;
grant select, insert on table public.ai_user_trade_plans to service_role;
grant select, insert, update on table public.ai_setup_outcomes to service_role;
grant select, insert on table public.ai_setup_outcome_events to service_role;
grant select, insert, update on table public.ai_pipeline_runs to service_role;
grant select, insert on table public.ai_provider_events, public.ai_model_usage_logs to service_role;
grant select on table public.ai_setup_admin_notes to service_role;

grant usage, select on sequence public.ai_futures_configs_version_seq to service_role;
grant usage, select on sequence public.ai_futures_config_audit_id_seq to service_role;
grant usage, select on sequence public.ai_provider_events_id_seq to service_role;
grant usage, select on sequence public.ai_model_usage_logs_id_seq to service_role;

revoke execute on function public.ai_futures_validate_symbols(text[]) from public, anon, authenticated;
revoke execute on function public.ai_futures_validate_score_weights(jsonb) from public, anon, authenticated;
revoke execute on function public.ai_futures_validate_take_profits(jsonb, text, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.ai_futures_validate_provider_settings(jsonb) from public, anon, authenticated;
revoke execute on function public.ai_futures_reject_immutable_change() from public, anon, authenticated;
revoke execute on function public.ai_futures_protect_setup_history() from public, anon, authenticated;
revoke execute on function public.ai_futures_protect_outcome_transition() from public, anon, authenticated;
revoke execute on function public.ai_futures_validate_outcome_event_time() from public, anon, authenticated;
revoke execute on function public.ai_futures_log_config_creation() from public, anon, authenticated;
revoke execute on function public.ai_futures_user_has_academy_access(uuid) from public, anon, authenticated;
revoke execute on function public.admin_create_ai_futures_config(
  boolean, boolean, boolean, boolean, boolean, text[], jsonb,
  numeric, numeric, numeric, numeric, integer, numeric,
  integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer,
  text, text, text, text, jsonb, text
) from public, anon;
revoke execute on function public.claim_ai_futures_analysis_request(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_ai_futures_setup_generation(uuid, uuid, text, text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.renew_ai_futures_setup_generation_lease(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.complete_ai_futures_setup_generation(uuid, uuid, text, text, numeric, numeric, numeric, jsonb, numeric, numeric, jsonb, numeric, text, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.fail_ai_futures_setup_generation(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.claim_ai_setup_outcomes_for_reconciliation(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.save_ai_setup_outcome_reconciliation(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.admin_create_ai_futures_config(
  boolean, boolean, boolean, boolean, boolean, text[], jsonb,
  numeric, numeric, numeric, numeric, integer, numeric,
  integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer,
  text, text, text, text, jsonb, text
) to authenticated;
grant execute on function public.ai_futures_user_has_academy_access(uuid) to service_role;
grant execute on function public.ai_futures_validate_symbols(text[]) to service_role;
grant execute on function public.ai_futures_validate_score_weights(jsonb) to service_role;
grant execute on function public.ai_futures_validate_take_profits(jsonb, text, numeric, numeric) to service_role;
grant execute on function public.ai_futures_validate_provider_settings(jsonb) to service_role;
grant execute on function public.claim_ai_futures_analysis_request(uuid, text, jsonb) to service_role;
grant execute on function public.claim_ai_futures_setup_generation(uuid, uuid, text, text, text, text, integer) to service_role;
grant execute on function public.renew_ai_futures_setup_generation_lease(uuid, uuid, integer) to service_role;
grant execute on function public.complete_ai_futures_setup_generation(uuid, uuid, text, text, numeric, numeric, numeric, jsonb, numeric, numeric, jsonb, numeric, text, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.fail_ai_futures_setup_generation(uuid, uuid, text, text) to service_role;
grant execute on function public.claim_ai_setup_outcomes_for_reconciliation(text, integer, integer) to service_role;
grant execute on function public.save_ai_setup_outcome_reconciliation(uuid, uuid, jsonb, jsonb) to service_role;

comment on table public.ai_market_snapshots is
  'Trusted Binance USD-M market snapshots. Regular users must receive filtered analysis through an authorized Edge Function.';
comment on table public.ai_market_setups is
  'Immutable historical AI Futures predictions after generation completes. Corrections belong in ai_setup_admin_notes.';
comment on table public.ai_pipeline_runs is
  'Operational log for on-demand and scheduled AI Futures processing. Cron is installed only when named Vault secrets exist.';

do $$
begin
  execute 'create extension if not exists pg_cron';
exception
  when others then
    raise notice 'pg_cron is unavailable; AI Futures jobs must be scheduled manually: %', sqlerrm;
end;
$$;

do $$
begin
  execute 'create extension if not exists pg_net';
exception
  when others then
    raise notice 'pg_net is unavailable; AI Futures jobs must be scheduled manually: %', sqlerrm;
end;
$$;

-- Safe scheduler bootstrap. The stored cron commands contain only Vault secret
-- names, never decrypted URLs, cron secrets, or SERVICE_ROLE_KEY. Store these
-- three Vault entries before applying/re-running this block:
--   ai_futures_market_pipeline_url
--   ai_futures_outcome_reconcile_url
--   ai_futures_cron_secret
-- The two Edge Functions must validate x-ai-cron-secret and be deployed with
-- gateway JWT verification disabled for these server-only cron endpoints.
do $ai_futures_schedule$
declare
  vault_is_ready boolean := false;
  market_job text := $market_job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'ai_futures_market_pipeline_url'
        limit 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ai-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'ai_futures_cron_secret'
          limit 1
        )
      ),
      body := '{"scope":"closed-candle"}'::jsonb,
      timeout_milliseconds := 8000
    );
  $market_job$;
  outcome_job text := $outcome_job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'ai_futures_outcome_reconcile_url'
        limit 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ai-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'ai_futures_cron_secret'
          limit 1
        )
      ),
      body := '{"scope":"active-setups"}'::jsonb,
      timeout_milliseconds := 8000
    );
  $outcome_job$;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
    or to_regclass('vault.decrypted_secrets') is null
  then
    raise notice 'AI Futures cron was not scheduled: pg_cron, pg_net, or Vault is unavailable.';
    return;
  end if;

  execute $vault_check$
    select count(distinct name) = 3
    from vault.decrypted_secrets
    where name in (
      'ai_futures_market_pipeline_url',
      'ai_futures_outcome_reconcile_url',
      'ai_futures_cron_secret'
    )
      and nullif(decrypted_secret, '') is not null
  $vault_check$
  into vault_is_ready;

  if not vault_is_ready then
    raise notice 'AI Futures cron placeholders are ready but were not scheduled because required Vault secrets are missing.';
    return;
  end if;

  begin
    execute format('select cron.unschedule(%L)', 'ai-futures-market-pipeline-every-minute');
  exception
    when others then
      null;
  end;

  begin
    execute format('select cron.unschedule(%L)', 'ai-futures-outcome-reconcile-every-minute');
  exception
    when others then
      null;
  end;

  execute format(
    'select cron.schedule(%L, %L, %L)',
    'ai-futures-market-pipeline-every-minute',
    '* * * * *',
    market_job
  );

  execute format(
    'select cron.schedule(%L, %L, %L)',
    'ai-futures-outcome-reconcile-every-minute',
    '* * * * *',
    outcome_job
  );
exception
  when others then
    raise notice 'AI Futures cron was not scheduled automatically: %', sqlerrm;
end;
$ai_futures_schedule$;

notify pgrst, 'reload schema';
