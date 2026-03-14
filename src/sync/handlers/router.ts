// ── Router Event Handlers ────────────────────────────────
// Processes SwapRouter events → Prisma writes

import type { PrismaClient } from "@prisma/client";
import type { DecodedEvent } from "../decoder.js";
import { pubsub, Topics } from "../../graphql/pubsub.js";
import { logger } from "../../utils/logger.js";

/** PoolType enum from ISwapRouter.sol */
const POOL_TYPE_NAMES: Record<number, string> = {
  0: "HydrationOmnipool",
  1: "AssetHubPair",
  2: "BifrostDEX",
};

export async function handleRouterEvent(
  prisma: PrismaClient,
  event: DecodedEvent,
): Promise<void> {
  const { eventName, args, txHash, logIndex, blockNumber, timestamp } = event;

  switch (eventName) {
    case "Swapped":
      await prisma.swapExecution.upsert({
        where: { txHash_logIndex: { txHash, logIndex } },
        create: {
          txHash,
          logIndex,
          blockNumber,
          timestamp,
          tokenIn: String(args.tokenIn),
          tokenOut: String(args.tokenOut),
          amountIn: String(args.amountIn),
          amountOut: String(args.amountOut),
          recipient: String(args.sender),
          poolType:
            POOL_TYPE_NAMES[Number(args.poolType)] ??
            `unknown(${args.poolType})`,
          hops: 1,
        },
        update: {},
      });
      logger.info(
        {
          tokenIn: args.tokenIn,
          tokenOut: args.tokenOut,
          amountIn: String(args.amountIn),
          amountOut: String(args.amountOut),
        },
        "Swap indexed",
      );

      // Emit real-time subscription event
      pubsub.publish(Topics.SWAP_EXECUTED, {
        txHash,
        logIndex,
        blockNumber,
        timestamp,
        tokenIn: String(args.tokenIn),
        tokenOut: String(args.tokenOut),
        amountIn: String(args.amountIn),
        amountOut: String(args.amountOut),
        recipient: String(args.sender),
        poolType:
          POOL_TYPE_NAMES[Number(args.poolType)] ?? `unknown(${args.poolType})`,
        id: `${txHash}-${logIndex}`,
      });
      break;

    case "AdapterSet":
      logger.info(
        {
          poolType:
            POOL_TYPE_NAMES[Number(args.poolType)] ?? String(args.poolType),
          adapter: args.adapter,
        },
        "Adapter set",
      );
      break;

    default:
      logger.debug({ eventName, txHash }, "Unhandled router event");
      break;
  }
}
