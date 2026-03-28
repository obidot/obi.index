// ── Router Event Handlers ────────────────────────────────
// Processes SwapRouter events → Prisma writes

import type { PrismaClient } from "@prisma/client";
import type { DecodedEvent } from "../decoder.js";
import { pubsub, Topics } from "../../graphql/pubsub.js";
import { buildPairId } from "../../analytics/pairs.js";
import { logger } from "../../utils/logger.js";

/** PoolType enum from ISwapRouter.sol (matches Phase 17 9-slot registry) */
const POOL_TYPE_NAMES: Record<number, string> = {
  0: "HydrationOmnipool",
  1: "AssetHubPair",
  2: "BifrostDEX",
  3: "UniswapV2",
  4: "MockBridge",
  5: "RelayTeleport",
  6: "Karura",
  7: "Moonbeam",
  8: "Interlay",
  9: "Chainflip",
};

export async function handleRouterEvent(
  prisma: PrismaClient,
  event: DecodedEvent,
): Promise<void> {
  const { eventName, args, txHash, logIndex, blockNumber, timestamp } = event;

  switch (eventName) {
    case "Swapped":
      {
      const tokenIn = String(args.tokenIn);
      const tokenOut = String(args.tokenOut);
      const amountIn = String(args.amountIn);
      const amountOut = String(args.amountOut);
      const recipient = String(args.sender);
      const poolType =
        POOL_TYPE_NAMES[Number(args.poolType)] ?? `unknown(${args.poolType})`;

      // createMany with skipDuplicates generates `INSERT ... ON CONFLICT DO NOTHING`
      // — truly atomic, cannot throw P2002 unlike upsert({ update: {} }).
      await prisma.$transaction([
        prisma.swapExecution.createMany({
          data: [
            {
              txHash,
              logIndex,
              blockNumber,
              timestamp,
              tokenIn,
              tokenOut,
              amountIn,
              amountOut,
              recipient,
              poolType,
              hops: 1,
            },
          ],
          skipDuplicates: true,
        }),
        prisma.priceHistoryPoint.createMany({
          data: [
            {
              pairId: buildPairId(tokenIn, tokenOut),
              txHash,
              logIndex,
              blockNumber,
              timestamp,
              tokenIn,
              tokenOut,
              amountIn,
              amountOut,
            },
          ],
          skipDuplicates: true,
        }),
      ]);
      logger.info(
        {
          tokenIn,
          tokenOut,
          amountIn,
          amountOut,
        },
        "Swap indexed",
      );

      // Emit real-time subscription event
      pubsub.publish(Topics.SWAP_EXECUTED, {
        txHash,
        logIndex,
        blockNumber,
        timestamp,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        recipient,
        poolType,
        id: `${txHash}-${logIndex}`,
      });
      break;
      }

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
