// ── run-indexer.ts ───────────────────────────────────────
// Standalone CLI poller — runs one poll cycle (or a continuous loop)
// without starting the full GraphQL server.
//
// Usage:
//   npm run indexer              # run one cycle then exit
//   npm run indexer -- --watch   # run continuously (respects POLL_INTERVAL_MS)
//
// Environment variables (same as server):
//   DATABASE_URL, RPC_URL, BLOCKSCOUT_URL, POLL_INTERVAL_MS, LOG_LEVEL

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { POLL_INTERVAL_MS } from "../src/config/constants.js";
import { Poller } from "../src/sync/poller.js";
import { logger } from "../src/utils/logger.js";

config();

// ── Parse args ──────────────────────────────────────────

const args = process.argv.slice(2);
const watchMode = args.includes("--watch") || args.includes("-w");
const cyclesArg = args.find((a) => a.startsWith("--cycles="));
const maxCycles = cyclesArg ? parseInt(cyclesArg.split("=")[1]!, 10) : 1;

// ── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  await prisma.$connect();

  logger.info(
    {
      mode: watchMode ? "watch" : "single",
      cycles: watchMode ? "∞" : maxCycles,
      pollIntervalMs: POLL_INTERVAL_MS,
    },
    "run-indexer starting",
  );

  const poller = new Poller(prisma);

  if (watchMode) {
    // ── Continuous mode: run until SIGINT ──────────────
    poller.start();

    logger.info(
      { intervalMs: POLL_INTERVAL_MS },
      "Watch mode — press Ctrl+C to stop",
    );

    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        logger.info("SIGINT received — stopping poller");
        poller.stop();
        resolve();
      });
      process.on("SIGTERM", () => {
        logger.info("SIGTERM received — stopping poller");
        poller.stop();
        resolve();
      });
    });
  } else {
    // ── Single / N-cycle mode: poll then exit ──────────
    for (let i = 1; i <= maxCycles; i++) {
      logger.info({ cycle: i, of: maxCycles }, "Running poll cycle");
      await poller.poll();

      if (i < maxCycles) {
        logger.info(
          { waitMs: POLL_INTERVAL_MS },
          "Waiting before next cycle...",
        );
        await sleep(POLL_INTERVAL_MS);
      }
    }

    logger.info({ cycles: maxCycles }, "All cycles complete — exiting");
  }

  await prisma.$disconnect();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  logger.fatal({ error }, "run-indexer failed");
  process.exit(1);
});
