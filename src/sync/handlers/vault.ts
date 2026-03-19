// ── Vault Event Handlers ─────────────────────────────────
// Processes ObidotVault + ERC4626 events → Prisma writes.
// After Deposit/Withdraw events, triggers a live RPC refresh of VaultState
// so the agent always sees accurate totalAssets/totalSupply.

import type { PrismaClient } from "@prisma/client";
import type { DecodedEvent } from "../decoder.js";
import { readVaultState } from "../rpc.js";
import { pubsub, Topics } from "../../graphql/pubsub.js";
import { logger } from "../../utils/logger.js";

export async function handleVaultEvent(
  prisma: PrismaClient,
  event: DecodedEvent,
): Promise<void> {
  const { eventName, args, txHash, logIndex, blockNumber, timestamp } = event;

  switch (eventName) {
    // ── ERC-4626 ───────────────────────────────────────
    case "Deposit":
      await prisma.deposit.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            sender: String(args.sender),
            owner: String(args.owner),
            assets: String(args.assets),
            shares: String(args.shares),
          },
        ],
        skipDuplicates: true,
      });
      // Refresh VaultState from live RPC so totalAssets/totalSupply stay accurate
      await refreshVaultState(prisma, event.contractAddress, blockNumber);
      // Emit real-time subscription event
      pubsub.publish(Topics.DEPOSIT_ADDED, {
        txHash,
        owner: String(args.owner),
        assets: String(args.assets),
        shares: String(args.shares),
        sender: String(args.sender),
        blockNumber,
        timestamp,
        logIndex,
        id: `${txHash}-${logIndex}`,
      });
      logger.info(
        { txHash, owner: args.owner, assets: String(args.assets) },
        "Deposit indexed",
      );
      break;

    case "Withdraw":
      await prisma.withdrawal.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            sender: String(args.sender),
            receiver: String(args.receiver),
            owner: String(args.owner),
            assets: String(args.assets),
            shares: String(args.shares),
          },
        ],
        skipDuplicates: true,
      });
      // Refresh VaultState from live RPC after withdrawal
      await refreshVaultState(prisma, event.contractAddress, blockNumber);
      pubsub.publish(Topics.WITHDRAWAL_ADDED, {
        txHash,
        owner: String(args.owner),
        receiver: String(args.receiver),
        assets: String(args.assets),
        shares: String(args.shares),
        sender: String(args.sender),
        blockNumber,
        timestamp,
        logIndex,
        id: `${txHash}-${logIndex}`,
      });
      logger.info(
        { txHash, owner: args.owner, assets: String(args.assets) },
        "Withdrawal indexed",
      );
      break;

    // ── Withdrawal Queue ───────────────────────────────
    case "WithdrawalQueued":
      await prisma.withdrawalRequest.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            user: String(args.owner),
            shares: String(args.shares),
            requestId: Number(args.requestId),
            fulfilled: false,
          },
        ],
        skipDuplicates: true,
      });
      logger.info({ requestId: Number(args.requestId) }, "Withdrawal queued");
      break;

    case "WithdrawalFulfilled":
      await prisma.withdrawalRequest.updateMany({
        where: { requestId: Number(args.requestId) },
        data: { fulfilled: true },
      });
      logger.info(
        { requestId: Number(args.requestId) },
        "Withdrawal fulfilled",
      );
      break;

    case "WithdrawalCancelled":
      // We just log it — the request stays in the DB for history
      logger.info(
        { requestId: Number(args.requestId) },
        "Withdrawal cancelled",
      );
      break;

    // ── Strategy ───────────────────────────────────────
    case "StrategyExecuted":
      await prisma.strategyExecution.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            strategyId: String(args.strategyId),
            executor: String(args.strategist),
            destination: "parachain",
            targetChain: String(args.targetParachain),
            protocol: String(args.targetProtocol),
            amount: String(args.amount),
            profit: "0",
            success: true,
          },
        ],
        skipDuplicates: true,
      });
      logger.info({ strategyId: String(args.strategyId) }, "Strategy executed");
      break;

    case "StrategyOutcomeReported": {
      // Update the matching strategy execution with outcome
      const strategyId = String(args.strategyId);
      const pnl = String(args.pnl);
      const success = Number(args.newStatus) === 2; // StrategyStatus.Succeeded = 2
      await prisma.strategyExecution.updateMany({
        where: { strategyId },
        data: { profit: pnl, success },
      });
      logger.info({ strategyId, pnl, success }, "Strategy outcome reported");
      break;
    }

    // ── Local Swap ─────────────────────────────────────
    case "LocalSwapExecuted":
      await prisma.localSwap.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            tokenIn: String(args.tokenIn),
            tokenOut: String(args.tokenOut),
            amountIn: String(args.amountIn),
            amountOut: String(args.amountOut),
            executor: String(args.strategist),
          },
        ],
        skipDuplicates: true,
      });
      logger.info(
        { amountIn: String(args.amountIn), amountOut: String(args.amountOut) },
        "Local swap indexed",
      );
      break;

    // ── Intent ─────────────────────────────────────────
    case "IntentExecuted":
      await prisma.intentExecution.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            solver: String(args.strategist),
            intentHash: "",
            tokenIn: "",
            tokenOut: "",
            amountIn: "0",
            minAmountOut: "0",
            destination: "unknown",
            targetChain: "0",
            deadline: timestamp,
            nonce: Number(args.nonce),
          },
        ],
        skipDuplicates: true,
      });
      logger.info({ nonce: Number(args.nonce) }, "Intent executed");
      break;

    // ── Config Updates → State Tables ──────────────────
    case "ParachainWhitelistUpdated":
      await prisma.parachainConfig.upsert({
        where: { parachainId: Number(args.parachainId) },
        create: {
          parachainId: Number(args.parachainId),
          allowed: Boolean(args.allowed),
          updatedAtBlock: blockNumber,
        },
        update: {
          allowed: Boolean(args.allowed),
          updatedAtBlock: blockNumber,
        },
      });
      break;

    case "ProtocolWhitelistUpdated":
      await prisma.protocolConfig.upsert({
        where: { protocol: String(args.protocol) },
        create: {
          protocol: String(args.protocol),
          allowed: Boolean(args.allowed),
          updatedAtBlock: blockNumber,
        },
        update: {
          allowed: Boolean(args.allowed),
          updatedAtBlock: blockNumber,
        },
      });
      break;

    case "ExposureCapUpdated":
      await prisma.protocolConfig.upsert({
        where: { protocol: String(args.protocol) },
        create: {
          protocol: String(args.protocol),
          exposureCap: String(args.newCap),
          updatedAtBlock: blockNumber,
        },
        update: {
          exposureCap: String(args.newCap),
          updatedAtBlock: blockNumber,
        },
      });
      break;

    case "DepositCapUpdated":
      await prisma.vaultState.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          address: event.contractAddress,
          depositCap: String(args.newCap),
          updatedAtBlock: blockNumber,
        },
        update: {
          depositCap: String(args.newCap),
          updatedAtBlock: blockNumber,
        },
      });
      break;

    case "DailyLossThresholdUpdated":
      await prisma.vaultState.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          address: event.contractAddress,
          maxDailyLoss: String(args.newThreshold),
          updatedAtBlock: blockNumber,
        },
        update: {
          maxDailyLoss: String(args.newThreshold),
          updatedAtBlock: blockNumber,
        },
      });
      break;

    case "SwapRouterUpdated":
      await prisma.vaultState.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          address: event.contractAddress,
          swapRouter: String(args.newRouter),
          updatedAtBlock: blockNumber,
        },
        update: {
          swapRouter: String(args.newRouter),
          updatedAtBlock: blockNumber,
        },
      });
      break;

    case "EmergencyModeToggled":
      await prisma.vaultState.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          address: event.contractAddress,
          paused: Boolean(args.enabled),
          updatedAtBlock: blockNumber,
        },
        update: {
          paused: Boolean(args.enabled),
          updatedAtBlock: blockNumber,
        },
      });
      break;

    default:
      logger.debug(
        { eventName, txHash },
        "Unhandled vault event (logged only)",
      );
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Refresh VaultState from a live RPC call and upsert into the DB.
 * Called after any event that changes totalAssets or totalSupply so the
 * agent always has accurate accounting when it wakes up.
 * Errors are swallowed — the event itself is already persisted.
 */
async function refreshVaultState(
  prisma: PrismaClient,
  contractAddress: string,
  blockNumber: number,
): Promise<void> {
  try {
    const live = await readVaultState();
    await prisma.vaultState.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        address: contractAddress,
        totalAssets: live.totalAssets.toString(),
        totalSupply: live.totalSupply.toString(),
        paused: live.paused,
        depositCap: live.depositCap.toString(),
        maxDailyLoss: live.maxDailyLoss.toString(),
        totalDeposited: live.totalDeposited.toString(),
        totalWithdrawn: live.totalWithdrawn.toString(),
        updatedAtBlock: blockNumber,
      },
      update: {
        totalAssets: live.totalAssets.toString(),
        totalSupply: live.totalSupply.toString(),
        paused: live.paused,
        depositCap: live.depositCap.toString(),
        maxDailyLoss: live.maxDailyLoss.toString(),
        totalDeposited: live.totalDeposited.toString(),
        totalWithdrawn: live.totalWithdrawn.toString(),
        updatedAtBlock: blockNumber,
      },
    });
    logger.debug({ blockNumber }, "VaultState refreshed from RPC");
  } catch (err) {
    logger.warn({ err }, "VaultState RPC refresh failed (non-fatal)");
  }
}
