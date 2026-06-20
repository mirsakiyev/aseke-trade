# Trading Signals

Trading Signals are ASEKE TRADE Admin-posted market calls stored in `public.trading_signals`.

## Current Lifecycle

The current signal model supports these statuses:

- `active`
- `hit_tp`
- `hit_sl`
- `manually_closed`

Signals do not have a separate pending-entry state today. Admin-created market signals are active immediately, and `created_at` acts as the opening timestamp for backend reconciliation.

Take profits live in the `take_profits` JSON array. Each target stores:

- `id`
- `price`
- `positionSizePercent`
- `isHit`
- `hitAt`

Manual admin updates still work from `src/pages/AdminTradingAcademy.tsx`. The backend automation uses the same status names, TP hit flags, close fields, ROI helper, and update timeline shape.

## Backend Automation

The `trading-signal-reconcile` Supabase Edge Function runs server-side and is intended to be called by Supabase Cron every minute with:

```json
{ "scope": "all" }
```

The function:

- requires `Authorization: Bearer SERVICE_ROLE_KEY`
- loads `active` and `is_active = true` trading signals
- maps common crypto pair formats such as `BTC/USDT`, `BTCUSDT`, and `BTC/USD` to Binance-compatible `BTCUSDT`
- fetches completed one-minute candles from Binance.US first, then Binance global
- checks candles from `last_checked_at` or `created_at` through the last completed minute
- marks long TPs when candle high reaches the TP and long SL when candle low reaches SL
- marks short TPs when candle low reaches the TP and short SL when candle high reaches SL
- preserves partial TP history if TP1/TP2 hit before a later SL
- writes through `save_reconciled_trading_signal`, which locks the signal row before saving
- updates `last_checked_at`, `last_auto_update_price`, and `last_auto_update_source`

If a TP and SL are both inside the same one-minute candle and the exact tick sequence is unknown, SL wins over newly hit TPs for that candle. This is conservative and deterministic.

The migration also updates `notify_trading_signal_change()` so automated updates use the existing premium inbox notification path. When multiple TP updates are appended in one save, the trigger creates one notification per new timeline item.

## Production Setup

1. Push database migrations:

   ```bash
   npx supabase@latest db push
   ```

2. Deploy the Edge Function:

   ```bash
   npx supabase@latest functions deploy trading-signal-reconcile
   ```

3. Make sure the function has a service-role secret:

   ```bash
   npx supabase@latest secrets set SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
   ```

4. Create a Supabase Cron job:

   - Type: Supabase Edge Function
   - Function: `trading-signal-reconcile`
   - Method: `POST`
   - Schedule: `* * * * *`
   - Timeout: `5000 ms`
   - Header name: `Authorization`
   - Header value: `Bearer YOUR_SERVICE_ROLE_KEY`
   - Add another header: `Content-Type` = `application/json`
   - Body:

     ```json
     {
       "scope": "all"
     }
     ```

5. Test it manually:

   ```bash
   curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/trading-signal-reconcile" \
     -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"scope":"all"}'
   ```

6. Confirm Cron is running:

   ```sql
   select jobid, jobname, schedule, active
   from cron.job
   where jobname ilike '%trading-signal%';

   select jobid, status, return_message, start_time, end_time
   from cron.job_run_details
   where jobid in (
     select jobid from cron.job where jobname ilike '%trading-signal%'
   )
   order by start_time desc
   limit 10;
   ```

The migration can also auto-schedule the job if these database settings exist before the migration runs:

```sql
alter database postgres set app.settings.trading_signal_reconcile_url = 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/trading-signal-reconcile';
alter database postgres set app.settings.trading_signal_reconcile_token = 'YOUR_SERVICE_ROLE_KEY';
```

If Supabase blocks setting custom database parameters, use the dashboard Cron setup above.

## Configuration

Optional Edge Function environment variables:

- `TRADING_SIGNAL_RECONCILE_LIMIT`: active signals processed per run, default `200`
- `TRADING_SIGNAL_MAX_CANDLES`: max one-minute candles fetched per signal per run, default `60000`

Required Edge Function environment variables:

- `SUPABASE_URL`
- `SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`

## Limitations

- Pending-entry signals are not implemented in the current data model.
- Binance-compatible crypto spot symbols are supported. Forex, stocks, indices, and symbols unavailable on Binance are skipped instead of guessed.
- One-minute candle data cannot prove exact intraminute order when TP and SL are both touched.
- The Cron timeout is five seconds in Supabase Dashboard; if there are many stale active signals, reduce batch size or process older backlogs over multiple runs.
