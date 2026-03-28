// ── Cross-Chain Event Handlers ───────────────────────────
// Processes CrossChainRouter, local ISMP host, and XCM precompile events

import type { PrismaClient } from "@prisma/client";
import type { DecodedEvent } from "../decoder.js";
import { pubsub, Topics } from "../../graphql/pubsub.js";
import { fetchTransactionSender } from "../blockscout.js";
import { logger } from "../../utils/logger.js";

type CrossChainDispatchRecord = {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  timestamp: Date;
  messageType: string;
  sourceChain: string;
  destChain: string;
  sender: string;
  data: string;
  commitment?: string;
  status: string;
};

async function recordDispatch(
  prisma: PrismaClient,
  record: CrossChainDispatchRecord,
  originTxHash?: string,
): Promise<void> {
  await prisma.crossChainDispatch.createMany({
    data: [record],
    skipDuplicates: true,
  });

  pubsub.publish(Topics.CROSS_CHAIN_STATUS, {
    originTxHash: originTxHash ?? record.txHash,
  });
}

async function findMatchingDispatch(
  prisma: PrismaClient,
  args: {
    peerChain: string;
    bodyLength: string;
  },
) {
  return prisma.crossChainDispatch.findFirst({
    where: {
      messageType: "ismp_dispatch",
      destChain: args.peerChain,
      data: { contains: `bodyLength=${args.bodyLength}` },
    },
    orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
  });
}

async function findDispatchByCommitment(
  prisma: PrismaClient,
  commitment: string,
) {
  return prisma.crossChainDispatch.findFirst({
    where: {
      commitment,
    },
    orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
  });
}

async function findTxCommitment(
  prisma: PrismaClient,
  txHash: string,
) {
  return prisma.crossChainDispatch.findFirst({
    where: {
      txHash,
      commitment: { not: null },
    },
    orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
  });
}

function hexByteLength(value: string): number {
  if (!value.startsWith("0x")) return value.length;
  return Math.max(0, (value.length - 2) / 2);
}

function readCompactU32(bytes: Uint8Array, offset: number) {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  const mode = first & 0b11;

  if (mode === 0) {
    return { value: first >> 2, bytesRead: 1 };
  }

  if (mode === 1) {
    if (offset + 1 >= bytes.length) return null;
    const encoded = first | (bytes[offset + 1] << 8);
    return { value: encoded >> 2, bytesRead: 2 };
  }

  if (mode === 2) {
    if (offset + 3 >= bytes.length) return null;
    const encoded =
      first |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24);
    return { value: encoded >>> 2, bytesRead: 4 };
  }

  return null;
}

function decodeParachainId(dest: string): string | null {
  if (!dest.startsWith("0x")) return null;

  const bytes = Uint8Array.from(Buffer.from(dest.slice(2), "hex"));
  if (bytes.length < 5) return null;

  const version = bytes[0];
  const parents = bytes[1];
  const interior = bytes[2];
  const firstJunction = bytes[3];

  if (![3, 4, 5].includes(version)) return null;
  if (parents !== 1 || interior !== 1 || firstJunction !== 0) return null;

  const compact = readCompactU32(bytes, 4);
  return compact ? String(compact.value) : null;
}

