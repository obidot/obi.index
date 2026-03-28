import type { PrismaClient } from "@prisma/client";
import { ANALYTICS_REFRESH_INTERVAL_MS } from "../config/constants.js";
import { logger } from "../utils/logger.js";

type SqlExecutor = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">;

export interface MaterializedViewSummary {
  name: string;
  rows: number;
}

export interface AnalyticsMaterializedStatus {
  enabled: boolean;
  refreshIntervalMs: number;
  initializedAt: number | null;
  lastRefreshStartedAt: number | null;
  lastRefreshCompletedAt: number | null;
  lastRefreshReason: string | null;
  refreshCount: number;
  refreshInFlight: boolean;
  lastError: string | null;
  views: MaterializedViewSummary[];
}

const MATERIALIZED_VIEW_DEFINITIONS = [
  {
    name: "SwapVolume24h",
    sql: `
      CREATE MATERIALIZED VIEW IF NOT EXISTS "SwapVolume24h" AS
      SELECT
        "tokenIn",
        "tokenOut",
        COUNT(*)::int AS "swapCount",
        COALESCE(SUM(("amountIn")::numeric), 0)::text AS "amountInTotal",
        COALESCE(SUM(("amountOut")::numeric), 0)::text AS "amountOutTotal",
        MAX("timestamp") AS "lastSwapAt"
      FROM "swap_executions"
      WHERE "timestamp" >= NOW() - INTERVAL '24 hours'
      GROUP BY "tokenIn", "tokenOut"
      WITH NO DATA;
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS "SwapVolume24h_token_pair_idx" ON "SwapVolume24h" ("tokenIn", "tokenOut");',
    ],
  },
  {
    name: "FeeRevenue24h",
    sql: `
      CREATE MATERIALIZED VIEW IF NOT EXISTS "FeeRevenue24h" AS
      SELECT
        "tokenIn",
        "poolType",
        COUNT(*)::int AS "swapCount",
        COALESCE(
          SUM(
            CASE
              WHEN "poolType" IN ('HydrationOmnipool', 'AssetHubPair', 'BifrostDEX', 'UniswapV2')
                THEN (("amountIn")::numeric * 30 / 10000)
              ELSE 0
            END
          ),
          0
        )::text AS "estimatedFeeAmount",
        MAX("timestamp") AS "lastSwapAt"
      FROM "swap_executions"
      WHERE "timestamp" >= NOW() - INTERVAL '24 hours'
      GROUP BY "tokenIn", "poolType"
      WITH NO DATA;
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS "FeeRevenue24h_token_pool_idx" ON "FeeRevenue24h" ("tokenIn", "poolType");',
    ],
  },
  {
    name: "UniqueTraders7d",
    sql: `
      CREATE MATERIALIZED VIEW IF NOT EXISTS "UniqueTraders7d" AS
      SELECT
        COUNT(DISTINCT LOWER("recipient"))::int AS "uniqueTraders7d"
      FROM "swap_executions"
      WHERE "timestamp" >= NOW() - INTERVAL '7 days'
      WITH NO DATA;
    `,
    indexes: [],
  },
] as const;

export class AnalyticsMaterializer {
  private readonly status: AnalyticsMaterializedStatus = {
    enabled: true,
    refreshIntervalMs: ANALYTICS_REFRESH_INTERVAL_MS,
    initializedAt: null,
    lastRefreshStartedAt: null,
    lastRefreshCompletedAt: null,
    lastRefreshReason: null,
    refreshCount: 0,
    refreshInFlight: false,
    lastError: null,
    views: [],
  };
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: SqlExecutor) {}

  getStatus(): AnalyticsMaterializedStatus {
    return {
      ...this.status,
      views: this.status.views.map((view) => ({ ...view })),
    };
  }

  async ensureViews(): Promise<void> {
    for (const definition of MATERIALIZED_VIEW_DEFINITIONS) {
      await this.prisma.$executeRawUnsafe(definition.sql);
      for (const indexSql of definition.indexes) {
        await this.prisma.$executeRawUnsafe(indexSql);
      }
    }

    this.status.initializedAt = Date.now();
    this.status.lastError = null;
    this.status.views = MATERIALIZED_VIEW_DEFINITIONS.map(({ name }) => ({
      name,
      rows: 0,
    }));
  }

  async refreshAll(reason: string): Promise<AnalyticsMaterializedStatus> {
    if (this.status.refreshInFlight) {
      return this.getStatus();
    }

    this.status.refreshInFlight = true;
    this.status.lastRefreshStartedAt = Date.now();
    this.status.lastRefreshReason = reason;

    try {
      for (const definition of MATERIALIZED_VIEW_DEFINITIONS) {
        await this.prisma.$executeRawUnsafe(
          `REFRESH MATERIALIZED VIEW "${definition.name}"`,
        );
      }

      this.status.views = await Promise.all(
        MATERIALIZED_VIEW_DEFINITIONS.map(async ({ name }) => {
          const rows = await this.prisma.$queryRawUnsafe<Array<{ rows: number }>>(
            `SELECT COUNT(*)::int AS rows FROM "${name}"`,
          );
          return {
            name,
            rows: rows[0]?.rows ?? 0,
          };
        }),
      );

      this.status.lastRefreshCompletedAt = Date.now();
      this.status.refreshCount += 1;
      this.status.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status.lastError = message;
      logger.error({ err: error }, "Failed to refresh analytics materialized views");
    } finally {
      this.status.refreshInFlight = false;
    }

    return this.getStatus();
  }

  async start(): Promise<void> {
    await this.ensureViews();
    await this.refreshAll("startup");

    if (ANALYTICS_REFRESH_INTERVAL_MS <= 0) {
      this.status.enabled = false;
      return;
    }

    this.status.enabled = true;
    this.timer = setInterval(() => {
      void this.refreshAll("interval");
    }, ANALYTICS_REFRESH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
