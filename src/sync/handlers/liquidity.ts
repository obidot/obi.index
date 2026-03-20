// ── Liquidity Pair Event Handlers ─────────────────────────
// Processes LiquidityPair events → Prisma writes + pubsub publish.
// LiquidityRouter has no events; all LP data comes from the pairs.

import type { PrismaClient } from "@prisma/client";
import type { DecodedEvent } from "../decoder.js";
import { pubsub, Topics } from "../../graphql/pubsub.js";
import { logger } from "../../utils/logger.js";

export async function handleLiquidityPairEvent(
  prisma: PrismaClient,
  event: DecodedEvent,
): Promise<void> {
  const { eventName, args, txHash, logIndex, blockNumber, timestamp } = event;
  const pairAddress = event.contractAddress;

  switch (eventName) {
    case "Mint":
      await prisma.lpMint.createMany({
        data: [{
          txHash,
          logIndex,
          blockNumber,
          timestamp,
          pair: pairAddress,
          sender: String(args.sender),
          amount0: String(args.amount0),
          amount1: String(args.amount1),
        }],
        skipDuplicates: true,
      });
      logger.info(
        { pair: pairAddress, amount0: String(args.amount0), amount1: String(args.amount1) },
        "LP Mint indexed",
      );
      pubsub.publish(Topics.LP_MINT, {
        id: `${txHash}-${logIndex}`,
        txHash,
        logIndex,
        blockNumber,
        timestamp,
        pair: pairAddress,
        sender: String(args.sender),
        amount0: String(args.amount0),
        amount1: String(args.amount1),
      });
      break;

    case "Burn":
      await prisma.lpBurn.createMany({
        data: [{
          txHash,
          logIndex,
          blockNumber,
          timestamp,
          pair: pairAddress,
          sender: String(args.sender),
          to: String(args.to),
          amount0: String(args.amount0),
          amount1: String(args.amount1),
        }],
        skipDuplicates: true,
      });
      logger.info(
        { pair: pairAddress, amount0: String(args.amount0), amount1: String(args.amount1) },
        "LP Burn indexed",
      );
      pubsub.publish(Topics.LP_BURN, {
        id: `${txHash}-${logIndex}`,
        txHash,
        logIndex,
        blockNumber,
        timestamp,
        pair: pairAddress,
        sender: String(args.sender),
        to: String(args.to),
        amount0: String(args.amount0),
        amount1: String(args.amount1),
      });
      break;

    case "Sync":
      await prisma.lpSync.createMany({
        data: [{
          txHash,
          logIndex,
          blockNumber,
          timestamp,
          pair: pairAddress,
          reserve0: String(args.reserve0),
          reserve1: String(args.reserve1),
        }],
        skipDuplicates: true,
      });
      // Upsert latest state snapshot
      await prisma.lpPoolState.upsert({
        where: { pair: pairAddress },
        create: {
          pair: pairAddress,
          token0: "",
          token1: "",
          reserve0: String(args.reserve0),
          reserve1: String(args.reserve1),
          updatedAtBlock: blockNumber,
        },
        update: {
          reserve0: String(args.reserve0),
          reserve1: String(args.reserve1),
          updatedAtBlock: blockNumber,
        },
      });
      logger.debug(
        { pair: pairAddress, reserve0: String(args.reserve0), reserve1: String(args.reserve1) },
        "LP Sync indexed",
      );
      break;

    case "Swap":
      // Direct pair swaps (not via SwapRouter) — log only for now
      logger.info(
        {
          pair: pairAddress,
          amount0In: String(args.amount0In),
          amount1In: String(args.amount1In),
          amount0Out: String(args.amount0Out),
          amount1Out: String(args.amount1Out),
        },
        "LP pair Swap (direct)",
      );
      break;

    default:
      logger.debug({ eventName, txHash, pair: pairAddress }, "Unhandled LP pair event");
      break;
  }
}
