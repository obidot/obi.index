// ── GraphQL Resolvers ────────────────────────────────────

import type { PrismaClient } from "@prisma/client";
import { pubsub, Topics } from "./pubsub.js";

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
      args: PaginationArgs & { status?: string },
      { prisma }: Context,
    ) => {
      return prisma.crossChainDispatch.findMany({
        where: args.status ? { status: args.status } : undefined,
        orderBy: { blockNumber: "desc" },
        take: clampLimit(args.limit),
        skip: args.offset ?? 0,
      });
    },

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
  },
};
