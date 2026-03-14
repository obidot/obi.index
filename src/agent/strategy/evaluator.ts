// ── Strategy Evaluator ───────────────────────────────────
// Evaluates vault state to identify yield optimization opportunities.
// Uses pure BigInt arithmetic throughout to avoid precision loss.

import type { PrismaClient } from "@prisma/client";
import { readVaultState, readOracleState } from "../../sync/rpc.js";
import { logger } from "../../utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export interface YieldOpportunity {
  type: "bifrost_mint" | "bifrost_farm" | "local_swap" | "cross_chain_rebalance";
  expectedReturn: number; // basis points (100 = 1%)
  risk: "low" | "medium" | "high";
  description: string;
  params: Record<string, string>;
}

// 1 DOT (18-decimal) as minimum vault balance threshold
const MIN_VAULT_ASSETS = 1_000_000_000_000_000_000n;

// Lookback window for "recent" activity in the snapshot
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─────────────────────────────────────────────────────────────────────────────
//  StrategyEvaluator
// ─────────────────────────────────────────────────────────────────────────────

export class StrategyEvaluator {
  constructor(private readonly prisma: PrismaClient) {}

  // ─────────────────────────────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────────────────────────────

  /** Gather current state and identify yield opportunities. */
  async evaluate(): Promise<YieldOpportunity[]> {
    const opportunities: YieldOpportunity[] = [];

    const vaultState = await this.prisma.vaultState.findFirst();
    if (!vaultState) {
      logger.warn("No vault state in DB — cannot evaluate strategies");
      return opportunities;
    }

    const totalAssets = BigInt(vaultState.totalAssets);
    if (totalAssets < MIN_VAULT_ASSETS) {
      logger.debug("Vault assets below 1 DOT threshold — skipping evaluation");
      return opportunities;
    }

    const idleRatio = this._estimateIdleRatio(vaultState);

    // ── Bifrost vDOT minting ──────────────────────────────────────────
    // If > 30% of capital is idle DOT, minting vDOT via SLP gives staking yield
    if (idleRatio > 30n) {
      // Deploy 20% of totalAssets
      const deployAmount = totalAssets / 5n;
      opportunities.push({
        type: "bifrost_mint",
        expectedReturn: 150, // ~1.5% APR estimate
        risk: "low",
        description: `${idleRatio.toString()}% of vault is idle — mint vDOT via Bifrost SLP for staking yield`,
        params: {
          amount: deployAmount.toString(),
          parachainId: "2030",
        },
      });
    }

    // ── Price-move rebalancing ────────────────────────────────────────
    const oracleState = await this.prisma.oracleState.findFirst({
      where: { asset: "DOT" },
    });

    if (oracleState) {
      const recentUpdates = await this.prisma.oracleUpdate.findMany({
        where: { feed: oracleState.feedAddress },
        orderBy: { blockNumber: "desc" },
        take: 10,
      });

      if (recentUpdates.length >= 2) {
        const latestPrice = BigInt(recentUpdates[0]?.price ?? "0");
        const oldestPrice = BigInt(recentUpdates[recentUpdates.length - 1]?.price ?? "0");

        if (latestPrice > 0n && oldestPrice > 0n) {
          // Compute % delta in basis points to avoid floating point
          const deltaBps =
            ((latestPrice - oldestPrice) * 10_000n) / oldestPrice;
          const absDeltaBps = deltaBps < 0n ? -deltaBps : deltaBps;

          if (absDeltaBps > 200n) {
            // > 2% price move
            opportunities.push({
              type: "local_swap",
              expectedReturn: Number(absDeltaBps),
              risk: "medium",
              description: `DOT price moved ${Number(deltaBps) / 100}% — consider rebalancing DOT/USDC via SwapRouter`,
              params: {
                priceDeltaBps: deltaBps.toString(),
              },
            });
          }
        }
      }
    }

    logger.info(
      { count: opportunities.length },
      "Strategy evaluation complete",
    );

    return opportunities;
  }

