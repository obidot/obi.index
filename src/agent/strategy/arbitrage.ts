// ── Arbitrage Detector ───────────────────────────────────
// Detects price discrepancies between pools for arbitrage opportunities.

import type { PrismaClient } from "@prisma/client";
import { logger } from "../../utils/logger.js";

export interface ArbitrageOpportunity {
  tokenA: string;
  tokenB: string;
  poolA: string; // pool type or identifier
  poolB: string;
  priceA: number;
  priceB: number;
  spreadBps: number; // basis points
  estimatedProfit: string; // uint256 as string
  viable: boolean;
}

export class ArbitrageDetector {
  constructor(private prisma: PrismaClient) {}

  /**
   * Scan recent swaps for price discrepancies between pool types.
   * If the same pair was traded on different pools at different effective prices,
   * there may be an arbitrage opportunity.
   */
  async detect(): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    // Get recent swaps grouped by token pair
    const recentSwaps = await this.prisma.swapExecution.findMany({
      orderBy: { blockNumber: "desc" },
      take: 100,
    });

    if (recentSwaps.length < 2) {
      logger.debug("Not enough swap data for arbitrage detection");
      return opportunities;
    }

    // Group by token pair
    const pairMap = new Map<
      string,
      Array<{
        poolType: string;
        effectivePrice: number;
        amountIn: string;
        amountOut: string;
      }>
    >();

    for (const swap of recentSwaps) {
      const pairKey = [swap.tokenIn, swap.tokenOut].sort().join("-");
      const amountIn = Number(BigInt(swap.amountIn));
      const amountOut = Number(BigInt(swap.amountOut));

      if (amountIn === 0) continue;

      const effectivePrice = amountOut / amountIn;
      const existing = pairMap.get(pairKey) ?? [];
      existing.push({
        poolType: swap.poolType,
        effectivePrice,
        amountIn: swap.amountIn,
        amountOut: swap.amountOut,
      });
      pairMap.set(pairKey, existing);
    }

    // Find pairs traded on multiple pool types with price differences
    for (const [pairKey, trades] of pairMap.entries()) {
      const poolTypes = [...new Set(trades.map((t) => t.poolType))];
      if (poolTypes.length < 2) continue;

      // Compare prices between pool types
      for (let i = 0; i < poolTypes.length; i++) {
        for (let j = i + 1; j < poolTypes.length; j++) {
          const tradesA = trades.filter((t) => t.poolType === poolTypes[i]);
          const tradesB = trades.filter((t) => t.poolType === poolTypes[j]);

          const avgPriceA =
            tradesA.reduce((sum, t) => sum + t.effectivePrice, 0) /
            tradesA.length;
          const avgPriceB =
            tradesB.reduce((sum, t) => sum + t.effectivePrice, 0) /
            tradesB.length;

          if (avgPriceA === 0 || avgPriceB === 0) continue;

          const spreadBps = Math.abs(
            Math.round(((avgPriceA - avgPriceB) / avgPriceA) * 10000),
          );

          // Only report if spread > 50 bps (0.5%)
          if (spreadBps > 50) {
            const [tokenA, tokenB] = pairKey.split("-");
            opportunities.push({
              tokenA,
              tokenB,
              poolA: poolTypes[i],
              poolB: poolTypes[j],
              priceA: avgPriceA,
              priceB: avgPriceB,
              spreadBps,
              estimatedProfit: "0", // Would need liquidity depth to estimate
              viable: spreadBps > 100, // Only viable if > 1% spread (covers gas + slippage)
            });

            logger.info(
              {
                pair: pairKey,
                poolA: poolTypes[i],
                poolB: poolTypes[j],
                spreadBps,
              },
              "Arbitrage opportunity detected",
            );
          }
        }
      }
    }

    return opportunities;
  }
}
