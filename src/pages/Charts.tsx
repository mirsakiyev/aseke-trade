import {
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  Gauge,
  RefreshCw,
  Scale,
  Search,
  TrendingUp
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
import { fetchMarketIndices } from "../lib/marketIndices";
import {
  classifyVolatilityRisk,
  createUnavailableMarketIndices,
  binanceLongShortUnavailableMessage,
  formatIndexTimestamp,
  getFearGreedBand,
  type FearGreedIndex,
  type LongShortIndex,
  type MarketIndicesResponse,
  type VolatilityIndex
} from "../lib/marketIndexMath";

export function Charts() {
  const [selectedAsset, setSelectedAsset] = useState<ChartAsset>(coreChartAssets[0]);
  const [coins, setCoins] = useState<CryptoMarketCoin[]>([]);
  const [coinSearch, setCoinSearch] = useState("");
  const [isLoadingCoins, setIsLoadingCoins] = useState(true);
  const [coinError, setCoinError] = useState<string | null>(null);
  const [marketIndices, setMarketIndices] = useState<MarketIndicesResponse | null>(null);
  const [isLoadingMarketIndices, setIsLoadingMarketIndices] = useState(true);
  const hasLoadedMarketIndices = useRef(false);

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

  useEffect(() => {
    let isMounted = true;

    async function loadMarketIndices() {
      const isInitialLoad = !hasLoadedMarketIndices.current;
      setIsLoadingMarketIndices(isInitialLoad);

      try {
        const nextMarketIndices = await fetchMarketIndices();
        if (isMounted) {
          setMarketIndices(nextMarketIndices);
          hasLoadedMarketIndices.current = true;
        }
      } catch (error) {
        if (isMounted) {
          const fallback = createUnavailableMarketIndices(
            error instanceof Error ? error.message : "Market index data unavailable."
          );
          setMarketIndices(fallback);
        }
      } finally {
        if (isMounted) {
          setIsLoadingMarketIndices(false);
        }
      }
    }

    void loadMarketIndices();

    return () => {
      isMounted = false;
    };
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

      <section className="chart-market-toolbar" aria-label="Select crypto market">
        <div className="chart-market-current">
          <span>Select Market</span>
          <strong>{selectedAsset.ticker}</strong>
          <small>{selectedAsset.title}</small>
        </div>

        <div className="chart-market-actions">
          <details className="coin-picker">
            <summary className="hover-chart-trigger">Select Crypto</summary>
            <div className="coin-search-panel">
              <label className="coin-search-label">
                <Search size={17} aria-hidden="true" />
                <span className="sr-only">Search crypto markets</span>
                <input
                  value={coinSearch}
                  onChange={(event) => setCoinSearch(event.target.value)}
                  placeholder="Search crypto markets"
                  aria-controls="coin-search-results"
                />
              </label>

              <div className="coin-search-meta">
                <span>Sorted by market cap</span>
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

      <MarketSentimentSection
        indices={marketIndices}
        isLoading={isLoadingMarketIndices}
      />

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

function MarketSentimentSection({
  indices,
  isLoading
}: {
  indices: MarketIndicesResponse | null;
  isLoading: boolean;
}) {
  const data = indices ?? createUnavailableMarketIndices();

  return (
    <section className="market-indices-section" aria-labelledby="market-indices-title">
      <div className="market-indices-heading">
        <div>
          <p className="eyebrow">Market Indices</p>
          <h2 id="market-indices-title">Market Sentiment & Risk</h2>
          <p>Live crypto sentiment, positioning, and volatility indicators.</p>
        </div>
      </div>

      <div className="market-index-grid">
        {isLoading ? (
          <>
            <MarketIndexSkeleton title="Crypto Fear & Greed Index" />
            <MarketIndexSkeleton title="Longs vs Shorts Futures" />
            <MarketIndexSkeleton title="Crypto Market Volatility Index" />
          </>
        ) : (
          <>
            <FearGreedCard data={data.fearGreed} />
            <LongShortCard data={data.longShort} />
            <VolatilityCard data={data.volatility} />
          </>
        )}
      </div>
    </section>
  );
}

function MarketIndexSkeleton({ title }: { title: string }) {
  return (
    <article className="market-index-card loading" aria-label={`${title} loading`} role="status">
      <div className="market-index-card-header">
        <span className="market-index-icon skeleton-block" aria-hidden="true" />
        <div>
          <span className="market-index-eyebrow skeleton-line short" />
          <h3>{title}</h3>
        </div>
      </div>
      <span className="skeleton-line score" />
      <span className="skeleton-line" />
      <span className="skeleton-line medium" />
    </article>
  );
}

function FearGreedCard({ data }: { data: FearGreedIndex }) {
  const band = getFearGreedBand(data.value);
  const score = data.value ?? 0;

  return (
    <article className={`market-index-card fear-greed-card ${band.className}`}>
      <MarketIndexCardHeader
        eyebrow="Sentiment"
        icon={<Gauge size={18} />}
        meta="0-100 score"
        title="Crypto Fear & Greed Index"
      />

      {data.status === "ready" && data.value !== null ? (
        <>
          <div className="market-index-score-row">
            <strong>{data.value}</strong>
            <span>/100</span>
          </div>
          <span className={`market-index-pill ${band.className}`}>{data.classification || band.label}</span>
          <div
            className="fear-greed-scale"
            role="meter"
            aria-label={`Fear and Greed score ${data.value} out of 100, ${data.classification || band.label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={data.value}
            style={{ "--fear-score": `${score}%` } as CSSProperties}
          >
            <span className="fear-greed-marker" />
          </div>
          <div className="fear-greed-scale-labels" aria-hidden="true">
            <span>Fear</span>
            <span>Neutral</span>
            <span>Greed</span>
          </div>
        </>
      ) : (
        <MarketIndexEmpty title="Fear & Greed data unavailable" note={data.error} />
      )}

      <MarketIndexFooter source={`Source: ${data.source}`} timestamp={data.timestamp} />
    </article>
  );
}

function LongShortCard({ data }: { data: LongShortIndex }) {
  const longPct = data.longPct ?? 0;
  const shortPct = data.shortPct ?? 0;
  const isReady = data.status === "ready" && data.longPct !== null && data.shortPct !== null;

  return (
    <article className="market-index-card long-short-card">
      <div className="market-index-card-header long-short-card-header">
        <span className="market-index-icon" aria-hidden="true">
          <Scale size={18} />
        </span>
        <div>
          <span className="market-index-eyebrow">Positioning</span>
          <h3>Longs vs Shorts Futures</h3>
        </div>
      </div>

      {isReady ? (
        <>
          <div className="market-index-score-row compact">
            <strong>{Math.round(longPct)}% Longs</strong>
            <span>/ {Math.round(shortPct)}% Shorts</span>
          </div>
          <div
            className="long-short-split"
            aria-label={`${Math.round(longPct)} percent longs and ${Math.round(shortPct)} percent shorts`}
            role="img"
            style={{ "--long-pct": `${longPct}%` } as CSSProperties}
          >
            <span className="long-side" />
            <span className="short-side" />
          </div>
          <div className="long-short-labels">
            <span>Longs</span>
            <span>Shorts</span>
          </div>
          <p className="market-index-detail">BTCUSDT 5m account ratio</p>
        </>
      ) : (
        <MarketIndexEmpty
          title="Long/short data unavailable"
          note={data.error ?? binanceLongShortUnavailableMessage}
        />
      )}

      <MarketIndexFooter
        source="Source: Binance public futures data"
        timestamp={data.timestamp}
      />
    </article>
  );
}

function VolatilityCard({ data }: { data: VolatilityIndex }) {
  const risk = classifyVolatilityRisk(data.value);
  const gaugeValue = Math.min(100, Math.max(0, ((data.value ?? 0) / 120) * 100));
  const trendLabel = data.changePct === null
    ? "Trend unavailable"
    : data.changePct > 0.15
      ? `Up ${Math.abs(data.changePct).toFixed(2)}%`
      : data.changePct < -0.15
        ? `Down ${Math.abs(data.changePct).toFixed(2)}%`
        : "Flat";

  return (
    <article className={`market-index-card volatility-card ${risk.className}`}>
      <MarketIndexCardHeader
        eyebrow="Volatility"
        icon={<Activity size={18} />}
        meta={risk.label}
        title="Crypto Market Volatility Index"
      />

      {data.status === "ready" && data.value !== null ? (
        <>
          <div className="market-index-score-row">
            <strong>{data.value.toFixed(1)}</strong>
            <span>DVOL</span>
          </div>
          <span className={`market-index-pill ${risk.className}`}>{risk.label}</span>
          <div
            className="volatility-gauge"
            role="meter"
            aria-label={`Crypto volatility index ${data.value.toFixed(1)}, ${risk.label}`}
            aria-valuemin={0}
            aria-valuemax={120}
            aria-valuenow={Math.round(data.value)}
            style={{ "--volatility-score": `${gaugeValue}%` } as CSSProperties}
          >
            <span className="volatility-marker" />
          </div>
          <div className="market-index-statline">
            <span>{data.basis}</span>
            <strong>
              <TrendingUp size={14} aria-hidden="true" />
              {trendLabel}
            </strong>
          </div>
        </>
      ) : (
        <MarketIndexEmpty title="Volatility data unavailable" note={data.error} />
      )}

      <MarketIndexFooter source={`Source: ${data.source}`} timestamp={data.timestamp} />
    </article>
  );
}

function MarketIndexCardHeader({
  eyebrow,
  icon,
  meta,
  title
}: {
  eyebrow: string;
  icon: ReactNode;
  meta: string;
  title: string;
}) {
  return (
    <div className="market-index-card-header">
      <span className="market-index-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <span className="market-index-eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
      </div>
      <span className="market-index-meta">{meta}</span>
    </div>
  );
}

function MarketIndexEmpty({ title, note }: { title: string; note?: string }) {
  return (
    <div className="market-index-empty">
      <AlertCircle size={18} aria-hidden="true" />
      <strong>{title}</strong>
      {note && <span>{note}</span>}
    </div>
  );
}

function MarketIndexFooter({ source, timestamp }: { source: string; timestamp: string | null }) {
  return (
    <div className="market-index-footer">
      <span>{source}</span>
      <span>Updated {formatIndexTimestamp(timestamp)}</span>
    </div>
  );
}