  /**
   * Build a rich state snapshot string for the LLM.
   * Uses live RPC reads for current values and DB for historical counts.
   * All BigInt values are serialised as strings to avoid JSON precision loss.
   */
  async buildStateSnapshot(): Promise<string> {
    const since = new Date(Date.now() - RECENT_WINDOW_MS);

    // ── Parallel DB + RPC reads ───────────────────────────────────────
    const [
      vaultStateLive,
      oracleLive,
      oracleStates,
      recentDeposits,
      recentWithdrawals,
      recentStrategies,
      recentSwaps,
      recentIntents,
      parachains,
      protocols,
    ] = await Promise.all([
      readVaultState().catch(() => null),
      readOracleState().catch(() => null),
      this.prisma.oracleState.findMany(),
      this.prisma.deposit.count({ where: { timestamp: { gte: since } } }),
      this.prisma.withdrawal.count({ where: { timestamp: { gte: since } } }),
      this.prisma.strategyExecution.findMany({
        orderBy: { blockNumber: "desc" },
        take: 5,
        select: { destination: true, amount: true, profit: true, success: true },
      }),
      this.prisma.swapExecution.count({ where: { timestamp: { gte: since } } }),
      this.prisma.intentExecution.count({ where: { timestamp: { gte: since } } }),
      this.prisma.parachainConfig.findMany({ where: { allowed: true } }),
      this.prisma.protocolConfig.findMany({ where: { allowed: true } }),
    ]);

    return JSON.stringify(
      {
        // Live RPC state (most accurate)
        vaultLive: vaultStateLive
          ? {
              totalAssets: vaultStateLive.totalAssets.toString(),
              totalSupply: vaultStateLive.totalSupply.toString(),
              paused: vaultStateLive.paused,
              depositCap: vaultStateLive.depositCap.toString(),
              maxDailyLoss: vaultStateLive.maxDailyLoss.toString(),
            }
          : null,
        // Oracle prices
        oracleLive: oracleLive
          ? {
              price: oracleLive.price.toString(),
              decimals: oracleLive.decimals,
              updatedAt: oracleLive.updatedAt.toString(),
              heartbeat: oracleLive.heartbeat.toString(),
            }
          : null,
        // Historical oracle states for all feeds
        oracleFeeds: oracleStates.map((o) => ({
          asset: o.asset,
          price: o.price,
          decimals: o.decimals,
          updatedAt: o.updatedAt,
        })),
        // Recent activity (last 24h)
        activity24h: {
          deposits: recentDeposits,
          withdrawals: recentWithdrawals,
          swaps: recentSwaps,
          intents: recentIntents,
        },
        // Recent strategy outcomes
        recentStrategies: recentStrategies.map((s) => ({
          destination: s.destination,
          amount: s.amount,
          profit: s.profit,
          success: s.success,
        })),
        // Allowed destinations
        allowedParachains: parachains.map((p) => p.parachainId),
        allowedProtocols: protocols.map((p) => p.protocol),
        // Network context
        chain: {
          id: 420420417,
          name: "Polkadot Hub TestNet",
          currency: "PAS",
        },
      },
      null,
      2,
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Internal
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Estimate the idle capital ratio as an integer percentage (0–100).
   * Pure BigInt arithmetic — no Number() precision loss on large values.
   *
   * Heuristic: if totalAssets ≈ totalDeposited - totalWithdrawn,
   * the capital is sitting idle in the vault.
   */
  private _estimateIdleRatio(vaultState: {
    totalAssets: string;
    totalDeposited: string;
    totalWithdrawn: string;
  }): bigint {
    const totalAssets = BigInt(vaultState.totalAssets);
    const totalDeposited = BigInt(vaultState.totalDeposited);
    const totalWithdrawn = BigInt(vaultState.totalWithdrawn);

    if (totalAssets === 0n) return 0n;

    const netDeposited = totalDeposited - totalWithdrawn;
    if (netDeposited <= 0n) return 0n;

    // Scale to avoid BigInt division truncation; cap at 100%
    const ratio = (totalAssets * 100n) / netDeposited;
    return ratio > 100n ? 100n : ratio;
  }
}
