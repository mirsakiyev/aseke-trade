export const TRADE_ROUTE_STARTING_BALANCE = 1000;
export const BASE_ROUTE_OPTIMIZER_XP = 100;
export const MAX_ROUTE_OPTIMIZER_XP_MULTIPLIER = 2;
export const PROFIT_MULTIPLIER_FACTOR = 10;

export const tradeRouteAssets = ["BTC", "ETH", "SOL"] as const;

export type Asset = (typeof tradeRouteAssets)[number];
export type RiskLabel = "Low" | "Medium" | "High";
export type RouteOptimizerXpOutcome = "profit" | "loss" | "breakeven";

export type ReferencePriceSource = "CoinGecko" | "CoinPaprika" | "CoinCap" | "fallback" | "last_known_good";

export type ReferenceAssetPrices = Record<
  Asset,
  {
    priceUSDT: number;
    source: ReferencePriceSource;
    lastUpdatedAt?: string;
  }
>;

export type Market = {
  id: string;
  name: string;
  tradingFeePercent: number;
  prices: Record<
    Asset,
    {
      buy: number;
      sell: number;
    }
  >;
};

export type TransferRoute = {
  id: string;
  name: string;
  networkFeeUSDT: number;
  slippagePercent: number;
  delayLabel: string;
  riskLabel: RiskLabel;
};

export type UserSelection = {
  asset: Asset;
  buyMarketId: string;
  sellMarketId: string;
  routeId: string;
};

export type RouteResult = {
  finalUSDT: number;
  profit: number;
  assetQuantity: number;
  buyFee: number;
  sellFee: number;
  networkFee: number;
  slippageCost: number;
  totalFees: number;
};

export type OptimalRoute = {
  selection: UserSelection;
  result: RouteResult;
};

export type TradeRoutePuzzle = {
  puzzleId: string;
  seed: string;
  dateKey: string;
  startingBalance: number;
  referencePrices: ReferenceAssetPrices;
  markets: Market[];
  routes: TransferRoute[];
  optimalRoute: OptimalRoute;
};

export type RouteOptimizerXpReward = {
  xpAwarded: number;
  outcome: RouteOptimizerXpOutcome;
  roundedProfit: number;
  multiplier: number;
};

type PuzzleCalculationInput = Pick<TradeRoutePuzzle, "markets" | "routes" | "startingBalance">;

const marketNames = ["NovaX", "Atlas Exchange", "OrbitSwap", "TradePort"] as const;

export const FALLBACK_REFERENCE_ASSET_PRICES_USDT: Record<Asset, number> = {
  BTC: 64000,
  ETH: 3200,
  SOL: 140
};

const assetGenerationRules: Record<Asset, { variation: number; maxDeviation: number; priceDecimals: number }> = {
  BTC: { variation: 0.025, maxDeviation: 0.03, priceDecimals: 2 },
  ETH: { variation: 0.025, maxDeviation: 0.03, priceDecimals: 2 },
  SOL: { variation: 0.03, maxDeviation: 0.04, priceDecimals: 3 }
};

export function getTradeRouteDateKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function createFallbackReferenceAssetPrices(lastUpdatedAt = new Date().toISOString()): ReferenceAssetPrices {
  return tradeRouteAssets.reduce((prices, asset) => {
    prices[asset] = {
      priceUSDT: FALLBACK_REFERENCE_ASSET_PRICES_USDT[asset],
      source: "fallback",
      lastUpdatedAt
    };
    return prices;
  }, {} as ReferenceAssetPrices);
}

