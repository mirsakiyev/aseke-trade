import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";

type TradingViewChartProps = {
  symbol: string;
  title: string;
  ticker: string;
  height?: number;
  interval?: "D" | "240" | "60";
};

const tradingViewScriptUrl = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

export function TradingViewChart({
  symbol,
  title,
  ticker,
  height = 560,
  interval = "D"
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hasScriptError, setHasScriptError] = useState(false);
  const reactId = useId();
  const containerId = useMemo(
    () => `tradingview-${symbol.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [reactId, symbol]
  );

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    let mounted = true;
    setHasScriptError(false);
    container.replaceChildren();

    const widgetContainer = document.createElement("div");
    widgetContainer.id = containerId;
    widgetContainer.className = "tradingview-widget-container__widget";
    widgetContainer.style.width = "100%";
    widgetContainer.style.height = "100%";

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = tradingViewScriptUrl;
    script.textContent = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      enable_publishing: false,
      backgroundColor: "rgba(5, 6, 7, 1)",
      gridColor: "rgba(255, 255, 255, 0.08)",
      hide_top_toolbar: false,
      hide_legend: false,
      hide_side_toolbar: false,
      save_image: false,
      allow_symbol_change: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
      container_id: containerId
    });
    script.onerror = () => {
      if (mounted) {
        setHasScriptError(true);
      }
    };

    container.append(widgetContainer, script);

    return () => {
      mounted = false;
      container.replaceChildren();
    };
  }, [containerId, interval, symbol]);

  return (
    <article className="chart-card">
      <div className="chart-card-heading">
        <div>
          <h2>{title}</h2>
          <span>{ticker}</span>
        </div>
        <a
          href={`https://www.tradingview.com/symbols/${symbol.replace(":", "-")}/`}
          rel="noopener nofollow"
          target="_blank"
        >
          TradingView
        </a>
      </div>

      <div className="chart-widget-shell" style={{ "--chart-height": `${height}px` } as CSSProperties}>
        <div className="chart-widget-loader">
          <span>Loading chart</span>
        </div>
        <div ref={containerRef} className="tradingview-widget-container chart-widget-host" />
        {hasScriptError && (
          <div className="chart-widget-error">
            <strong>Chart could not load.</strong>
            <span>Open {ticker} directly on TradingView or refresh this page.</span>
          </div>
        )}
      </div>
    </article>
  );
}
