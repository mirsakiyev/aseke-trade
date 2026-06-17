# Demo Trade

Demo Trade is an ASEKE TRADE practice simulator for BTC/USDT. It uses virtual funds only and does not place real trades, connect to broker accounts, or imply profit.

## Data Source

The v1 market data provider lives in `src/lib/demoTradeMarketData.ts`. It tries public Binance.US REST endpoints first for BTC/USDT ticker and candles, then falls back to Binance global public market data and Coinbase public BTC/USD data. The browser also keeps a short-lived last-good cache so a temporary upstream outage does not leave returning users with an empty chart.

## Calculation Model

The calculation engine lives in `src/lib/demoTradeMath.ts`. It uses a fixed-scale `BigInt` decimal helper internally for balances, margin, PnL, percentages, and liquidation calculations.

V1 supports:

- BTC/USDT only
- One open position at a time
- Isolated margin
- Long and short market entries
- Leverage from 1x to 100x
- Stop loss, multiple take profits, manual close, partial TP close, and liquidation
- Configurable fee rate and maintenance margin rate, with fees defaulting to 0

Liquidation uses the ASEKE TRADE demo isolated-margin formula documented in the engine. Real exchanges may include maintenance tiers, funding, fees, insurance rules, and mark-price protections that are intentionally outside this educational v1 model.

## Persistence

Guest users are stored in `sessionStorage` for the active browser session only. The page shows a note encouraging guests to create an account if they want permanent progress.

Registered users are saved to Supabase in `public.demo_trade_states` through `save_demo_trade_state`. The migration adds row-level security so users can access only their own demo state and validates the stored state shape server-side before saving.

## Known V1 Limitations

- BTC/USDT is the only supported symbol.
- Only one open position is allowed at a time.
- Market entry is supported; limit orders are not included.
- The chart is a custom SVG candlestick chart with app-controlled overlays. It is not a TradingView widget.
- Server-side validation checks state integrity, but the browser still owns the interactive simulator flow for v1.
