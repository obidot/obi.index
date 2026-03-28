import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPrometheusMetrics,
  renderPrometheusMetrics,
} from "../src/metrics/prometheus.js";

vi.mock("../src/sync/blockscout.js", () => ({
  fetchLogs: vi.fn(async (_contractAddress: string) => [
    {
      address: { hash: "0x1234" },
      data: "0x",
      topics: ["0xabc"],
      block_number: 123,
      block_hash: "0xblockhash",
      transaction_hash: "0xtx123",
      index: 0,
      block_timestamp: "2026-03-14T00:00:00.000Z",
    },
  ]),
  fetchBlock: vi.fn(async (height: number) => ({
    hash: "0xblockhash",
    height,
    parent_hash: "0xparent",
    timestamp: "2026-03-14T00:00:00.000Z",
  })),
  getBlockscoutFetchStatus: vi.fn(() => ({
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lastStatusCode: 200,
    lastRetryCount: 0,
  })),
}));

vi.mock("../src/sync/decoder.js", () => ({
  decodeLogs: vi.fn((_logs: unknown[], _abi: unknown, contractName: string) => {
    const eventName =
      contractName === "SwapRouter" ? "Swapped" : "Deposit";
    return [
      {
        eventName,
        args: {},
        txHash: "0xtx123",
        logIndex: 0,
        blockNumber: 123,
        timestamp: new Date("2026-03-14T00:00:00.000Z"),
      },
    ];
  }),
}));

vi.mock("../src/sync/rpc.js", () => ({
  readVaultState: vi.fn(async () => ({
    totalAssets: 1n,
    totalSupply: 1n,
    totalDeposited: 1n,
    totalWithdrawn: 0n,
    depositCap: 1n,
    maxDailyLoss: 1n,
    paused: false,
  })),
  readOracleState: vi.fn(async () => ({
    price: 1n,
    decimals: 8,
    heartbeat: 3600n,
    roundId: 1,
  })),
}));

vi.mock("../src/sync/handlers/vault.js", () => ({
  handleVaultEvent: vi.fn(async () => {}),
}));
vi.mock("../src/sync/handlers/oracle.js", () => ({
  handleOracleEvent: vi.fn(async () => {}),
}));
vi.mock("../src/sync/handlers/crosschain.js", () => ({
  handleCrossChainEvent: vi.fn(async () => {}),
}));
vi.mock("../src/sync/handlers/executor.js", () => ({
  handleExecutorEvent: vi.fn(async () => {}),
  handleBifrostEvent: vi.fn(async () => {}),
}));
vi.mock("../src/sync/handlers/router.js", () => ({
  handleRouterEvent: vi.fn(async () => {}),
}));
vi.mock("../src/sync/handlers/liquidity.js", () => ({
  handleLiquidityPairEvent: vi.fn(async () => {}),
}));

beforeEach(() => {
  resetPrometheusMetrics();
});

describe("Poller metrics instrumentation", () => {
  it("records event, db, and poll durations during a poll cycle", async () => {
    const { Poller } = await import("../src/sync/poller.js");

    const prisma = {
      syncCursor: {
        upsert: vi.fn(async () => ({ lastBlock: 0 })),
        update: vi.fn(async () => ({})),
      },
      vaultState: {
        upsert: vi.fn(async () => ({})),
      },
      oracleState: {
        upsert: vi.fn(async () => ({})),
      },
    };

    const poller = new Poller(prisma as never);
    await poller.poll();

    const metrics = renderPrometheusMetrics();

    expect(metrics).toContain('events_indexed_total{event_type="Deposit"}');
    expect(metrics).toContain('events_indexed_total{event_type="Swapped"}');
    expect(metrics).toContain("poll_duration_ms_count 1");
    expect(metrics).toContain("db_query_duration_ms_count");
    expect(metrics).toContain("db_query_duration_ms_sum");
    expect(prisma.syncCursor.upsert).toHaveBeenCalled();
    expect(prisma.syncCursor.update).toHaveBeenCalled();
    expect(prisma.vaultState.upsert).toHaveBeenCalled();
    expect(prisma.oracleState.upsert).toHaveBeenCalled();
  });
});
