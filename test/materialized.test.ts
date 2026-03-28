import { describe, expect, it, vi } from "vitest";
import {
  AnalyticsMaterializer,
  type AnalyticsMaterializedStatus,
} from "../src/analytics/materialized.js";
import { buildAnalyticsMaterializedPayload } from "../src/api/analytics.js";

describe("AnalyticsMaterializer", () => {
  it("creates and refreshes materialized views", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ rows: 2 }])
      .mockResolvedValueOnce([{ rows: 3 }])
      .mockResolvedValueOnce([{ rows: 1 }]);

    const materializer = new AnalyticsMaterializer({
      $executeRawUnsafe: execute,
      $queryRawUnsafe: query,
    } as never);

    await materializer.ensureViews();
    const status = await materializer.refreshAll("test");

    expect(execute).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE MATERIALIZED VIEW IF NOT EXISTS "SwapVolume24h"'),
    );
    expect(execute).toHaveBeenCalledWith(
      'REFRESH MATERIALIZED VIEW "SwapVolume24h"',
    );
    expect(status.refreshCount).toBe(1);
    expect(status.lastRefreshReason).toBe("test");
    expect(status.views).toEqual([
      { name: "SwapVolume24h", rows: 2 },
      { name: "FeeRevenue24h", rows: 3 },
      { name: "UniqueTraders7d", rows: 1 },
    ]);
  });

  it("skips concurrent refreshes", async () => {
    let resolveRefresh: (() => void) | null = null;
    let firstCall = true;
    const execute = vi.fn().mockImplementation(
      () => {
        if (!firstCall) return Promise.resolve();
        firstCall = false;
        return new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        });
      },
    );

    const materializer = new AnalyticsMaterializer({
      $executeRawUnsafe: execute,
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ rows: 0 }]),
    } as never);

    const first = materializer.refreshAll("first");
    const second = await materializer.refreshAll("second");

    expect(second.refreshInFlight).toBe(true);
    resolveRefresh?.();
    await first;
  });
});

describe("buildAnalyticsMaterializedPayload", () => {
  it("returns ok for a healthy materialized snapshot", () => {
    const payload = buildAnalyticsMaterializedPayload({
      enabled: true,
      refreshIntervalMs: 300_000,
      initializedAt: 100,
      lastRefreshStartedAt: 150,
      lastRefreshCompletedAt: 160,
      lastRefreshReason: "startup",
      refreshCount: 1,
      refreshInFlight: false,
      lastError: null,
      views: [{ name: "SwapVolume24h", rows: 2 }],
    } satisfies AnalyticsMaterializedStatus);

    expect(payload.status).toBe("ok");
  });

  it("returns degraded while a refresh is in flight", () => {
    const payload = buildAnalyticsMaterializedPayload({
      enabled: true,
      refreshIntervalMs: 300_000,
      initializedAt: 100,
      lastRefreshStartedAt: 150,
      lastRefreshCompletedAt: null,
      lastRefreshReason: "manual",
      refreshCount: 0,
      refreshInFlight: true,
      lastError: null,
      views: [],
    } satisfies AnalyticsMaterializedStatus);

    expect(payload.status).toBe("degraded");
  });
});
