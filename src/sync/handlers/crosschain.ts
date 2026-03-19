// ── Cross-Chain Event Handlers ───────────────────────────
// Processes CrossChainRouter, HyperbridgeAdapter, BifrostAdapter events

import type { PrismaClient } from "@prisma/client";
import type { DecodedEvent } from "../decoder.js";
import { logger } from "../../utils/logger.js";

export async function handleCrossChainEvent(
  prisma: PrismaClient,
  event: DecodedEvent,
): Promise<void> {
  const { eventName, args, txHash, logIndex, blockNumber, timestamp } = event;

  switch (eventName) {
    // ── CrossChainRouter ───────────────────────────────
    case "SatelliteDepositReceived":
      await prisma.crossChainDispatch.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            messageType: "satellite_deposit",
            sourceChain: String(args.chainId),
            destChain: "polkadot_hub",
            sender: String(args.depositor),
            data: `amount=${args.amount},shares=${args.sharesMinted},nonce=${args.nonce}`,
            status: "accepted",
          },
        ],
        skipDuplicates: true,
      });
      logger.info(
        { depositor: args.depositor, amount: String(args.amount) },
        "Satellite deposit received",
      );
      break;

    case "SatelliteWithdrawRequested":
      await prisma.crossChainDispatch.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            messageType: "satellite_withdraw",
            sourceChain: String(args.chainId),
            destChain: "polkadot_hub",
            sender: String(args.withdrawer),
            data: `amount=${args.amount},shares=${args.sharesToBurn},nonce=${args.nonce}`,
            status: "accepted",
          },
        ],
        skipDuplicates: true,
      });
      break;

    case "AssetSyncBroadcast":
      await prisma.crossChainDispatch.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            messageType: "asset_sync",
            sourceChain: "polkadot_hub",
            destChain: "broadcast",
            sender: event.contractAddress,
            data: `totalAssets=${args.globalTotalAssets},totalShares=${args.globalTotalShares},remoteAssets=${args.totalRemoteAssets}`,
            status: "dispatched",
          },
        ],
        skipDuplicates: true,
      });
      break;

    case "StrategyReportBroadcast":
      await prisma.crossChainDispatch.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            messageType: "strategy_report",
            sourceChain: "polkadot_hub",
            destChain: "broadcast",
            sender: event.contractAddress,
            data: `strategyId=${args.strategyId},success=${args.success},returnedAmount=${args.returnedAmount},pnl=${args.pnl}`,
            status: "dispatched",
          },
        ],
        skipDuplicates: true,
      });
      break;

    case "EmergencySyncBroadcast":
      await prisma.crossChainDispatch.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            messageType: "emergency_sync",
            sourceChain: "polkadot_hub",
            destChain: "broadcast",
            sender: event.contractAddress,
            data: `paused=${args.paused},emergencyMode=${args.emergencyMode}`,
            status: "dispatched",
          },
        ],
        skipDuplicates: true,
      });
      break;

    // ── HyperbridgeAdapter (inherited by CrossChainRouter) ──
    case "MessageDispatched":
      await prisma.crossChainDispatch.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            messageType: "ismp_dispatch",
            sourceChain: "polkadot_hub",
            destChain: String(args.dest),
            sender: event.contractAddress,
            data: `bodyLength=${args.bodyLength}`,
            commitment: String(args.commitment),
            status: "dispatched",
          },
        ],
        skipDuplicates: true,
      });
      logger.info({ commitment: args.commitment }, "ISMP message dispatched");
      break;

    case "MessageReceived":
      logger.info(
        { source: args.source, nonce: Number(args.nonce) },
        "ISMP message received",
      );
      break;

    case "MessageTimeout":
      logger.warn(
        { dest: args.dest, nonce: Number(args.nonce) },
        "ISMP message timed out",
      );
      break;

    default:
      logger.debug({ eventName, txHash }, "Unhandled cross-chain event");
      break;
  }
}
