import { formatUnits } from "viem";
import { buildHourlyPriceHistory } from "./priceHistory.js";

const MICRO_USD = 1_000_000n;
const DEFAULT_FEE_BPS = 30n;
const WINDOW_MS: Record<string, number> = {
  "24H": 24 * 60 * 60 * 1000,
  "7D": 7 * 24 * 60 * 60 * 1000,
  "30D": 30 * 24 * 60 * 60 * 1000,
};

export interface AnalyticsToken {
  address: string;
  symbol: string;
  decimals: number;
}

export interface AnalyticsOracleState {
  asset: string;
  price: string;
  decimals: number;
}

export interface AnalyticsVaultState {
  totalAssets: string;
}

export interface AnalyticsSwap {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  recipient: string;
  poolType: string;
  hops: number;
  timestamp: Date;
  blockNumber?: number;
  logIndex?: number;
}

export interface AnalyticsTopRouteRow {
  tokenIn: string;
  tokenOut: string;
  poolType: string;
  hops: number;
  swapCount: number;
  amountInTotal: string;
  amountOutTotal: string;
  lastSwapAt: Date;
}

export interface ProtocolStatsResult {
  volume24h: string;
  feeRevenue24h: string;
  uniqueTraders7d: number;
  tvl: string;
  totalSwaps: number;
  activeAdapters: number;
  pricedSwapCoverage24h: number;
  estimationNote: string;
}

export interface RouteStatsResult {
  routeKey: string;
  label: string;
  tokenIn: string;
  tokenInSymbol: string;
  tokenOut: string;
  tokenOutSymbol: string;
  poolType: string;
  hops: number;
  swapCount: number;
  amountInTotal: string;
  amountOutTotal: string;
  estimatedVolumeUsd: string;
  priced: boolean;
  lastSwapAt: string;
}

export interface PoolAnalyticsResult {
  pair: string;
  window: string;
  volumeIn: string;
  volumeOut: string;
  estimatedVolumeUsd: string;
  estimatedFeesUsd: string;
  tradeCount: number;
  pricedTrades: number;
  priceHigh: string;
  priceLow: string;
  lastPrice: string | null;
}

