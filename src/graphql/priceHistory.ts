import type { SwapExecution } from "@prisma/client";

const HOUR_IN_SECONDS = 60 * 60;
const PRICE_PRECISION = 18;

type PriceHistorySwap = Pick<
  SwapExecution,
  | "tokenIn"
  | "tokenOut"
  | "amountIn"
  | "amountOut"
  | "timestamp"
  | "blockNumber"
  | "logIndex"
>;

type Ratio = {
  numerator: bigint;
  denominator: bigint;
};

type MutableBar = {
  timestamp: number;
  open: Ratio;
  high: Ratio;
  low: Ratio;
  close: Ratio;
  volumeInRaw: bigint;
  volumeOutRaw: bigint;
  trades: number;
};

export type PriceHistoryBar = {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeIn: string;
  volumeOut: string;
  trades: number;
};

export type BuildHourlyPriceHistoryArgs = {
  tokenIn: string;
  tokenOut: string;
  tokenInDecimals?: number | null;
  tokenOutDecimals?: number | null;
  from: number;
  to: number;
  swaps: PriceHistorySwap[];
};

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function isValidDecimals(value?: number | null): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function powerOfTen(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

function parsePositiveBigInt(value: string): bigint | null {
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function compareRatios(left: Ratio, right: Ratio): number {
  const leftSide = left.numerator * right.denominator;
  const rightSide = right.numerator * left.denominator;

  if (leftSide === rightSide) return 0;
  return leftSide > rightSide ? 1 : -1;
}

function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();

  const divisor = powerOfTen(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");

  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

function formatRatio(value: Ratio): string {
  const scale = powerOfTen(PRICE_PRECISION);
  const scaled =
    (value.numerator * scale + value.denominator / 2n) / value.denominator;
  return formatUnits(scaled, PRICE_PRECISION);
}

function bucketStart(timestamp: Date): number {
  const seconds = Math.floor(timestamp.getTime() / 1000);
  return Math.floor(seconds / HOUR_IN_SECONDS) * HOUR_IN_SECONDS;
}

export function buildHourlyPriceHistory({
  tokenIn,
  tokenOut,
  tokenInDecimals,
  tokenOutDecimals,
  from,
  to,
  swaps,
}: BuildHourlyPriceHistoryArgs): PriceHistoryBar[] {
  if (from >= to) return [];
  if (!isValidDecimals(tokenInDecimals) || !isValidDecimals(tokenOutDecimals)) {
    return [];
  }

  const requestedTokenIn = normalizeAddress(tokenIn);
  const requestedTokenOut = normalizeAddress(tokenOut);
  const tokenInScale = powerOfTen(tokenInDecimals);
  const tokenOutScale = powerOfTen(tokenOutDecimals);

  const orderedSwaps = [...swaps].sort((left, right) => {
    const timeDiff = left.timestamp.getTime() - right.timestamp.getTime();
    if (timeDiff !== 0) return timeDiff;

    const blockDiff = left.blockNumber - right.blockNumber;
    if (blockDiff !== 0) return blockDiff;

    return left.logIndex - right.logIndex;
  });

  const buckets = new Map<number, MutableBar>();

  for (const swap of orderedSwaps) {
    const timestampSeconds = Math.floor(swap.timestamp.getTime() / 1000);
    if (timestampSeconds < from || timestampSeconds >= to) continue;

    const swapTokenIn = normalizeAddress(swap.tokenIn);
    const swapTokenOut = normalizeAddress(swap.tokenOut);
    const isForward =
      swapTokenIn === requestedTokenIn && swapTokenOut === requestedTokenOut;
    const isReverse =
      swapTokenIn === requestedTokenOut && swapTokenOut === requestedTokenIn;

    if (!isForward && !isReverse) continue;

    const amountIn = parsePositiveBigInt(swap.amountIn);
    const amountOut = parsePositiveBigInt(swap.amountOut);
    if (amountIn === null || amountOut === null) continue;

    const price: Ratio = isForward
      ? {
          numerator: amountOut * tokenInScale,
          denominator: amountIn * tokenOutScale,
        }
      : {
          numerator: amountIn * tokenInScale,
          denominator: amountOut * tokenOutScale,
        };

    const volumeInRaw = isForward ? amountIn : amountOut;
    const volumeOutRaw = isForward ? amountOut : amountIn;
    const timestamp = bucketStart(swap.timestamp);
    const existing = buckets.get(timestamp);

    if (!existing) {
      buckets.set(timestamp, {
        timestamp,
        open: price,
        high: price,
        low: price,
        close: price,
        volumeInRaw,
        volumeOutRaw,
        trades: 1,
      });
      continue;
    }

    existing.close = price;
    if (compareRatios(price, existing.high) > 0) existing.high = price;
    if (compareRatios(price, existing.low) < 0) existing.low = price;
    existing.volumeInRaw += volumeInRaw;
    existing.volumeOutRaw += volumeOutRaw;
    existing.trades += 1;
  }

  return [...buckets.values()]
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((bar) => ({
      timestamp: bar.timestamp,
      open: formatRatio(bar.open),
      high: formatRatio(bar.high),
      low: formatRatio(bar.low),
      close: formatRatio(bar.close),
      volumeIn: formatUnits(bar.volumeInRaw, tokenInDecimals),
      volumeOut: formatUnits(bar.volumeOutRaw, tokenOutDecimals),
      trades: bar.trades,
    }));
}
