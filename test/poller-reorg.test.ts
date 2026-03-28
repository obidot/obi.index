import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPrometheusMetrics,
  renderPrometheusMetrics,
} from "../src/metrics/prometheus.js";

const fetchLogs = vi.fn();
const fetchBlock = vi.fn();
const handleVaultEvent = vi.fn(async () => {});

vi.mock("../src/sync/blockscout.js", () => ({
  fetchLogs,
  fetchBlock,
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
  decodeLogs: vi.fn(() => [
    {
      eventName: "Deposit",
      args: {},
      txHash: "0xtx123",
      logIndex: 0,
      blockNumber: 123,
      timestamp: new Date("2026-03-14T00:00:00.000Z"),
    },
  ]),
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
  handleVaultEvent,
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
  fetchLogs.mockReset();
  fetchBlock.mockReset();
  handleVaultEvent.mockClear();

  fetchLogs.mockResolvedValue([
    {
      address: { hash: "0x1234" },
      data: "0x",
      topics: ["0xabc"],
      block_number: 123,
      block_hash: "0xblockhash-a",
      transaction_hash: "0xtx123",
      index: 0,
      block_timestamp: "2026-03-14T00:00:00.000Z",
    },
  ]);

  fetchBlock.mockResolvedValue({
    hash: "0xblockhash-a",
    height: 123,
    parent_hash: "0xparenthash",
    timestamp: "2026-03-14T00:00:00.000Z",
  });
});

describe("Poller reorg detection", () => {
  it("rewinds indexed data and replays after a recently indexed block hash changes", async () => {
    const { Poller } = await import("../src/sync/poller.js");

    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(prisma),
      ),
      syncCursor: {
        upsert: vi.fn(async () => ({ lastBlock: 0 })),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      vaultState: {
        upsert: vi.fn(async () => ({})),
      },
      oracleState: {
        upsert: vi.fn(async () => ({})),
      },
      deposit: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      withdrawal: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      withdrawalRequest: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      strategyExecution: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      localSwap: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      intentExecution: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      oracleUpdate: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      swapExecution: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      priceHistoryPoint: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      crossChainDispatch: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      bifrostStrategy: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      lpMint: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      lpBurn: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      lpSync: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      protocolConfig: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      parachainConfig: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      lpPoolState: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };

    const poller = new Poller(prisma as never);

    await poller.poll();
    const fetchLogsAfterFirstPoll = fetchLogs.mock.calls.length;

    fetchBlock.mockResolvedValue({
      hash: "0xblockhash-b",
      height: 123,
      parent_hash: "0xparenthash",
      timestamp: "2026-03-14T00:01:00.000Z",
    });
    fetchLogs.mockResolvedValue([
      {
        address: { hash: "0x1234" },
        data: "0x",
        topics: ["0xabc"],
        block_number: 123,
        block_hash: "0xblockhash-b",
        transaction_hash: "0xtx123",
        index: 0,
        block_timestamp: "2026-03-14T00:01:00.000Z",
      },
    ]);

    await poller.poll();
    await poller.poll();

    const status = poller.getStatus();
    const metrics = renderPrometheusMetrics();

    expect(status.lastPollError).toBeNull();
    expect(metrics).toContain("reorg_detected_total 1");
    expect(prisma.syncCursor.update).toHaveBeenCalledTimes(
      fetchLogsAfterFirstPoll * 3,
    );
    expect(prisma.syncCursor.updateMany).toHaveBeenCalledWith({
      where: { lastBlock: { gte: 123 } },
      data: {
        lastBlock: 122,
        lastTxHash: null,
        lastLogIndex: null,
      },
    });
    expect(prisma.deposit.deleteMany).toHaveBeenCalledWith({
      where: { blockNumber: { gte: 123 } },
    });
    expect(fetchLogs).toHaveBeenCalledTimes(fetchLogsAfterFirstPoll * 3);
    expect(fetchBlock).toHaveBeenCalledWith(123);
    expect(handleVaultEvent).toHaveBeenCalledTimes(3);
  });
});
