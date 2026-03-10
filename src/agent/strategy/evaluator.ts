// ── Strategy Evaluator ───────────────────────────────────
// Evaluates vault state to identify yield optimization opportunities.

import type { PrismaClient } from "@prisma/client";
import { logger } from "../../utils/logger.js";

export interface YieldOpportunity {
  type:
    | "bifrost_mint"
    | "bifrost_farm"
    | "local_swap"
    | "cross_chain_rebalance";
  expectedReturn: number; // basis points (100 = 1%)
  risk: "low" | "medium" | "high";
  description: string;
  params: Record<string, string>;
}

export class StrategyEvaluator {
  constructor(private prisma: PrismaClient) {}

  /** Gather current state and identify yield opportunities */
  async evaluate(): Promise<YieldOpportunity[]> {
    const opportunities: YieldOpportunity[] = [];

    const vaultState = await this.prisma.vaultState.findFirst();
    if (!vaultState) {
      logger.warn("No vault state — cannot evaluate strategies");
      return opportunities;
    }

    const oracleState = await this.prisma.oracleState.findFirst({
      where: { asset: "DOT" },
    });

    const totalAssets = BigInt(vaultState.totalAssets);

    // Only evaluate if vault has meaningful assets
    if (totalAssets < 1_000_000_000_000_000_000n) {
      // < 1 DOT
      logger.debug(
        "Vault assets below threshold — skipping strategy evaluation",
      );
      return opportunities;
    }

    // Check for Bifrost vDOT minting opportunity
    // If vault holds idle DOT, minting vDOT via Bifrost SLP could yield staking rewards
    const idleRatio = this.estimateIdleRatio(vaultState);
    if (idleRatio > 0.3) {
      opportunities.push({
        type: "bifrost_mint",
        expectedReturn: 150, // ~1.5% APR estimate
        risk: "low",
        description: `${(idleRatio * 100).toFixed(1)}% of vault is idle DOT — mint vDOT via Bifrost for staking yield`,
        params: {
          amount: (totalAssets / 5n).toString(), // Deploy 20%
          parachainId: "2030",
        },
      });
    }

    // Check for rebalancing if oracle price changed significantly
    if (oracleState) {
      const recentUpdates = await this.prisma.oracleUpdate.findMany({
        where: { feed: oracleState.feedAddress },
        orderBy: { blockNumber: "desc" },
        take: 10,
      });

      if (recentUpdates.length >= 2) {
        const latestPrice = BigInt(recentUpdates[0].price);
        const oldestPrice = BigInt(
          recentUpdates[recentUpdates.length - 1].price,
        );
        const priceDelta =
          Number(latestPrice - oldestPrice) / Number(oldestPrice);

        if (Math.abs(priceDelta) > 0.02) {
          opportunities.push({
            type: "local_swap",
            expectedReturn: Math.abs(Math.round(priceDelta * 10000)),
            risk: "medium",
            description: `DOT price moved ${(priceDelta * 100).toFixed(2)}% — consider rebalancing DOT/USDC`,
            params: {
              priceChange: priceDelta.toFixed(4),
            },
          });
        }
      }
    }

    logger.info(
      { count: opportunities.length },
      "Strategy evaluation complete",
    );

    return opportunities;
  }

  /** Build a state snapshot string for LLM analysis */
  async buildStateSnapshot(): Promise<string> {
    const vaultState = await this.prisma.vaultState.findFirst();
    const oracleStates = await this.prisma.oracleState.findMany();
    const recentDeposits = await this.prisma.deposit.count();
    const recentWithdrawals = await this.prisma.withdrawal.count();
    const recentStrategies = await this.prisma.strategyExecution.findMany({
      orderBy: { blockNumber: "desc" },
      take: 5,
    });
    const parachains = await this.prisma.parachainConfig.findMany({
      where: { allowed: true },
    });
    const protocols = await this.prisma.protocolConfig.findMany({
      where: { allowed: true },
    });

    return JSON.stringify(
      {
        vault: vaultState,
        oracles: oracleStates,
        stats: {
          totalDeposits: recentDeposits,
          totalWithdrawals: recentWithdrawals,
        },
        recentStrategies: recentStrategies.map((s) => ({
          destination: s.destination,
          amount: s.amount,
          profit: s.profit,
          success: s.success,
        })),
        allowedParachains: parachains.map((p) => p.parachainId),
        allowedProtocols: protocols.map((p) => p.protocol),
      },
      null,
      2,
    );
  }

  private estimateIdleRatio(vaultState: {
    totalAssets: string;
    totalDeposited: string;
    totalWithdrawn: string;
  }): number {
    const totalAssets = Number(BigInt(vaultState.totalAssets));
    if (totalAssets === 0) return 0;
    // Simple heuristic: if totalAssets ~ totalDeposited - totalWithdrawn,
    // most capital is sitting idle in the vault
    const netDeposited =
      Number(BigInt(vaultState.totalDeposited)) -
      Number(BigInt(vaultState.totalWithdrawn));
    if (netDeposited <= 0) return 0;
    return Math.min(1, totalAssets / netDeposited);
  }
}
