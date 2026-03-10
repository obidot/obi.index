// ── Apollo Server Entry Point ────────────────────────────
// Starts GraphQL server on port 4350 and the 60s sync poller.

import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { PrismaClient } from "@prisma/client";
import { typeDefs } from "./graphql/typeDefs.js";
import { resolvers } from "./graphql/resolvers.js";
import { Poller } from "./sync/poller.js";
import { GRAPHQL_PORT } from "./config/constants.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  // ── Database ─────────────────────────────────────────
  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info("Connected to PostgreSQL");

  // ── GraphQL Server ───────────────────────────────────
  const server = new ApolloServer({
    typeDefs,
    resolvers,
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: GRAPHQL_PORT },
    context: async () => ({ prisma }),
  });

  logger.info({ url }, "GraphQL server ready");

  // ── Sync Poller ──────────────────────────────────────
  const poller = new Poller(prisma);
  poller.start();

  // ── Graceful Shutdown ────────────────────────────────
  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");
    poller.stop();
    await server.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  logger.fatal({ error }, "Failed to start server");
  process.exit(1);
});
