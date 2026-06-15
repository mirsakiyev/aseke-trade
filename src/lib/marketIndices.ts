import { createUnavailableMarketIndices, type MarketIndicesResponse } from "./marketIndexMath";
import { supabase } from "./supabase";

export async function fetchMarketIndices(): Promise<MarketIndicesResponse> {
  if (!supabase) {
    throw new Error("Supabase is not connected, so live market indices cannot be loaded.");
  }

  const { data, error } = await supabase.functions.invoke("market-indices", {
    body: {}
  });

  if (error) {
    throw new Error("Live market index data is temporarily unavailable.");
  }

  return normalizeMarketIndicesResponse(data);
}

function normalizeMarketIndicesResponse(data: unknown): MarketIndicesResponse {
  if (!isRecord(data)) {
    return createUnavailableMarketIndices("Market index response was malformed.");
  }

  const fallback = createUnavailableMarketIndices("Market index data unavailable.");
  const fearGreed = isRecord(data.fearGreed) ? data.fearGreed : fallback.fearGreed;
  const longShort = isRecord(data.longShort) ? data.longShort : fallback.longShort;
  const volatility = isRecord(data.volatility) ? data.volatility : fallback.volatility;

  return {
    generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : fallback.generatedAt,
    fearGreed: {
      ...fallback.fearGreed,
      ...fearGreed,
      source: "Alternative.me"
    },
    longShort: {
      ...fallback.longShort,
      ...longShort,
      includedExchanges: Array.isArray(longShort.includedExchanges) ? longShort.includedExchanges.map(String) : [],
      requestedExchanges: Array.isArray(longShort.requestedExchanges)
        ? longShort.requestedExchanges.map(String)
        : fallback.longShort.requestedExchanges
    },
    volatility: {
      ...fallback.volatility,
      ...volatility,
      source: "Deribit"
    }
  } as MarketIndicesResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
