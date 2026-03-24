// ── Handler Unit Tests ────────────────────────────────────
// Tests vault, oracle, and router event handlers.
// Uses a mock PrismaClient — no real database required.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleVaultEvent } from "../src/sync/handlers/vault.js";
import { handleOracleEvent } from "../src/sync/handlers/oracle.js";
import { handleRouterEvent } from "../src/sync/handlers/router.js";
import type { DecodedEvent } from "../src/sync/decoder.js";

// ── Mock rpc.ts (readVaultState) ──────────────────────────
vi.mock("../src/sync/rpc.js", () => ({
  readVaultState: vi.fn().mockResolvedValue({
    totalAssets: 0n,
    totalSupply: 0n,
    paused: false,
    depositCap: 0n,
    maxDailyLoss: 0n,
    totalDeposited: 0n,
    totalWithdrawn: 0n,
  }),
}));

// ── Mock Prisma builder ───────────────────────────────────

type MockCreateMany = ReturnType<typeof vi.fn>;
type MockUpsert = ReturnType<typeof vi.fn>;
type MockUpdateMany = ReturnType<typeof vi.fn>;

interface MockPrisma {
  deposit: { createMany: MockCreateMany };
  withdrawal: { createMany: MockCreateMany };
  vaultState: { upsert: MockUpsert };
  strategyExecution: { createMany: MockCreateMany; updateMany: MockUpdateMany };
  withdrawalRequest: { createMany: MockCreateMany; updateMany: MockUpdateMany };
  localSwap: { createMany: MockCreateMany };
  intentExecution: { createMany: MockCreateMany };
  parachainConfig: { upsert: MockUpsert };
  protocolConfig: { upsert: MockUpsert };
  oracleUpdate: { createMany: MockCreateMany };
  oracleState: { upsert: MockUpsert; updateMany: MockUpdateMany };
  swapExecution: { createMany: MockCreateMany };
}

function makeMockPrisma(): MockPrisma {
  const createMany = () => vi.fn().mockResolvedValue({ count: 1 });
  const upsert = () => vi.fn().mockResolvedValue({});
  const updateMany = () => vi.fn().mockResolvedValue({ count: 1 });
  return {
    deposit: { createMany: createMany() },
    withdrawal: { createMany: createMany() },
    vaultState: { upsert: upsert() },
    strategyExecution: { createMany: createMany(), updateMany: updateMany() },
    withdrawalRequest: { createMany: createMany(), updateMany: updateMany() },
    localSwap: { createMany: createMany() },
    intentExecution: { createMany: createMany() },
    parachainConfig: { upsert: upsert() },
    protocolConfig: { upsert: upsert() },
    oracleUpdate: { createMany: createMany() },
    oracleState: { upsert: upsert(), updateMany: updateMany() },
    swapExecution: { createMany: createMany() },
  };
}

// ── Base event factory ────────────────────────────────────

function baseEvent(overrides: Partial<DecodedEvent> = {}): DecodedEvent {
  return {
    contractName: "ObidotVault",
    contractAddress: "0x0000000000000000000000000000000000000001",
    eventName: "Deposit",
    args: {},
    blockNumber: 500,
    txHash: "0xabc123",
    logIndex: 0,
    timestamp: new Date("2026-03-14T00:00:00Z"),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Vault handler tests
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultEvent — Deposit", () => {
  let prisma: MockPrisma;
  beforeEach(() => {
    prisma = makeMockPrisma();
  });

  it("calls prisma.deposit.createMany with correct fields", async () => {
    const event = baseEvent({
      eventName: "Deposit",
      args: { sender: "0xAAA", owner: "0xBBB", assets: 1000n, shares: 990n },
    });
    await handleVaultEvent(prisma as never, event);
    expect(prisma.deposit.createMany).toHaveBeenCalledOnce();
    const call = prisma.deposit.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[];
      skipDuplicates: boolean;
    };
    expect(call.data[0].owner).toBe("0xBBB");
    expect(call.data[0].assets).toBe("1000");
    expect(call.data[0].shares).toBe("990");
    expect(call.skipDuplicates).toBe(true);
  });

  it("also calls vaultState.upsert (RPC refresh)", async () => {
    const event = baseEvent({
      eventName: "Deposit",
      args: { sender: "0xAAA", owner: "0xBBB", assets: 1000n, shares: 990n },
    });
    await handleVaultEvent(prisma as never, event);
    expect(prisma.vaultState.upsert).toHaveBeenCalledOnce();
  });
});

describe("handleVaultEvent — Withdraw", () => {
  let prisma: MockPrisma;
  beforeEach(() => {
    prisma = makeMockPrisma();
  });

  it("calls prisma.withdrawal.createMany with correct fields", async () => {
    const event = baseEvent({
      eventName: "Withdraw",
      args: {
        sender: "0xAAA",
        receiver: "0xBBB",
        owner: "0xCCC",
        assets: 500n,
        shares: 495n,
      },
    });
    await handleVaultEvent(prisma as never, event);
    expect(prisma.withdrawal.createMany).toHaveBeenCalledOnce();
    const call = prisma.withdrawal.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[];
    };
    expect(call.data[0].receiver).toBe("0xBBB");
    expect(call.data[0].assets).toBe("500");
  });
});