export function generateTradeRoutePuzzle(
  date = new Date(),
  userId?: string | null,
  referencePrices: ReferenceAssetPrices = createFallbackReferenceAssetPrices()
): TradeRoutePuzzle {
  const dateKey = getTradeRouteDateKey(date);
  const seed = userId ? `${dateKey}-${userId}` : dateKey;
  const random = createSeededRandom(seed);
  const safeReferencePrices = normalizeReferenceAssetPrices(referencePrices);

  const markets = marketNames.map((name, index) => {
    const tradingFeePercent = roundTo(randomBetween(random, 0.001, 0.0035), 5);
    const prices = tradeRouteAssets.reduce(
      (assetPrices, asset) => {
        const rules = assetGenerationRules[asset];
        const referencePrice = safeReferencePrices[asset].priceUSDT;
        const marketVariationPercent = randomBetween(random, -rules.variation, rules.variation);
        const spreadPercent = randomBetween(random, 0.0005, 0.003);
        const midPrice = referencePrice * (1 + marketVariationPercent);
        const buyPrice = clampPriceToReasonableRange(
          midPrice * (1 + spreadPercent / 2),
          referencePrice,
          rules.maxDeviation
        );
        const sellPrice = clampPriceToReasonableRange(
          midPrice * (1 - spreadPercent / 2),
          referencePrice,
          rules.maxDeviation
        );
        assetPrices[asset] = {
          buy: roundTo(buyPrice, rules.priceDecimals),
          sell: roundTo(sellPrice, rules.priceDecimals)
        };
        return assetPrices;
      },
      {} as Record<Asset, { buy: number; sell: number }>
    );

    return {
      id: `market-${index + 1}`,
      name,
      tradingFeePercent,
      prices
    };
  });

  const routes: TransferRoute[] = [
    {
      id: "ethereum",
      name: "Ethereum Network",
      networkFeeUSDT: roundTo(randomBetween(random, 12, 35), 2),
      slippagePercent: roundTo(randomBetween(random, 0.0005, 0.0025), 5),
      delayLabel: `${Math.round(randomBetween(random, 8, 18))} min`,
      riskLabel: "Low"
    },
    {
      id: "solana",
      name: "Solana Network",
      networkFeeUSDT: roundTo(randomBetween(random, 1, 5), 2),
      slippagePercent: roundTo(randomBetween(random, 0.001, 0.0045), 5),
      delayLabel: `${Math.round(randomBetween(random, 1, 4))} min`,
      riskLabel: "Medium"
    },
    {
      id: "bridge",
      name: "Bridge Route",
      networkFeeUSDT: roundTo(randomBetween(random, 5, 18), 2),
      slippagePercent: roundTo(randomBetween(random, 0.0025, 0.008), 5),
      delayLabel: `${Math.round(randomBetween(random, 12, 32))} min`,
      riskLabel: "High"
    }
  ];

  const puzzleInput = {
    markets,
    routes,
    startingBalance: TRADE_ROUTE_STARTING_BALANCE
  };

  return {
    puzzleId: `trade-route-${seed}`,
    seed,
    dateKey,
    startingBalance: TRADE_ROUTE_STARTING_BALANCE,
    referencePrices: safeReferencePrices,
    markets,
    routes,
    optimalRoute: findOptimalRoute(puzzleInput)
  };
}

export function createFallbackTradeRoutePuzzle(date = new Date(), userId?: string | null): TradeRoutePuzzle {
  return generateTradeRoutePuzzle(date, userId, createFallbackReferenceAssetPrices());
}

export function calculateRouteResult(
  puzzle: PuzzleCalculationInput,
  selection: UserSelection
): RouteResult | null {
  if (selection.buyMarketId === selection.sellMarketId) {
    return null;
  }

  const buyMarket = puzzle.markets.find((market) => market.id === selection.buyMarketId);
  const sellMarket = puzzle.markets.find((market) => market.id === selection.sellMarketId);
  const route = puzzle.routes.find((candidate) => candidate.id === selection.routeId);

  if (!buyMarket || !sellMarket || !route) {
    return null;
  }

  const buyPrice = buyMarket.prices[selection.asset]?.buy;
  const sellPrice = sellMarket.prices[selection.asset]?.sell;

  if (!Number.isFinite(buyPrice) || !Number.isFinite(sellPrice) || buyPrice <= 0 || sellPrice <= 0) {
    return null;
  }

  const buyFee = puzzle.startingBalance * buyMarket.tradingFeePercent;
  const usdtAfterBuyFee = puzzle.startingBalance - buyFee;
  const assetQuantity = usdtAfterBuyFee / buyPrice;
  const grossSellValue = assetQuantity * sellPrice;
  const slippageCost = grossSellValue * route.slippagePercent;
  const sellFee = grossSellValue * sellMarket.tradingFeePercent;
  const networkFee = route.networkFeeUSDT;
  const finalUSDT = grossSellValue - sellFee - slippageCost - networkFee;
  const profit = finalUSDT - puzzle.startingBalance;
  const totalFees = buyFee + sellFee + slippageCost + networkFee;

  return {
    finalUSDT,
    profit,
    assetQuantity,
    buyFee,
    sellFee,
    networkFee,
    slippageCost,
    totalFees
  };
}