export async function handleCrossChainEvent(
  prisma: PrismaClient,
  event: DecodedEvent,
): Promise<void> {
  const { eventName, args, txHash, logIndex, blockNumber, timestamp } = event;

  switch (eventName) {
    // ── CrossChainRouter ───────────────────────────────
    case "SatelliteDepositReceived":
      await recordDispatch(prisma, {
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
      });
      logger.info(
        { depositor: args.depositor, amount: String(args.amount) },
        "Satellite deposit received",
      );
      break;

    case "SatelliteWithdrawRequested":
      await recordDispatch(prisma, {
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
      });
      break;

    case "AssetSyncBroadcast":
      await recordDispatch(prisma, {
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
      });
      break;

    case "StrategyReportBroadcast":
      await recordDispatch(prisma, {
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
      });
      break;

    case "EmergencySyncBroadcast":
      await recordDispatch(prisma, {
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
      });
      break;

    // ── HyperbridgeAdapter (inherited by CrossChainRouter) ──
    case "MessageDispatched": {
      const txSender =
        (await fetchTransactionSender(txHash)) ?? event.contractAddress;
      await recordDispatch(prisma, {
        txHash,
        logIndex,
        blockNumber,
        timestamp,
        messageType: "ismp_dispatch",
        sourceChain: "polkadot_hub",
        destChain: String(args.dest),
        sender: txSender,
        data: `bodyLength=${args.bodyLength}`,
        commitment: String(args.commitment),
        status: "dispatched",
      });
      logger.info({ commitment: args.commitment }, "ISMP message dispatched");
      break;
    }

    case "MessageReceived": {
      // Hyperbridge does not emit the commitment on receive, so we correlate
      // the callback to the most recent matching dispatch by peer chain and
      // body length. This is a best-effort bridge between source-chain
      // dispatch events and later router callbacks.
      const matched = await findMatchingDispatch(prisma, {
        peerChain: String(args.source),
        bodyLength: String(args.bodyLength),
      });
      const originTxHash = matched?.txHash ?? txHash;
      await recordDispatch(
        prisma,
        {
          txHash,
          logIndex,
          blockNumber,
          timestamp,
          messageType: "ismp_receive",
          sourceChain: String(args.source),
          destChain: "polkadot_hub",
          sender: matched?.sender ?? event.contractAddress,
          data: `bodyLength=${args.bodyLength},nonce=${args.nonce}`,
          commitment: matched?.commitment ?? undefined,
          status: "executed",
        },
        originTxHash,
      );
      logger.info(
        { source: args.source, nonce: Number(args.nonce) },
        "ISMP message received",
      );
      break;
    }

    case "MessageTimeout": {
      const matched = await findMatchingDispatch(prisma, {
        peerChain: String(args.dest),
        bodyLength: String(args.bodyLength),
      });
      const originTxHash = matched?.txHash ?? txHash;
      await recordDispatch(
        prisma,
        {
          txHash,
          logIndex,
          blockNumber,
          timestamp,
          messageType: "ismp_timeout",
          sourceChain: "polkadot_hub",
          destChain: String(args.dest),
          sender: matched?.sender ?? event.contractAddress,
          data: `bodyLength=${args.bodyLength},nonce=${args.nonce}`,
          commitment: matched?.commitment ?? undefined,
          status: "failed",
        },
        originTxHash,
      );
      logger.warn(
        { dest: args.dest, nonce: Number(args.nonce) },
        "ISMP message timed out",
      );
      break;
    }

    // ── Hyperbridge ISMP host (Polkadot Hub local host surface) ──
    case "PostRequestEvent": {
      const commitmentRecord = await findTxCommitment(prisma, txHash);

      await recordDispatch(prisma, {
        txHash,
        logIndex,
        blockNumber,
        timestamp,
        messageType: "ismp_host_post_request",
        sourceChain: String(args.source),
        destChain: String(args.dest),
        sender: String(args.from),
        data: `nonce=${String(args.nonce)},timeoutTimestamp=${String(args.timeoutTimestamp)},bodyLength=${hexByteLength(String(args.body))},fee=${String(args.fee)},to=${String(args.to)}`,
        commitment: commitmentRecord?.commitment ?? undefined,
        status: "committed",
      });
      logger.info(
        {
          source: String(args.source),
          dest: String(args.dest),
          nonce: String(args.nonce),
        },
        "ISMP host post request committed",
      );
      break;
    }

    case "PostRequestHandled": {
      const commitment = String(args.commitment);
      const matched = await findDispatchByCommitment(prisma, commitment);
      const originTxHash = matched?.txHash ?? txHash;

      await recordDispatch(
        prisma,
        {
          txHash,
          logIndex,
          blockNumber,
          timestamp,
          messageType: "ismp_post_request_handled",
          sourceChain: matched?.destChain ?? "remote",
          destChain: "polkadot_hub",
          sender: matched?.sender ?? event.contractAddress,
          data: `relayer=${String(args.relayer)}`,
          commitment,
          status: "executed",
        },
        originTxHash,
      );
      logger.info(
        { commitment, relayer: String(args.relayer) },
        "ISMP post request handled",
      );
      break;
    }

    case "PostResponseHandled": {
      const commitment = String(args.commitment);
      const matched = await findDispatchByCommitment(prisma, commitment);
      const originTxHash = matched?.txHash ?? txHash;

      await recordDispatch(
        prisma,
        {
          txHash,
          logIndex,
          blockNumber,
          timestamp,
          messageType: "ismp_post_response_handled",
          sourceChain: matched?.destChain ?? "remote",
          destChain: "polkadot_hub",
          sender: matched?.sender ?? event.contractAddress,
          data: `relayer=${String(args.relayer)}`,
          commitment,
          status: "executed",
        },
        originTxHash,
      );
      logger.info(
        { commitment, relayer: String(args.relayer) },
        "ISMP post response handled",
      );
      break;
    }

    case "StateMachineUpdated":
      await recordDispatch(prisma, {
        txHash,
        logIndex,
        blockNumber,
        timestamp,
        messageType: "ismp_state_machine_updated",
        sourceChain: String(args.stateMachineId),
        destChain: "polkadot_hub",
        sender: event.contractAddress,
        data: `height=${String(args.height)}`,
        status: "accepted",
      });
      logger.info(
        {
          stateMachineId: String(args.stateMachineId),
          height: String(args.height),
        },
        "ISMP host state machine updated",
      );
      break;

    // ── Polkadot Hub XCM precompile ─────────────────────
    case "XcmSent": {
      const dest = String(args.dest);
      const parachainId = decodeParachainId(dest);

      await recordDispatch(prisma, {
        txHash,
        logIndex,
        blockNumber,
        timestamp,
        messageType: "xcm_precompile_sent",
        sourceChain: "polkadot_hub",
        destChain: parachainId ?? "xcm",
        sender: String(args.sender),
        data: `dest=${dest},messageLength=${hexByteLength(String(args.message))}`,
        status: "dispatched",
      });
      logger.info(
        {
          sender: String(args.sender),
          destChain: parachainId ?? "xcm",
        },
        "XCM precompile message sent",
      );
      break;
    }

    default:
      logger.debug({ eventName, txHash }, "Unhandled cross-chain event");
      break;
  }
}
