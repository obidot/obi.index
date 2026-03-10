// ── Executor Event Handlers ──────────────────────────────
// Processes XCMExecutor + HyperExecutor events

import type { PrismaClient } from "@prisma/client";
import type { DecodedEvent } from "../decoder.js";
import { logger } from "../../utils/logger.js";

export async function handleExecutorEvent(
  _prisma: PrismaClient,
  event: DecodedEvent,
): Promise<void> {
  const { eventName, args, txHash } = event;

  switch (eventName) {
    case "Dispatched":
      logger.info(
        {
          messageId: Number(args.messageId),
          expectedOut: String(args.expectedOut),
          executor: event.contractName,
        },
        "Executor dispatched",
      );
      // Executor dispatch events are correlated with StrategyExecuted
      // via the same tx — no separate table needed
      break;

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

      await prisma.bifrostStrategy.upsert({
        where: { txHash_logIndex: { txHash, logIndex } },
        create: {
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
        update: {},
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
