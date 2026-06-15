export const TRADE_ROUTE_STARTING_BALANCE = 1000;

export const tradeRouteAssets = ["BTC", "ETH", "SOL"] as const;

export type Asset = (typeof tradeRouteAssets)[number];
export type RiskLabel = "Low" | "Medium" | "High";

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
  markets: Market[];
  routes: TransferRoute[];
  optimalRoute: OptimalRoute;
};

type PuzzleCalculationInput = Pick<TradeRoutePuzzle, "markets" | "routes" | "startingBalance">;

const marketNames = ["NovaX", "Atlas Exchange", "OrbitSwap", "TradePort"] as const;

const basePriceRanges: Record<Asset, { min: number; max: number; variation: number }> = {
  BTC: { min: 60000, max: 70000, variation: 0.025 },
  ETH: { min: 2800, max: 4000, variation: 0.025 },
  SOL: { min: 100, max: 220, variation: 0.03 }
};

export function getTradeRouteDateKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function generateTradeRoutePuzzle(date = new Date(), userId?: string | null): TradeRoutePuzzle {
  const dateKey = getTradeRouteDateKey(date);
  const seed = userId ? `${dateKey}-${userId}` : dateKey;
  const random = createSeededRandom(seed);

  const basePrices = tradeRouteAssets.reduce(
    (prices, asset) => {
      const range = basePriceRanges[asset];
      prices[asset] = roundTo(randomBetween(random, range.min, range.max), asset === "SOL" ? 2 : 2);
      return prices;
    },
    {} as Record<Asset, number>
  );

  const markets = marketNames.map((name, index) => {
    const tradingFeePercent = roundTo(randomBetween(random, 0.001, 0.0035), 5);
    const prices = tradeRouteAssets.reduce(
      (assetPrices, asset) => {
        const range = basePriceRanges[asset];
        const marketTilt = randomBetween(random, -range.variation, range.variation);
        const spread = randomBetween(random, 0.0008, 0.003);
        const midPrice = basePrices[asset] * (1 + marketTilt);

        assetPrices[asset] = {
          buy: roundTo(midPrice * (1 + spread), asset === "SOL" ? 3 : 2),
          sell: roundTo(midPrice * (1 - spread), asset === "SOL" ? 3 : 2)
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
    markets,
    routes,
    optimalRoute: findOptimalRoute(puzzleInput)
  };
}

export function createFallbackTradeRoutePuzzle(date = new Date(), userId?: string | null): TradeRoutePuzzle {
  const dateKey = getTradeRouteDateKey(date);
  const seed = userId ? `${dateKey}-${userId}-fallback` : `${dateKey}-fallback`;
  const markets: Market[] = [
    {
      id: "market-1",
      name: "NovaX",
      tradingFeePercent: 0.0018,
      prices: {
        BTC: { buy: 64220, sell: 64040 },
        ETH: { buy: 3368, sell: 3358 },
        SOL: { buy: 156.4, sell: 155.9 }
      }
    },
    {
      id: "market-2",
      name: "Atlas Exchange",
      tradingFeePercent: 0.0022,
      prices: {
        BTC: { buy: 65020, sell: 64860 },
        ETH: { buy: 3412, sell: 3401 },
        SOL: { buy: 159.2, sell: 158.7 }
      }
    },
    {
      id: "market-3",
      name: "OrbitSwap",
      tradingFeePercent: 0.0028,
      prices: {
        BTC: { buy: 63690, sell: 63520 },
        ETH: { buy: 3316, sell: 3308 },
        SOL: { buy: 153.7, sell: 153.2 }
      }
    },
    {
      id: "market-4",
      name: "TradePort",
      tradingFeePercent: 0.0014,
      prices: {
        BTC: { buy: 64650, sell: 64490 },
        ETH: { buy: 3458, sell: 3448 },
        SOL: { buy: 162.1, sell: 161.6 }
      }
    }
  ];
  const routes: TransferRoute[] = [
    {
      id: "ethereum",
      name: "Ethereum Network",
      networkFeeUSDT: 24.5,
      slippagePercent: 0.0012,
      delayLabel: "14 min",
      riskLabel: "Low"
    },
    {
      id: "solana",
      name: "Solana Network",
      networkFeeUSDT: 2.4,
      slippagePercent: 0.0022,
      delayLabel: "2 min",
      riskLabel: "Medium"
    },
    {
      id: "bridge",
      name: "Bridge Route",
      networkFeeUSDT: 9.8,
      slippagePercent: 0.0055,
      delayLabel: "22 min",
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
    markets,
    routes,
    optimalRoute: findOptimalRoute(puzzleInput)
  };
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

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
