import type { PrismaClient } from "@prisma/client";
import type { Express, Request, Response } from "express";
import {
  getBlockscoutFetchStatus,
  type BlockscoutFetchStatus,
} from "../sync/blockscout.js";
import type { Poller, PollerStatusSnapshot } from "../sync/poller.js";

export interface HealthPayload {
  status: "ok" | "degraded";
  timestamp: number;
  dbConnected: boolean;
  lastIndexedBlock: number | null;
  pollerRunning: boolean;
  pollerLagMs: number | null;
  poller: PollerStatusSnapshot;
  blockscout: BlockscoutFetchStatus;
}

export function buildHealthPayload(params: {
  now: number;
  dbConnected: boolean;
  lastIndexedBlock: number | null;
  poller: PollerStatusSnapshot;
  blockscout: BlockscoutFetchStatus;
}): HealthPayload {
  const { now, dbConnected, lastIndexedBlock, poller, blockscout } = params;
  const lagSource = poller.lastPollCompletedAt ?? poller.lastPollStartedAt;
  const pollerLagMs = lagSource === null ? null : Math.max(0, now - lagSource);
  const degraded =
    !dbConnected ||
    poller.lastPollError !== null ||
    blockscout.consecutiveFailures > 0;

  return {
    status: degraded ? "degraded" : "ok",
    timestamp: now,
    dbConnected,
    lastIndexedBlock,
    pollerRunning: poller.active,
    pollerLagMs,
    poller,
    blockscout,
  };
}

export function registerHealthRoute(
  app: Express,
  deps: { prisma: PrismaClient; poller: Poller },
): void {
  app.get("/health", async (_req: Request, res: Response) => {
    const now = Date.now();
    const pollerStatus = deps.poller.getStatus();
    const blockscoutStatus = getBlockscoutFetchStatus();

    let dbConnected = false;
    let lastIndexedBlock: number | null = null;

    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      dbConnected = true;

      const aggregate = await deps.prisma.syncCursor.aggregate({
        _max: { lastBlock: true },
      });
      lastIndexedBlock = aggregate._max.lastBlock ?? null;
    } catch {
      dbConnected = false;
      lastIndexedBlock = null;
    }

    const payload = buildHealthPayload({
      now,
      dbConnected,
      lastIndexedBlock,
      poller: pollerStatus,
      blockscout: blockscoutStatus,
    });

    res.status(payload.status === "ok" ? 200 : 503).json(payload);
  });
}
