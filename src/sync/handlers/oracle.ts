// ── Oracle Event Handlers ────────────────────────────────
// Processes KeeperOracle + OracleRegistry events → Prisma writes

import type { PrismaClient } from "@prisma/client";
import type { DecodedEvent } from "../decoder.js";
import { logger } from "../../utils/logger.js";

export async function handleOracleEvent(
  prisma: PrismaClient,
  event: DecodedEvent,
): Promise<void> {
  const { eventName, args, txHash, logIndex, blockNumber, timestamp } = event;

  switch (eventName) {
    // ── KeeperOracle ───────────────────────────────────
    case "PriceUpdated":
      // Historical record
      await prisma.oracleUpdate.upsert({
        where: { txHash_logIndex: { txHash, logIndex } },
        create: {
          txHash,
          logIndex,
          blockNumber,
          timestamp,
          feed: event.contractAddress,
          price: String(args.answer),
          roundId: Number(args.roundId),
          updater: String(args.updater),
        },
        update: {},
      });

      // Update current state
      await prisma.oracleState.upsert({
        where: { feedAddress: event.contractAddress },
        create: {
          feedAddress: event.contractAddress,
          asset: "DOT",
          price: String(args.answer),
          roundId: Number(args.roundId),
          updatedAtBlock: blockNumber,
        },
        update: {
          price: String(args.answer),
          roundId: Number(args.roundId),
          updatedAtBlock: blockNumber,
        },
      });

      logger.info(
        { price: String(args.answer), roundId: Number(args.roundId) },
        "Oracle price updated",
      );
      break;

    case "HeartbeatUpdated":
      await prisma.oracleState.updateMany({
        where: { feedAddress: event.contractAddress },
        data: {
          heartbeat: Number(args.newHeartbeat),
          updatedAtBlock: blockNumber,
        },
      });
      break;

    // ── OracleRegistry ─────────────────────────────────
    case "FeedSet":
      await prisma.oracleState.upsert({
        where: { feedAddress: String(args.oracle) },
        create: {
          feedAddress: String(args.oracle),
          asset: String(args.asset),
          price: "0",
          heartbeat: Number(args.heartbeat),
          updatedAtBlock: blockNumber,
        },
        update: {
          asset: String(args.asset),
          heartbeat: Number(args.heartbeat),
          updatedAtBlock: blockNumber,
        },
      });
      logger.info(
        { asset: args.asset, oracle: args.oracle },
        "Oracle feed set",
      );
      break;

    case "FeedDisabled":
      logger.info({ asset: args.asset }, "Oracle feed disabled");
      break;

    case "FeedEnabled":
      logger.info({ asset: args.asset }, "Oracle feed enabled");
      break;

    default:
      logger.debug({ eventName, txHash }, "Unhandled oracle event");
      break;
  }
}
