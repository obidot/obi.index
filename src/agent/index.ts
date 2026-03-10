// ── Agent CLI Entry Point ────────────────────────────────
// Run with: npm run agent

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { Orchestrator } from "./orchestrator.js";
import { logger } from "../utils/logger.js";

config();

async function main(): Promise<void> {
  logger.info("Obidot AI Agent starting...");

  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info("Connected to PostgreSQL");

  const orchestrator = new Orchestrator(prisma);
  orchestrator.start();

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down agent...");
    orchestrator.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  logger.fatal({ error }, "Agent failed to start");
  process.exit(1);
});