interface ResolvedPair {
  tokenIn: AnalyticsToken;
  tokenOut: AnalyticsToken;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function pow10(decimals: number): bigint {
  return 10n ** BigInt(Math.max(0, decimals));
}

function parsePositiveBigInt(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;

  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function isStableSymbol(symbol: string | undefined): boolean {
  if (!symbol) return false;
  const normalized = symbol.toUpperCase();
  return (
    normalized.includes("USDC") ||
    normalized.includes("USDT") ||
    normalized === "DAI" ||
    normalized === "USDX"
  );
}

function isDotLikeSymbol(symbol: string | undefined): boolean {
  if (!symbol) return false;
  return symbol.toUpperCase().includes("DOT");
}

function formatUsdMicros(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / MICRO_USD;
  const fraction = (absolute % MICRO_USD).toString().padStart(6, "0");
  return `${sign}${whole.toString()}.${fraction.slice(0, 2)}`;
}

function formatTokenTotal(amount: string, decimals: number): string {
  try {
    const normalized = formatUnits(BigInt(amount), decimals);
    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) {
      return numeric.toLocaleString(undefined, {
        maximumFractionDigits: 4,
      });
    }
    return normalized;
  } catch {
    return amount;
  }
}

function getWindowStart(window: string, now = Date.now()): Date {
  const normalized = window.trim().toUpperCase();
  const duration = WINDOW_MS[normalized];
  if (!duration) {
    throw new Error("poolAnalytics: unsupported window. Use 24H, 7D, or 30D");
  }

  return new Date(now - duration);
}

function resolveDotUsdMicros(oracles: AnalyticsOracleState[]): bigint | null {
  const dotOracle = oracles.find((oracle) =>
    oracle.asset.trim().toUpperCase().includes("DOT"),
  );
  if (!dotOracle) return null;

  const rawPrice = parsePositiveBigInt(dotOracle.price);
  if (rawPrice === null) return null;

  return (rawPrice * MICRO_USD) / pow10(dotOracle.decimals);
}

function usdPerTokenMicros(
  token: AnalyticsToken | undefined,
  dotUsdMicros: bigint | null,
): bigint | null {
  if (!token) return null;
  if (isStableSymbol(token.symbol)) return MICRO_USD;
  if (isDotLikeSymbol(token.symbol) && dotUsdMicros !== null) {
    return dotUsdMicros;
  }
  return null;
}

function amountToUsdMicros(
  rawAmount: string,
  decimals: number,
  priceMicros: bigint,
): bigint | null {
  const amount = parsePositiveBigInt(rawAmount);
  if (amount === null) return null;
  return (amount * priceMicros) / pow10(decimals);
}

function estimateSwapUsdMicros(
  swap: Pick<AnalyticsSwap, "tokenIn" | "tokenOut" | "amountIn" | "amountOut">,
  tokensByAddress: Map<string, AnalyticsToken>,
  dotUsdMicros: bigint | null,
): bigint | null {
  const tokenIn = tokensByAddress.get(normalizeKey(swap.tokenIn));
  const tokenOut = tokensByAddress.get(normalizeKey(swap.tokenOut));
  const candidates: Array<{
    token: AnalyticsToken | undefined;
    amount: string;
    priority: number;
  }> = [
    {
      token: tokenOut,
      amount: swap.amountOut,
      priority: isStableSymbol(tokenOut?.symbol)
        ? 0
        : isDotLikeSymbol(tokenOut?.symbol)
          ? 1
          : 10,
    },
    {
      token: tokenIn,
      amount: swap.amountIn,
      priority: isStableSymbol(tokenIn?.symbol)
        ? 0
        : isDotLikeSymbol(tokenIn?.symbol)
          ? 1
          : 10,
    },
  ].sort((a, b) => a.priority - b.priority);

  for (const candidate of candidates) {
    const priceMicros = usdPerTokenMicros(candidate.token, dotUsdMicros);
    if (!candidate.token || priceMicros === null) continue;

    const usdMicros = amountToUsdMicros(
      candidate.amount,
      candidate.token.decimals,
      priceMicros,
    );
    if (usdMicros !== null) return usdMicros;
  }

  return null;
}

function estimatedFeeBps(poolType: string): bigint {
  switch (poolType) {
    case "HydrationOmnipool":
    case "AssetHubPair":
    case "BifrostDEX":
    case "UniswapV2":
      return DEFAULT_FEE_BPS;
    default:
      return 0n;
  }
}

function sumDecimalStrings(values: string[]): string {
  const total = values.reduce((sum, value) => sum + Number(value || "0"), 0);
  return total.toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

function buildTokenIndexes(tokens: AnalyticsToken[]) {
  const byAddress = new Map<string, AnalyticsToken>();
  const bySymbol = new Map<string, AnalyticsToken>();

  for (const token of tokens) {
    byAddress.set(normalizeKey(token.address), token);
    bySymbol.set(normalizeKey(token.symbol), token);
  }

  return { byAddress, bySymbol };
}

function resolvePair(pair: string, tokens: AnalyticsToken[]): ResolvedPair {
  const segments = pair
    .split(/[/:>-]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length !== 2) {
    throw new Error(
      "poolAnalytics: invalid pair. Use SYMBOL/SYMBOL or address/address",
    );
  }

  const { byAddress, bySymbol } = buildTokenIndexes(tokens);
  const tokenIn =
    byAddress.get(normalizeKey(segments[0])) ??
    bySymbol.get(normalizeKey(segments[0]));
  const tokenOut =
    byAddress.get(normalizeKey(segments[1])) ??
    bySymbol.get(normalizeKey(segments[1]));

  if (!tokenIn || !tokenOut) {
    throw new Error(
      "poolAnalytics: unknown pair. Use known token symbols or addresses",
    );
  }

  return { tokenIn, tokenOut };
}

export function buildProtocolStats(params: {
  tokens: AnalyticsToken[];
  oracleStates: AnalyticsOracleState[];
  swaps24h: AnalyticsSwap[];
  swaps7d: AnalyticsSwap[];
  totalSwaps: number;
  vaultState: AnalyticsVaultState | null;
}): ProtocolStatsResult {
  const { tokens, oracleStates, swaps24h, swaps7d, totalSwaps, vaultState } =
    params;
  const { byAddress } = buildTokenIndexes(tokens);
  const dotUsdMicros = resolveDotUsdMicros(oracleStates);

  let volumeMicros = 0n;
  let feeMicros = 0n;
  let pricedSwapCoverage24h = 0;

  for (const swap of swaps24h) {
    const usdMicros = estimateSwapUsdMicros(swap, byAddress, dotUsdMicros);
    if (usdMicros === null) continue;

    pricedSwapCoverage24h += 1;
    volumeMicros += usdMicros;
    feeMicros += (usdMicros * estimatedFeeBps(swap.poolType)) / 10_000n;
  }

  const uniqueTraders7d = new Set(
    swaps7d.map((swap) => normalizeKey(swap.recipient)),
  ).size;
  const activeAdapters = new Set(
    swaps7d.map((swap) => swap.poolType).filter(Boolean),
  ).size;

  let tvlMicros = 0n;
  if (vaultState && dotUsdMicros !== null) {
    const estimated = amountToUsdMicros(vaultState.totalAssets, 18, dotUsdMicros);
    if (estimated !== null) {
      tvlMicros = estimated;
    }
  }

  return {
    volume24h: formatUsdMicros(volumeMicros),
    feeRevenue24h: formatUsdMicros(feeMicros),
    uniqueTraders7d,
    tvl: formatUsdMicros(tvlMicros),
    totalSwaps,
    activeAdapters,
    pricedSwapCoverage24h,
    estimationNote:
      dotUsdMicros === null
        ? "USD estimates are unavailable until a DOT oracle price is indexed."
        : "USD estimates use stable-token parity, the current DOT oracle price, and a conservative 30 bps fee heuristic for local AMMs. Unpriced assets are excluded.",
  };
}

export function buildTopRoutes(params: {
  routes: AnalyticsTopRouteRow[];
  tokens: AnalyticsToken[];
  oracleStates: AnalyticsOracleState[];
}): RouteStatsResult[] {
  const { routes, tokens, oracleStates } = params;
  const { byAddress } = buildTokenIndexes(tokens);
  const dotUsdMicros = resolveDotUsdMicros(oracleStates);

  return routes.map((route) => {
    const tokenIn = byAddress.get(normalizeKey(route.tokenIn));
    const tokenOut = byAddress.get(normalizeKey(route.tokenOut));
    const estimatedVolumeUsdMicros = estimateSwapUsdMicros(
      {
        tokenIn: route.tokenIn,
        tokenOut: route.tokenOut,
        amountIn: route.amountInTotal,
        amountOut: route.amountOutTotal,
      },
      byAddress,
      dotUsdMicros,
    );

    return {
      routeKey: [
        normalizeKey(route.tokenIn),
        normalizeKey(route.tokenOut),
        route.poolType,
        route.hops,
      ].join(":"),
      label: `${tokenIn?.symbol ?? route.tokenIn} -> ${tokenOut?.symbol ?? route.tokenOut} via ${route.poolType}`,
      tokenIn: route.tokenIn,
      tokenInSymbol: tokenIn?.symbol ?? route.tokenIn,
      tokenOut: route.tokenOut,
      tokenOutSymbol: tokenOut?.symbol ?? route.tokenOut,
      poolType: route.poolType,
      hops: route.hops,
      swapCount: route.swapCount,
      amountInTotal: formatTokenTotal(
        route.amountInTotal,
        tokenIn?.decimals ?? 18,
      ),
      amountOutTotal: formatTokenTotal(
        route.amountOutTotal,
        tokenOut?.decimals ?? 18,
      ),
      estimatedVolumeUsd: formatUsdMicros(estimatedVolumeUsdMicros ?? 0n),
      priced: estimatedVolumeUsdMicros !== null,
      lastSwapAt: route.lastSwapAt.toISOString(),
    };
  });
}

export function buildPoolAnalytics(params: {
  pair: string;
  window: string;
  tokens: AnalyticsToken[];
  oracleStates: AnalyticsOracleState[];
  swaps: AnalyticsSwap[];
}): PoolAnalyticsResult {
  const { pair, window, tokens, oracleStates, swaps } = params;
  const resolvedPair = resolvePair(pair, tokens);
  const { byAddress } = buildTokenIndexes(tokens);
  const dotUsdMicros = resolveDotUsdMicros(oracleStates);

  const bars = buildHourlyPriceHistory({
    tokenIn: resolvedPair.tokenIn.address,
    tokenOut: resolvedPair.tokenOut.address,
    tokenInDecimals: resolvedPair.tokenIn.decimals,
    tokenOutDecimals: resolvedPair.tokenOut.decimals,
    from: Math.floor(getWindowStart(window).getTime() / 1000),
    to: Math.floor(Date.now() / 1000),
    swaps: swaps.map((swap) => ({
      tokenIn: swap.tokenIn,
      tokenOut: swap.tokenOut,
      amountIn: swap.amountIn,
      amountOut: swap.amountOut,
      timestamp: swap.timestamp,
      blockNumber: swap.blockNumber ?? 0,
      logIndex: swap.logIndex ?? 0,
    })),
  });

  let estimatedVolumeUsdMicros = 0n;
  let estimatedFeesUsdMicros = 0n;
  let pricedTrades = 0;

  for (const swap of swaps) {
    const usdMicros = estimateSwapUsdMicros(swap, byAddress, dotUsdMicros);
    if (usdMicros === null) continue;

    pricedTrades += 1;
    estimatedVolumeUsdMicros += usdMicros;
    estimatedFeesUsdMicros +=
      (usdMicros * estimatedFeeBps(swap.poolType)) / 10_000n;
  }

  const high = bars.reduce<number | null>((max, bar) => {
    const value = Number(bar.high);
    if (!Number.isFinite(value)) return max;
    return max === null ? value : Math.max(max, value);
  }, null);
  const low = bars.reduce<number | null>((min, bar) => {
    const value = Number(bar.low);
    if (!Number.isFinite(value)) return min;
    return min === null ? value : Math.min(min, value);
  }, null);
  const lastPrice = bars.at(-1)?.close ?? null;

  return {
    pair: `${resolvedPair.tokenIn.symbol}/${resolvedPair.tokenOut.symbol}`,
    window: window.trim().toUpperCase(),
    volumeIn: sumDecimalStrings(bars.map((bar) => bar.volumeIn)),
    volumeOut: sumDecimalStrings(bars.map((bar) => bar.volumeOut)),
    estimatedVolumeUsd: formatUsdMicros(estimatedVolumeUsdMicros),
    estimatedFeesUsd: formatUsdMicros(estimatedFeesUsdMicros),
    tradeCount: swaps.length,
    pricedTrades,
    priceHigh:
      high === null
        ? "0"
        : high.toLocaleString(undefined, { maximumFractionDigits: 6 }),
    priceLow:
      low === null
        ? "0"
        : low.toLocaleString(undefined, { maximumFractionDigits: 6 }),
    lastPrice,
  };
}

export function filterSwapsForPair(params: {
  swaps: AnalyticsSwap[];
  pair: string;
  tokens: AnalyticsToken[];
  window: string;
}): AnalyticsSwap[] {
  const { swaps, pair, tokens, window } = params;
  const resolvedPair = resolvePair(pair, tokens);
  const startTime = getWindowStart(window);
  const tokenA = normalizeKey(resolvedPair.tokenIn.address);
  const tokenB = normalizeKey(resolvedPair.tokenOut.address);

  return swaps.filter((swap) => {
    if (swap.timestamp < startTime) return false;

    const input = normalizeKey(swap.tokenIn);
    const output = normalizeKey(swap.tokenOut);
    return (
      (input === tokenA && output === tokenB) ||
      (input === tokenB && output === tokenA)
    );
  });
}
