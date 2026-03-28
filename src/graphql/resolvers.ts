// ── GraphQL Resolvers ────────────────────────────────────

import type { PrismaClient } from "@prisma/client";
import { pubsub, Topics } from "./pubsub.js";
import {
  buildPoolAnalytics,
  buildProtocolStats,
  buildTopRoutes,
  filterSwapsForPair,
} from "./analytics.js";
import {
  listCrossChainPipelines,
  normalizeIdentifier,
  resolveCrossChainPipeline,
} from "./crossChain.js";
import { buildPairId } from "../analytics/pairs.js";
import { buildHourlyPriceHistory } from "./priceHistory.js";

interface Context {
  prisma: PrismaClient;
}

interface PaginationArgs {
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function clampLimit(limit?: number): number {
  const l = limit ?? DEFAULT_LIMIT;
  return Math.min(Math.max(1, l), MAX_LIMIT);
}

async function* filterAsyncIterator<T>(
  iterator: AsyncIterator<{ [key: string]: T }>,
  predicate: (value: { [key: string]: T }) => boolean,
): AsyncGenerator<{ [key: string]: T }> {
  while (true) {
    const next = await iterator.next();
    if (next.done) return;
    if (predicate(next.value)) {
      yield next.value;
    }
  }
}

export const resolvers = {
  Query: {
    // ── State ──────────────────────────────────────────
    vaultState: async (_: unknown, __: unknown, { prisma }: Context) => {
      return prisma.vaultState.findFirst();
    },

    oracleState: async (
      _: unknown,
      args: { feedAddress?: string },
      { prisma }: Context,
    ) => {
      if (args.feedAddress) {
        return prisma.oracleState.findUnique({
          where: { feedAddress: args.feedAddress },
        });
      }
      return prisma.oracleState.findFirst();
    },

    oracleStates: async (_: unknown, __: unknown, { prisma }: Context) => {
      return prisma.oracleState.findMany();
    },

    protocolConfigs: async (_: unknown, __: unknown, { prisma }: Context) => {
      return prisma.protocolConfig.findMany();
    },

    parachainConfigs: async (_: unknown, __: unknown, { prisma }: Context) => {
      return prisma.parachainConfig.findMany();
    },

    // ── Historical ─────────────────────────────────────
    deposits: async (
      _: unknown,
      args: PaginationArgs & { owner?: string },
      { prisma }: Context,
    ) => {
      return prisma.deposit.findMany({
        where: args.owner ? { owner: args.owner } : undefined,
        orderBy: { blockNumber: "desc" },
        take: clampLimit(args.limit),
        skip: args.offset ?? 0,
      });
    },

    withdrawals: async (
      _: unknown,
      args: PaginationArgs & { owner?: string },
      { prisma }: Context,
    ) => {
      return prisma.withdrawal.findMany({
        where: args.owner ? { owner: args.owner } : undefined,
        orderBy: { blockNumber: "desc" },
        take: clampLimit(args.limit),
        skip: args.offset ?? 0,
      });
    },

    withdrawalRequests: async (
      _: unknown,
      args: PaginationArgs & { user?: string; fulfilled?: boolean },
      { prisma }: Context,
    ) => {
      return prisma.withdrawalRequest.findMany({
        where: {
          ...(args.user ? { user: args.user } : {}),
          ...(args.fulfilled !== undefined
            ? { fulfilled: args.fulfilled }
            : {}),
        },
        orderBy: { blockNumber: "desc" },
        take: clampLimit(args.limit),
        skip: args.offset ?? 0,
      });
    },

    strategyExecutions: async (
      _: unknown,
      args: PaginationArgs & { executor?: string },
      { prisma }: Context,
    ) => {
      return prisma.strategyExecution.findMany({
        where: args.executor ? { executor: args.executor } : undefined,
        orderBy: { blockNumber: "desc" },
        take: clampLimit(args.limit),
        skip: args.offset ?? 0,
      });
    },

    localSwaps: async (
      _: unknown,
      args: PaginationArgs,
      { prisma }: Context,
    ) => {
      return prisma.localSwap.findMany({
        orderBy: { blockNumber: "desc" },
        take: clampLimit(args.limit),
        skip: args.offset ?? 0,
      });
    },

    intentExecutions: async (
      _: unknown,
      args: PaginationArgs & { solver?: string },
      { prisma }: Context,
    ) => {
      return prisma.intentExecution.findMany({
        where: args.solver ? { solver: args.solver } : undefined,
        orderBy: { blockNumber: "desc" },
        take: clampLimit(args.limit),
        skip: args.offset ?? 0,
      });
    },

    oracleUpdates: async (
      _: unknown,
      args: PaginationArgs & { feed?: string },
      { prisma }: Context,
    ) => {
      return prisma.oracleUpdate.findMany({
        where: args.feed ? { feed: args.feed } : undefined,
        orderBy: { blockNumber: "desc" },
        take: clampLimit(args.limit),
        skip: args.offset ?? 0,
      });
    },

    swapExecutions: async (
      _: unknown,
      args: PaginationArgs,
      { prisma }: Context,
    ) => {
      return prisma.swapExecution.findMany({
        orderBy: { blockNumber: "desc" },
        take: clampLimit(args.limit),
        skip: args.offset ?? 0,
      });
    },

    crossChainDispatches: async (
      _: unknown,
      args: PaginationArgs & {
        status?: string;
        sender?: string;
        txHash?: string;
        commitment?: string;
        messageType?: string;
      },
      { prisma }: Context,
    ) => {
      return prisma.crossChainDispatch.findMany({
        where: {
          ...(args.status ? { status: args.status } : {}),
          ...(args.sender
            ? { sender: { equals: args.sender, mode: "insensitive" } }
            : {}),
          ...(args.txHash ? { txHash: args.txHash } : {}),
          ...(args.commitment ? { commitment: args.commitment } : {}),
          ...(args.messageType ? { messageType: args.messageType } : {}),
        },
        orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
        take: clampLimit(args.limit),
        skip: args.offset ?? 0,
      });
    },

    crossChainPipeline: async (
      _: unknown,
      args: { intentId: string },
      { prisma }: Context,
    ) => resolveCrossChainPipeline(prisma, args.intentId),

    crossChainPipelines: async (
      _: unknown,
      args: { limit?: number; sender?: string; status?: string },
      { prisma }: Context,
    ) =>
      listCrossChainPipelines(prisma, {
        limit: clampLimit(args.limit),
        sender: args.sender,
        status: args.status,
      }),

    bifrostStrategies: async (
      _: unknown,
      args: PaginationArgs,
      { prisma }: Context,
    ) => {
      return prisma.bifrostStrategy.findMany({
        orderBy: { blockNumber: "desc" },
        take: clampLimit(args.limit),
        skip: args.offset ?? 0,
      });
    },

    // ── Aggregates ─────────────────────────────────────
    vaultStats: async (_: unknown, __: unknown, { prisma }: Context) => {
      const [
        totalDeposits,
        totalWithdrawals,
        totalStrategies,
        totalSwaps,
        totalIntents,
        totalCrossChainMessages,
      ] = await Promise.all([
        prisma.deposit.count(),
        prisma.withdrawal.count(),
        prisma.strategyExecution.count(),
        prisma.swapExecution.count(),
        prisma.intentExecution.count(),
        prisma.crossChainDispatch.count(),
      ]);

      return {
        totalDeposits,
        totalWithdrawals,
        totalStrategies,
        totalSwaps,
        totalIntents,
        totalCrossChainMessages,
      };
    },

    userPosition: async (
      _: unknown,
      args: { address: string },
      { prisma }: Context,
    ) => {
      const [deposits, withdrawals, pendingRequests] = await Promise.all([
        prisma.deposit.findMany({
          where: { owner: args.address },
          orderBy: { blockNumber: "desc" },
        }),
        prisma.withdrawal.findMany({
          where: { owner: args.address },
          orderBy: { blockNumber: "desc" },
        }),
        prisma.withdrawalRequest.findMany({
          where: { user: args.address, fulfilled: false },
          orderBy: { blockNumber: "desc" },
        }),
      ]);

      // Sum up totals
      let totalDeposited = 0n;
      for (const d of deposits) totalDeposited += BigInt(d.assets);

      let totalWithdrawn = 0n;
      for (const w of withdrawals) totalWithdrawn += BigInt(w.assets);

      return {
        address: args.address,
        totalDeposited: totalDeposited.toString(),
        totalWithdrawn: totalWithdrawn.toString(),
        depositCount: deposits.length,
        withdrawalCount: withdrawals.length,
        deposits,
        withdrawals,
        pendingRequests,
      };
    },

    // ── Infrastructure ─────────────────────────────────
    syncCursors: async (_: unknown, __: unknown, { prisma }: Context) => {
      return prisma.syncCursor.findMany();
    },

    tokens: async (_: unknown, __: unknown, { prisma }: Context) => {
      return prisma.token.findMany();
    },

    protocolStats: async (_: unknown, __: unknown, { prisma }: Context) => {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [tokens, oracleStates, vaultState, swaps24h, swaps7d, totalSwaps] =
        await Promise.all([
          prisma.token.findMany({
            select: { address: true, symbol: true, decimals: true },
          }),
          prisma.oracleState.findMany({
            select: { asset: true, price: true, decimals: true },
          }),
          prisma.vaultState.findFirst({
            select: { totalAssets: true },
          }),
          prisma.swapExecution.findMany({
            where: { timestamp: { gte: since24h } },
            select: {
              tokenIn: true,
              tokenOut: true,
              amountIn: true,
              amountOut: true,
              recipient: true,
              poolType: true,
              hops: true,
              timestamp: true,
            },
          }),
          prisma.swapExecution.findMany({
            where: { timestamp: { gte: since7d } },
            select: {
              tokenIn: true,
              tokenOut: true,
              amountIn: true,
              amountOut: true,
              recipient: true,
              poolType: true,
              hops: true,
              timestamp: true,
            },
          }),
          prisma.swapExecution.count(),
        ]);

      return buildProtocolStats({
        tokens,
        oracleStates,
        swaps24h,
        swaps7d,
        totalSwaps,
        vaultState,
      });
    },

    topRoutes: async (
      _: unknown,
      args: { limit?: number },
      { prisma }: Context,
    ) => {
      const limit = Math.min(Math.max(1, args.limit ?? 10), 25);
      const [tokens, oracleStates, routes] = await Promise.all([
        prisma.token.findMany({
          select: { address: true, symbol: true, decimals: true },
        }),
        prisma.oracleState.findMany({
          select: { asset: true, price: true, decimals: true },
        }),
        prisma.$queryRaw<
          Array<{
            tokenIn: string;
            tokenOut: string;
            poolType: string;
            hops: number;
            swapCount: number;
            amountInTotal: string;
            amountOutTotal: string;
            lastSwapAt: Date;
          }>
        >`
          SELECT
            "tokenIn",
            "tokenOut",
            "poolType",
            "hops",
            COUNT(*)::int AS "swapCount",
            SUM(("amountIn")::numeric)::text AS "amountInTotal",
            SUM(("amountOut")::numeric)::text AS "amountOutTotal",
            MAX("timestamp") AS "lastSwapAt"
          FROM "swap_executions"
          GROUP BY "tokenIn", "tokenOut", "poolType", "hops"
          ORDER BY COUNT(*) DESC, MAX("timestamp") DESC
          LIMIT ${limit}
        `,
      ]);

      return buildTopRoutes({ routes, tokens, oracleStates });
    },

    poolAnalytics: async (
      _: unknown,
      args: { pair: string; window: string },
      { prisma }: Context,
    ) => {
      const [tokens, oracleStates, swaps] = await Promise.all([
        prisma.token.findMany({
          select: { address: true, symbol: true, decimals: true },
        }),
        prisma.oracleState.findMany({
          select: { asset: true, price: true, decimals: true },
        }),
        prisma.swapExecution.findMany({
          orderBy: [
            { timestamp: "asc" },
            { blockNumber: "asc" },
            { logIndex: "asc" },
          ],
          select: {
            tokenIn: true,
            tokenOut: true,
            amountIn: true,
            amountOut: true,
            recipient: true,
            poolType: true,
            hops: true,
            timestamp: true,
            blockNumber: true,
            logIndex: true,
          },
        }),
      ]);

      const pairSwaps = filterSwapsForPair({
        swaps,
        pair: args.pair,
        tokens,
        window: args.window,
      });

      return buildPoolAnalytics({
        pair: args.pair,
        window: args.window,
        tokens,
        oracleStates,
        swaps: pairSwaps,
      });
    },

    priceHistory: async (
      _: unknown,
      args: { tokenIn: string; tokenOut: string; from: number; to: number },
      { prisma }: Context,
    ) => {
      if (args.from >= args.to) return [];

      // Cap the query window to 90 days to prevent unbounded Prisma result sets.
      const MAX_RANGE_SECONDS = 90 * 24 * 60 * 60;
      if (args.to - args.from > MAX_RANGE_SECONDS) {
        throw new Error(
          "priceHistory: time range exceeds maximum of 90 days",
        );
      }

      const [tokens, swaps] = await Promise.all([
        prisma.token.findMany(),
        prisma.priceHistoryPoint.findMany({
          where: {
            pairId: buildPairId(args.tokenIn, args.tokenOut),
            timestamp: {
              gte: new Date(args.from * 1000),
              lt: new Date(args.to * 1000),
            },
          },
          orderBy: [
            { timestamp: "asc" },
            { blockNumber: "asc" },
            { logIndex: "asc" },
          ],
          select: {
            tokenIn: true,
            tokenOut: true,
            amountIn: true,
            amountOut: true,
            timestamp: true,
            blockNumber: true,
            logIndex: true,
          },
        }),
      ]);

      const tokenMap = new Map(
        tokens.map((token) => [token.address.toLowerCase(), token]),
      );

      return buildHourlyPriceHistory({
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        tokenInDecimals: tokenMap.get(args.tokenIn.toLowerCase())?.decimals,
        tokenOutDecimals: tokenMap.get(args.tokenOut.toLowerCase())?.decimals,
        from: args.from,
        to: args.to,
        swaps,
      });
    },

    // ── LP ─────────────────────────────────────────────
    lpPools: async (_: unknown, __: unknown, { prisma }: Context) =>
      prisma.lpPoolState.findMany({ orderBy: { updatedAtBlock: "desc" } }),

    lpPool: async (
      _: unknown,
      { pair }: { pair: string },
      { prisma }: Context,
    ) => prisma.lpPoolState.findUnique({ where: { pair } }),

    lpMints: async (
      _: unknown,
      { pair, limit }: { pair?: string; limit?: number },
      { prisma }: Context,
    ) =>
      prisma.lpMint.findMany({
        where: pair ? { pair } : undefined,
        orderBy: { blockNumber: "desc" },
        take: limit ?? 50,
      }),

    lpBurns: async (
      _: unknown,
      { pair, limit }: { pair?: string; limit?: number },
      { prisma }: Context,
    ) =>
      prisma.lpBurn.findMany({
        where: pair ? { pair } : undefined,
        orderBy: { blockNumber: "desc" },
        take: limit ?? 50,
      }),
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Subscriptions — real-time event feed (WebSocket)
  // ─────────────────────────────────────────────────────────────────────

  Subscription: {
    depositAdded: {
      subscribe: () => pubsub.asyncIterator(Topics.DEPOSIT_ADDED),
      resolve: (payload: Record<string, unknown>) =>
        payload[Topics.DEPOSIT_ADDED],
    },
    withdrawalAdded: {
      subscribe: () => pubsub.asyncIterator(Topics.WITHDRAWAL_ADDED),
      resolve: (payload: Record<string, unknown>) =>
        payload[Topics.WITHDRAWAL_ADDED],
    },
    strategyExecuted: {
      subscribe: () => pubsub.asyncIterator(Topics.STRATEGY_EXECUTED),
      resolve: (payload: Record<string, unknown>) =>
        payload[Topics.STRATEGY_EXECUTED],
    },
    intentExecuted: {
      subscribe: () => pubsub.asyncIterator(Topics.INTENT_EXECUTED),
      resolve: (payload: Record<string, unknown>) =>
        payload[Topics.INTENT_EXECUTED],
    },
    oracleUpdated: {
      subscribe: () => pubsub.asyncIterator(Topics.ORACLE_UPDATED),
      resolve: (payload: Record<string, unknown>) =>
        payload[Topics.ORACLE_UPDATED],
    },
    swapExecuted: {
      subscribe: () => pubsub.asyncIterator(Topics.SWAP_EXECUTED),
      resolve: (payload: Record<string, unknown>) =>
        payload[Topics.SWAP_EXECUTED],
    },
    crossChainStatus: {
      subscribe: (_: unknown, args: { txHash: string }) =>
        filterAsyncIterator(
          pubsub.asyncIterator<{ originTxHash: string }>(
            Topics.CROSS_CHAIN_STATUS,
          ),
          (payload) =>
            normalizeIdentifier(payload[Topics.CROSS_CHAIN_STATUS]?.originTxHash) ===
            normalizeIdentifier(args.txHash),
        ),
      resolve: async (
        payload: Record<string, { originTxHash: string }>,
        _args: { txHash: string },
        { prisma }: Context,
      ) =>
        resolveCrossChainPipeline(
          prisma,
          payload[Topics.CROSS_CHAIN_STATUS]?.originTxHash ?? "",
        ),
    },
    lpMint: {
      subscribe: () => pubsub.asyncIterator(Topics.LP_MINT),
      resolve: (payload: Record<string, unknown>) => payload[Topics.LP_MINT],
    },
    lpBurn: {
      subscribe: () => pubsub.asyncIterator(Topics.LP_BURN),
      resolve: (payload: Record<string, unknown>) => payload[Topics.LP_BURN],
    },
  },
};