describe("handleVaultEvent — StrategyExecuted", () => {
  let prisma: MockPrisma;
  beforeEach(() => {
    prisma = makeMockPrisma();
  });

  it("stores strategyId in the DB record (Bug O1 fix)", async () => {
    const event = baseEvent({
      eventName: "StrategyExecuted",
      args: {
        strategyId: 7n,
        strategist: "0xSOLVER",
        targetParachain: 2034,
        targetProtocol: "0xPROTO",
        amount: 1000n,
        minReturn: 900n,
      },
    });
    await handleVaultEvent(prisma as never, event);
    expect(prisma.strategyExecution.createMany).toHaveBeenCalledOnce();
    const call = prisma.strategyExecution.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[];
    };
    expect(call.data[0].strategyId).toBe("7");
    expect(call.data[0].executor).toBe("0xSOLVER");
  });
});

describe("handleVaultEvent — StrategyOutcomeReported", () => {
  let prisma: MockPrisma;
  beforeEach(() => {
    prisma = makeMockPrisma();
  });

  it("filters updateMany by strategyId (Bug O1 fix)", async () => {
    const event = baseEvent({
      eventName: "StrategyOutcomeReported",
      args: { strategyId: 7n, newStatus: 2, returnedAmount: 1000n, pnl: 50n },
    });
    await handleVaultEvent(prisma as never, event);
    expect(prisma.strategyExecution.updateMany).toHaveBeenCalledOnce();
    const call = prisma.strategyExecution.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.where.strategyId).toBe("7");
    expect(call.data.profit).toBe("50");
    expect(call.data.success).toBe(true);
  });

  it("sets success=false for non-2 status codes", async () => {
    const event = baseEvent({
      eventName: "StrategyOutcomeReported",
      args: { strategyId: 1n, newStatus: 3, returnedAmount: 0n, pnl: -100n },
    });
    await handleVaultEvent(prisma as never, event);
    const call = prisma.strategyExecution.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(call.data.success).toBe(false);
  });
});

describe("handleVaultEvent — IntentExecuted", () => {
  let prisma: MockPrisma;
  beforeEach(() => {
    prisma = makeMockPrisma();
  });

  it("stores solver from args.strategist (on-chain field name)", async () => {
    const event = baseEvent({
      eventName: "IntentExecuted",
      args: { messageId: 42n, strategist: "0xSOLVER", nonce: 1n },
    });
    await handleVaultEvent(prisma as never, event);
    expect(prisma.intentExecution.createMany).toHaveBeenCalledOnce();
    const call = prisma.intentExecution.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[];
    };
    expect(call.data[0].solver).toBe("0xSOLVER");
    expect(call.data[0].nonce).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Oracle handler tests
// ─────────────────────────────────────────────────────────────────────────────

describe("handleOracleEvent — PriceUpdated", () => {
  let prisma: MockPrisma;
  beforeEach(() => {
    prisma = makeMockPrisma();
  });

  it("writes oracleUpdate history and upserts oracleState", async () => {
    const event = baseEvent({
      contractName: "KeeperOracle",
      contractAddress: "0xFEED",
      eventName: "PriceUpdated",
      args: {
        roundId: 5n,
        answer: 1234567890n,
        updatedAt: 1000n,
        updater: "0xKEEPER",
      },
    });
    await handleOracleEvent(prisma as never, event);
    expect(prisma.oracleUpdate.createMany).toHaveBeenCalledOnce();
    expect(prisma.oracleState.upsert).toHaveBeenCalledOnce();

    const stateCall = prisma.oracleState.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(stateCall.create.price).toBe("1234567890");
    expect(stateCall.create.roundId).toBe(5);
  });
});

describe("handleOracleEvent — FeedSet", () => {
  let prisma: MockPrisma;
  beforeEach(() => {
    prisma = makeMockPrisma();
  });

  it("upserts oracleState with asset address", async () => {
    const event = baseEvent({
      contractName: "OracleRegistry",
      eventName: "FeedSet",
      args: {
        asset: "0xTOKEN",
        oracle: "0xORACLE",
        heartbeat: 3600n,
        deviationBps: 100,
      },
    });
    await handleOracleEvent(prisma as never, event);
    expect(prisma.oracleState.upsert).toHaveBeenCalledOnce();
    const call = prisma.oracleState.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(call.create.asset).toBe("0xTOKEN");
    expect(call.create.heartbeat).toBe(3600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Router handler tests
// ─────────────────────────────────────────────────────────────────────────────

describe("handleRouterEvent — Swapped", () => {
  let prisma: MockPrisma;
  beforeEach(() => {
    prisma = makeMockPrisma();
  });

  it("writes swapExecution with correct fields", async () => {
    const event = baseEvent({
      contractName: "SwapRouter",
      eventName: "Swapped",
      args: {
        sender: "0xSENDER",
        tokenIn: "0xIN",
        tokenOut: "0xOUT",
        amountIn: 1000n,
        amountOut: 990n,
        poolType: 0,
      },
    });
    await handleRouterEvent(prisma as never, event);
    expect(prisma.swapExecution.createMany).toHaveBeenCalledOnce();
    const call = prisma.swapExecution.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[];
    };
    expect(call.data[0].amountIn).toBe("1000");
    expect(call.data[0].amountOut).toBe("990");
    expect(call.data[0].poolType).toBe("HydrationOmnipool");
    expect(call.data[0].recipient).toBe("0xSENDER");
  });

  it("uses unknown(N) label for unrecognised pool types", async () => {
    const event = baseEvent({
      contractName: "SwapRouter",
      eventName: "Swapped",
      args: {
        sender: "0xS",
        tokenIn: "0xI",
        tokenOut: "0xO",
        amountIn: 1n,
        amountOut: 1n,
        poolType: 99,
      },
    });
    await handleRouterEvent(prisma as never, event);
    const call = prisma.swapExecution.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[];
    };
    expect(call.data[0].poolType).toBe("unknown(99)");
  });
});
