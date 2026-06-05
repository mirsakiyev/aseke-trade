import { useEffect, useState } from "react";

type TickerState = {
  price: number | null;
  changePercent: number | null;
  isLoading: boolean;
  hasError: boolean;
};

const tickerEndpoints = [
  "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
  "https://api.binance.us/api/v3/ticker/24hr?symbol=BTCUSDT"
];

export function BtcTicker() {
  const [ticker, setTicker] = useState<TickerState>({
    price: null,
    changePercent: null,
    isLoading: true,
    hasError: false
  });

  useEffect(() => {
    let mounted = true;
    let activeController: AbortController | null = null;

    const loadTicker = async () => {
      activeController?.abort();
      activeController = new AbortController();

      try {
        const result = await fetchTicker(activeController.signal);

        if (!mounted) {
          return;
        }

        setTicker({
          price: result.price,
          changePercent: result.changePercent,
          isLoading: false,
          hasError: false
        });
      } catch {
        if (!mounted) {
          return;
        }

        setTicker((current) => ({
          ...current,
          isLoading: false,
          hasError: true
        }));
      }
    };

    void loadTicker();
    const timer = window.setInterval(() => {
      void loadTicker();
    }, 30_000);

    return () => {
      mounted = false;
      activeController?.abort();
      window.clearInterval(timer);
    };
  }, []);

  const priceLabel = ticker.price ? formatTickerPrice(ticker.price) : ticker.isLoading ? "Loading" : "Unavailable";
  const changeLabel = ticker.changePercent === null ? "--" : `${ticker.changePercent >= 0 ? "+" : ""}${ticker.changePercent.toFixed(2)}%`;
  const tone = ticker.changePercent === null ? "" : ticker.changePercent >= 0 ? "positive" : "negative";

  return (
    <div className="btc-ticker" aria-label="Live BTC USDT price ticker">
      <span className="btc-ticker-pair">BTC/USDT</span>
      <strong>{priceLabel}</strong>
      <span className={`btc-ticker-change ${tone}`}>{changeLabel}</span>
      {ticker.hasError && <span className="sr-only">Live price temporarily unavailable</span>}
    </div>
  );
}

async function fetchTicker(signal: AbortSignal) {
  let lastError: unknown;

  for (const endpoint of tickerEndpoints) {
    try {
      const response = await fetch(endpoint, { signal });

      if (!response.ok) {
        throw new Error(`Ticker request failed with ${response.status}`);
      }

      const data = (await response.json()) as {
        lastPrice?: unknown;
        priceChangePercent?: unknown;
      };
      const price = Number(data.lastPrice);
      const changePercent = Number(data.priceChangePercent);

      if (!Number.isFinite(price)) {
        throw new Error("Ticker response missing price");
      }

      return {
        price,
        changePercent: Number.isFinite(changePercent) ? changePercent : null
      };
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }

      lastError = error;
    }
  }

  throw lastError;
}

function formatTickerPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}
