import type { Express, Request, Response } from "express";
import type {
  AnalyticsMaterializedStatus,
  AnalyticsMaterializer,
} from "../analytics/materialized.js";

export interface AnalyticsMaterializedPayload {
  status: "ok" | "degraded";
  materialized: AnalyticsMaterializedStatus;
}

export function buildAnalyticsMaterializedPayload(
  materialized: AnalyticsMaterializedStatus,
): AnalyticsMaterializedPayload {
  const degraded =
    materialized.initializedAt === null ||
    materialized.lastError !== null ||
    materialized.refreshInFlight;

  return {
    status: degraded ? "degraded" : "ok",
    materialized,
  };
}

export function registerAnalyticsRoutes(
  app: Express,
  deps: { materializer: AnalyticsMaterializer },
): void {
  app.get(
    "/analytics/materialized",
    (_req: Request, res: Response<AnalyticsMaterializedPayload>) => {
      const payload = buildAnalyticsMaterializedPayload(
        deps.materializer.getStatus(),
      );
      res.status(payload.status === "ok" ? 200 : 503).json(payload);
    },
  );

  app.post(
    "/analytics/materialized/refresh",
    async (_req: Request, res: Response<AnalyticsMaterializedPayload>) => {
      const status = await deps.materializer.refreshAll("manual");
      const payload = buildAnalyticsMaterializedPayload(status);
      res.status(payload.status === "ok" ? 200 : 503).json(payload);
    },
  );
}
