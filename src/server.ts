// ── Apollo Server Entry Point ────────────────────────────
// Starts GraphQL server on port 4350 with WebSocket subscriptions and
// the 60s sync poller. Uses graphql-ws over http for subscriptions.

import { createServer } from "node:http";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/use/ws";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { registerAnalyticsRoutes } from "./api/analytics.js";
import { AnalyticsMaterializer } from "./analytics/materialized.js";
import { typeDefs } from "./graphql/typeDefs.js";
import { resolvers } from "./graphql/resolvers.js";
import { registerHealthRoute } from "./api/health.js";
import { Poller } from "./sync/poller.js";
import { registerMetricsRoute } from "./metrics/prometheus.js";
import { GRAPHQL_PORT } from "./config/constants.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  // ── Database ─────────────────────────────────────────
  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info("Connected to PostgreSQL");

  // ── Schema ────────────────────────────────────────────
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  // ── Shared Services ───────────────────────────────────
  const poller = new Poller(prisma);
  const analyticsMaterializer = new AnalyticsMaterializer(prisma);
  await analyticsMaterializer.start();

  // ── HTTP + WebSocket Server ───────────────────────────
  const app = express();
  const httpServer = createServer(app);

  // WebSocket server on the same port, /graphql path
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: "/graphql",
  });
  const wsCleanup = useServer(
    {
      schema,
      context: () => ({ prisma }),
      // Clean up subscription iterators on abnormal client disconnect
      onComplete: (_ctx, _msg) => {
        // graphql-ws calls return() on active subscriptions on complete/disconnect;
        // our iterators are idempotent so this is safe to call multiple times.
      },
    },
    wsServer,
  );

  // ── Apollo Server ─────────────────────────────────────
  const server = new ApolloServer({
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await wsCleanup.dispose();
            },
          };
        },
      },
    ],
  });

  await server.start();

  registerMetricsRoute(app);
  registerHealthRoute(app, { prisma, poller });
  registerAnalyticsRoutes(app, { materializer: analyticsMaterializer });

  app.use(
    "/graphql",
    express.json(),
    (req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") {
        res.sendStatus(200);
        return;
      }
      next();
    },
    // @ts-expect-error — expressMiddleware types differ slightly between bundled + hoisted express
    expressMiddleware(server, { context: async () => ({ prisma }) }),
  );

  // ── Start Listening ───────────────────────────────────
  await new Promise<void>((resolve) =>
    httpServer.listen({ port: GRAPHQL_PORT }, resolve),
  );

  logger.info(
    { port: GRAPHQL_PORT, url: `http://localhost:${GRAPHQL_PORT}/graphql` },
    "GraphQL server ready (HTTP + WebSocket subscriptions)",
  );

  // ── Sync Poller ──────────────────────────────────────
  poller.start();

  // ── Graceful Shutdown ────────────────────────────────
  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");
    poller.stop();
    analyticsMaterializer.stop();
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
