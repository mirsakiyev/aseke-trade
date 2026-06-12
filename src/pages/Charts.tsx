import { AlertCircle, ArrowRight, BarChart3, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TradingViewChart } from "../components/TradingViewChart";
import {
  chartAssetFromCoin,
  coreChartAssets,
  fetchTopCryptoCoins,
  filterCryptoCoins,
  type ChartAsset,
  type CryptoMarketCoin
} from "../lib/cryptoMarkets";

export function Charts() {
  const [selectedAsset, setSelectedAsset] = useState<ChartAsset>(coreChartAssets[0]);
  const [coins, setCoins] = useState<CryptoMarketCoin[]>([]);
  const [coinSearch, setCoinSearch] = useState("");
  const [isLoadingCoins, setIsLoadingCoins] = useState(true);
  const [coinError, setCoinError] = useState<string | null>(null);

  const loadCoinList = async () => {
    setIsLoadingCoins(true);
    setCoinError(null);

    try {
      const nextCoins = await fetchTopCryptoCoins();
      setCoins(nextCoins);
    } catch {
      setCoinError("Market list could not be loaded.");
    } finally {
      setIsLoadingCoins(false);
    }
  };

  useEffect(() => {
    void loadCoinList();
  }, []);

  const filteredCoins = useMemo(
    () => filterCryptoCoins(coins, coinSearch).slice(0, coinSearch.trim() ? 16 : 12),
    [coinSearch, coins]
  );

  const selectCoin = (coin: CryptoMarketCoin) => {
    setSelectedAsset(chartAssetFromCoin(coin));
    setCoinSearch(`${coin.name} (${coin.symbol})`);
  };

  return (
    <main className="page page-stack charts-page">
      <section className="page-title-row charts-title-row">
        <div>
          <p className="eyebrow">Market Charts</p>
          <h1>Live Crypto Charts</h1>
          <p>
            Track major crypto markets and study how price, volume, trend structure, and market behavior
            work together.
          </p>
        </div>
        <span className="charts-title-mark" aria-hidden="true">
          <BarChart3 size={34} />
        </span>
      </section>

      <section className="chart-market-toolbar" aria-label="Choose chart asset">
        <div className="chart-market-current">
          <span>Select Market</span>
          <strong>{selectedAsset.ticker}</strong>
          <small>{selectedAsset.title}</small>
        </div>

        <div className="chart-market-actions">
          <div className="chart-selector" role="tablist" aria-label="Core cryptocurrency chart selector">
            {coreChartAssets.map((asset) => (
              <button
                className={asset.id === selectedAsset.id ? "filter-pill active" : "filter-pill"}
                type="button"
                onClick={() => setSelectedAsset(asset)}
                aria-selected={asset.id === selectedAsset.id}
                role="tab"
                key={asset.id}
              >
                {asset.ticker}
              </button>
            ))}
          </div>

          <details className="coin-picker">
            <summary>Top 200</summary>
            <div className="coin-search-panel">
              <label className="coin-search-label">
                <Search size={17} aria-hidden="true" />
                <span className="sr-only">Search top crypto markets</span>
                <input
                  value={coinSearch}
                  onChange={(event) => setCoinSearch(event.target.value)}
                  placeholder="Search top 200 coins"
                  aria-controls="coin-search-results"
                />
              </label>

              <div className="coin-search-meta">
                <span>Top 200 by market cap</span>
                <button className="icon-button compact-icon-button" type="button" onClick={() => void loadCoinList()}>
                  <RefreshCw size={15} />
                  <span className="sr-only">Refresh market list</span>
                </button>
              </div>

              <div className="coin-search-results" id="coin-search-results" role="listbox">
                {isLoadingCoins ? (
                  <span className="coin-search-state">Loading markets...</span>
                ) : coinError ? (
                  <span className="coin-search-state error">
                    <AlertCircle size={15} />
                    {coinError}
                  </span>
                ) : filteredCoins.length ? (
                  filteredCoins.map((coin) => {
                    const asset = chartAssetFromCoin(coin);

                    return (
                      <button
                        className={asset.id === selectedAsset.id ? "coin-option active" : "coin-option"}
                        type="button"
                        onClick={() => selectCoin(coin)}
                        role="option"
                        aria-selected={asset.id === selectedAsset.id}
                        key={coin.id}
                      >
                        {coin.image && <img src={coin.image} alt="" aria-hidden="true" />}
                        <span>
                          <strong>{coin.name}</strong>
                          <small>
                            #{coin.rank} {coin.symbol}
                          </small>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <span className="coin-search-state">No matching markets.</span>
                )}
              </div>
            </div>
          </details>
        </div>
      </section>

      <section className="charts-single-grid" aria-label="Live crypto TradingView chart">
        <TradingViewChart
          symbol={selectedAsset.symbol}
          title={selectedAsset.title}
          ticker={selectedAsset.ticker}
          height={620}
          key={`${selectedAsset.id}-${selectedAsset.symbol}`}
        />
      </section>

      <p className="soft-notice">
        Charts are for education and market observation only. They are not financial advice.
      </p>

      <section className="charts-learning-cta">
        <div>
          <p className="eyebrow">Chart Education</p>
          <h2>Want to understand what you are seeing?</h2>
          <p>Study chart reading, risk management, and trading strategy with ASEKE TRADE education.</p>
        </div>
        <Link className="primary-button" to="/guides">
          Start Learning Free
          <ArrowRight size={18} />
        </Link>
      </section>
    </main>
  );
}