export function findOptimalRoute(puzzle: PuzzleCalculationInput): OptimalRoute {
  let bestRoute: OptimalRoute | null = null;

  for (const asset of tradeRouteAssets) {
    for (const buyMarket of puzzle.markets) {
      for (const sellMarket of puzzle.markets) {
        if (buyMarket.id === sellMarket.id) continue;

        for (const route of puzzle.routes) {
          const selection: UserSelection = {
            asset,
            buyMarketId: buyMarket.id,
            sellMarketId: sellMarket.id,
            routeId: route.id
          };
          const result = calculateRouteResult(puzzle, selection);

          if (!result) continue;

          if (!bestRoute || result.finalUSDT > bestRoute.result.finalUSDT) {
            bestRoute = {
              selection,
              result
            };
          }
        }
      }
    }
  }

  if (!bestRoute) {
    throw new Error("Trade Route Optimizer could not generate a valid route.");
  }

  return bestRoute;
}

export function scoreTradeRoute(selection: UserSelection, result: RouteResult, optimalRoute: OptimalRoute): number {
  if (isSameSelection(selection, optimalRoute.selection)) {
    return 100;
  }

  if (optimalRoute.result.profit > 0) {
    return clampScore(Math.round((result.profit / optimalRoute.result.profit) * 100));
  }

  return clampScore(Math.round((result.finalUSDT / optimalRoute.result.finalUSDT) * 100));
}

export function calculateRouteOptimizerXp({
  finalUSDT,
  startingBalance
}: {
  finalUSDT: number;
  startingBalance: number;
}): RouteOptimizerXpReward {
  const roundedProfit = Math.round((finalUSDT - startingBalance) * 100) / 100;

  if (roundedProfit < 0) {
    return {
      xpAwarded: 0,
      outcome: "loss",
      roundedProfit,
      multiplier: 0
    };
  }

  if (roundedProfit === 0) {
    return {
      xpAwarded: BASE_ROUTE_OPTIMIZER_XP,
      outcome: "breakeven",
      roundedProfit,
      multiplier: 1
    };
  }

  const profitPercent = roundedProfit / startingBalance;
  const multiplier = Math.min(
    1 + profitPercent * PROFIT_MULTIPLIER_FACTOR,
    MAX_ROUTE_OPTIMIZER_XP_MULTIPLIER
  );
  const xpAwarded = Math.max(BASE_ROUTE_OPTIMIZER_XP + 1, Math.round(BASE_ROUTE_OPTIMIZER_XP * multiplier));

  return {
    xpAwarded,
    outcome: "profit",
    roundedProfit,
    multiplier
  };
}

export function isSameSelection(first: UserSelection, second: UserSelection): boolean {
  return (
    first.asset === second.asset &&
    first.buyMarketId === second.buyMarketId &&
    first.sellMarketId === second.sellMarketId &&
    first.routeId === second.routeId
  );
}

function createSeededRandom(seed: string): () => number {
  let state = hashString(seed);

  return () => {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);

    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function randomBetween(random: () => number, min: number, max: number): number {
  return min + (max - min) * random();
}

function normalizeReferenceAssetPrices(referencePrices: ReferenceAssetPrices): ReferenceAssetPrices {
  const fallback = createFallbackReferenceAssetPrices();

  return tradeRouteAssets.reduce((prices, asset) => {
    const candidate = referencePrices[asset];
    prices[asset] =
      candidate && Number.isFinite(candidate.priceUSDT) && candidate.priceUSDT > 0
        ? candidate
        : fallback[asset];
    return prices;
  }, {} as ReferenceAssetPrices);
}

function clampPriceToReasonableRange(price: number, referencePrice: number, maxDeviationPercent: number): number {
  const min = referencePrice * (1 - maxDeviationPercent);
  const max = referencePrice * (1 + maxDeviationPercent);
  return Math.min(Math.max(price, min), max);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
