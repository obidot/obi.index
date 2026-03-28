// ── Executor Event Handlers ──────────────────────────────
// Processes XCMExecutor + HyperExecutor events

import type { PrismaClient } from "@prisma/client";
import type { DecodedEvent } from "../decoder.js";
import { pubsub, Topics } from "../../graphql/pubsub.js";
import { fetchTransactionSender } from "../blockscout.js";
import { logger } from "../../utils/logger.js";

type ExecutorDispatchRecord = {
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

async function recordExecutorDispatch(
  prisma: PrismaClient,
  record: ExecutorDispatchRecord,
): Promise<void> {
  await prisma.crossChainDispatch.createMany({
    data: [record],
    skipDuplicates: true,
  });

  pubsub.publish(Topics.CROSS_CHAIN_STATUS, {
    originTxHash: record.txHash,
  });
}

async function findExecutorDispatchByTxHash(
  prisma: PrismaClient,
  txHash: string,
  messageType: string,
) {
  return prisma.crossChainDispatch.findFirst({
    where: {
      txHash,
      messageType,
    },
    orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
  });
}

function byteLength(value: unknown): number {
  if (typeof value !== "string") return 0;
  return value.startsWith("0x")
    ? Math.max((value.length - 2) / 2, 0)
    : value.length;
}

export async function handleExecutorEvent(
  prisma: PrismaClient,
  event: DecodedEvent,
): Promise<void> {
  const { eventName, args, txHash, logIndex, blockNumber, timestamp } = event;
  const txSender =
    (await fetchTransactionSender(txHash)) ?? event.contractAddress;

  switch (eventName) {
    case "Dispatched": {
      const messageType =
        event.contractName === "HyperExecutor"
          ? "hyper_executor_dispatch"
          : "xcm_executor_dispatch";
      const destChain =
        event.contractName === "HyperExecutor" ? "hyperbridge" : "xcm";

      await recordExecutorDispatch(prisma, {
        txHash,
        logIndex,
        blockNumber,
        timestamp,
        messageType,
        sourceChain: "polkadot_hub",
        destChain,
        sender: txSender,
        data: `messageId=${args.messageId},expectedOut=${args.expectedOut}`,
        status: "dispatched",
      });

      logger.info(
        {
          messageId: Number(args.messageId),
          expectedOut: String(args.expectedOut),
          executor: event.contractName,
        },
        "Executor dispatched",
      );
      break;
    }

    case "Committed": {
      const commitment = String(args.commitment);
      const messageId = String(args.messageId);

      await prisma.crossChainDispatch.updateMany({
        where: {
          txHash,
          commitment: null,
          messageType: {
            in: ["hyper_executor_dispatch", "ismp_host_post_request"],
          },
        },
        data: {
          commitment,
        },
      });

      await recordExecutorDispatch(prisma, {
        txHash,
        logIndex,
        blockNumber,
        timestamp,
        messageType: "hyper_executor_commitment",
        sourceChain: "polkadot_hub",
        destChain: "hyperbridge",
        sender: txSender,
        data: `messageId=${messageId}`,
        commitment,
        status: "committed",
      });

      logger.info({ messageId, commitment }, "Hyper executor commitment indexed");
      break;
    }

    case "XcmSent": {
      const matched = await findExecutorDispatchByTxHash(
        prisma,
        txHash,
        "xcm_executor_dispatch",
      );

      await recordExecutorDispatch(prisma, {
        txHash,
        logIndex,
        blockNumber,
        timestamp,
        messageType: "xcm_precompile_sent",
        sourceChain: "polkadot_hub",
        destChain: "xcm",
        sender: matched?.sender ?? String(args.sender ?? txSender),
        data: `precompileSender=${String(args.sender)},destLength=${byteLength(args.dest)},messageLength=${byteLength(args.message)}`,
        status: "dispatched",
      });

      logger.info(
        {
          precompileSender: String(args.sender),
          destLength: byteLength(args.dest),
          messageLength: byteLength(args.message),
        },
        "XCM precompile send indexed",
      );
      break;
    }

    case "WeightLimitsUpdated":
      logger.info(
        {
          maxRefTime: String(args.maxRefTime),
          maxProofSize: String(args.maxProofSize),
        },
        "XCM weight limits updated",
      );
      break;

    case "ChainRegistered":
      logger.info(
        {
          chainIndex: Number(args.chainIndex),
          chainId: args.chainId,
        },
        "Hyper chain registered",
      );
      break;

    default:
      logger.debug({ eventName, txHash }, "Unhandled executor event");
      break;
  }
}

/** BifrostAdapter events */
export async function handleBifrostEvent(
  prisma: PrismaClient,
  event: DecodedEvent,
): Promise<void> {
  const { eventName, args, txHash, logIndex, blockNumber, timestamp } = event;

  switch (eventName) {
    case "BifrostStrategyDispatched": {
      const BIFROST_STRATEGY_TYPES: Record<number, string> = {
        0: "mint_vtoken",
        1: "redeem_vtoken",
        2: "swap",
        3: "add_liquidity",
        4: "remove_liquidity",
        5: "farm_deposit",
        6: "farm_withdraw",
        7: "farm_claim",
      };

      await prisma.bifrostStrategy.createMany({
        data: [
          {
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            strategyType:
              BIFROST_STRATEGY_TYPES[Number(args.strategyType)] ??
              `unknown(${args.strategyType})`,
            tokenIn: "",
            amount: String(args.amount),
            xcmFee: "0",
            caller: event.contractAddress,
          },
        ],
        skipDuplicates: true,
      });
      logger.info(
        { strategyId: String(args.strategyId), type: args.strategyType },
        "Bifrost strategy dispatched",
      );
      break;
    }

    default:
      logger.debug({ eventName, txHash }, "Unhandled Bifrost event");
      break;
  }
}
