import { ArrowRight, BarChart3 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { TradingViewChart } from "../components/TradingViewChart";

const chartAssets = [
  { title: "Bitcoin", ticker: "BTC/USDT", symbol: "BINANCE:BTCUSDT" },
  { title: "Ethereum", ticker: "ETH/USDT", symbol: "BINANCE:ETHUSDT" },
  { title: "BNB", ticker: "BNB/USDT", symbol: "BINANCE:BNBUSDT" },
  { title: "Solana", ticker: "SOL/USDT", symbol: "BINANCE:SOLUSDT" },
  { title: "XRP", ticker: "XRP/USDT", symbol: "BINANCE:XRPUSDT" },
  { title: "Cardano", ticker: "ADA/USDT", symbol: "BINANCE:ADAUSDT" }
];

export function Charts() {
  const [selectedAsset, setSelectedAsset] = useState(chartAssets[0]);

  return (
    <main className="page page-stack charts-page">
      <section className="page-title-row charts-title-row">
        <div>
          <p className="eyebrow">Market Charts</p>
          <h1>Live Crypto Charts</h1>
          <p>
            Track Bitcoin and major crypto assets in real time with live TradingView market charts.
          </p>
        </div>
        <span className="charts-title-mark" aria-hidden="true">
          <BarChart3 size={34} />
        </span>
      </section>

      <section className="chart-selector-panel" aria-label="Choose chart asset">
        <div>
          <p className="eyebrow">Select Market</p>
          <h2>{selectedAsset.title} chart</h2>
        </div>
        <div className="chart-selector" role="tablist" aria-label="Cryptocurrency chart selector">
          {chartAssets.map((asset) => (
            <button
              className={asset.symbol === selectedAsset.symbol ? "filter-pill active" : "filter-pill"}
              type="button"
              onClick={() => setSelectedAsset(asset)}
              aria-selected={asset.symbol === selectedAsset.symbol}
              role="tab"
              key={asset.symbol}
            >
              {asset.ticker}
            </button>
          ))}
        </div>
      </section>

      <section className="charts-single-grid" aria-label="Live crypto TradingView chart">
        <TradingViewChart
          symbol={selectedAsset.symbol}
          title={selectedAsset.title}
          ticker={selectedAsset.ticker}
          height={620}
          key={selectedAsset.symbol}
        />
      </section>

      <p className="soft-notice">
        Charts are provided for educational purposes only and are not financial advice.
      </p>

      <section className="charts-learning-cta">
        <div>
          <p className="eyebrow">Chart Education</p>
          <h2>Want to understand what you are seeing?</h2>
          <p>Start learning crypto strategy with ASEKE TRADE guides.</p>
        </div>
        <Link className="primary-button" to="/guides">
          Open guides
          <ArrowRight size={18} />
        </Link>
      </section>
    </main>
  );
}
