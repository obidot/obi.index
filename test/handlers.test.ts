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

type MockUpsert = ReturnType<typeof vi.fn>;
type MockUpdateMany = ReturnType<typeof vi.fn>;

interface MockPrisma {
  deposit: { upsert: MockUpsert };
  withdrawal: { upsert: MockUpsert };
  vaultState: { upsert: MockUpsert };
  strategyExecution: { upsert: MockUpsert; updateMany: MockUpdateMany };
  withdrawalRequest: { upsert: MockUpsert; updateMany: MockUpdateMany };
  localSwap: { upsert: MockUpsert };
  intentExecution: { upsert: MockUpsert };
  parachainConfig: { upsert: MockUpsert };
  protocolConfig: { upsert: MockUpsert };
  oracleUpdate: { upsert: MockUpsert };
  oracleState: { upsert: MockUpsert; updateMany: MockUpdateMany };
  swapExecution: { upsert: MockUpsert };
}

function makeMockPrisma(): MockPrisma {
  const upsert = () => vi.fn().mockResolvedValue({});
  const updateMany = () => vi.fn().mockResolvedValue({ count: 1 });
  return {
    deposit: { upsert: upsert() },
    withdrawal: { upsert: upsert() },
    vaultState: { upsert: upsert() },
    strategyExecution: { upsert: upsert(), updateMany: updateMany() },
    withdrawalRequest: { upsert: upsert(), updateMany: updateMany() },
    localSwap: { upsert: upsert() },
    intentExecution: { upsert: upsert() },
    parachainConfig: { upsert: upsert() },
    protocolConfig: { upsert: upsert() },
    oracleUpdate: { upsert: upsert() },
    oracleState: { upsert: upsert(), updateMany: updateMany() },
    swapExecution: { upsert: upsert() },
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

  it("calls prisma.deposit.upsert with correct fields", async () => {
    const event = baseEvent({
      eventName: "Deposit",
      args: { sender: "0xAAA", owner: "0xBBB", assets: 1000n, shares: 990n },
    });
    await handleVaultEvent(prisma as never, event);
    expect(prisma.deposit.upsert).toHaveBeenCalledOnce();
    const call = prisma.deposit.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(call.create.owner).toBe("0xBBB");
    expect(call.create.assets).toBe("1000");
    expect(call.create.shares).toBe("990");
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

  it("calls prisma.withdrawal.upsert with correct fields", async () => {
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
    expect(prisma.withdrawal.upsert).toHaveBeenCalledOnce();
    const call = prisma.withdrawal.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(call.create.receiver).toBe("0xBBB");
    expect(call.create.assets).toBe("500");
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
    expect(prisma.strategyExecution.upsert).toHaveBeenCalledOnce();
    const call = prisma.strategyExecution.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(call.create.strategyId).toBe("7");
    expect(call.create.executor).toBe("0xSOLVER");
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
    expect(prisma.intentExecution.upsert).toHaveBeenCalledOnce();
    const call = prisma.intentExecution.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(call.create.solver).toBe("0xSOLVER");
    expect(call.create.nonce).toBe(1);
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

  it("upserts oracleUpdate and oracleState", async () => {
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
    expect(prisma.oracleUpdate.upsert).toHaveBeenCalledOnce();
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

  it("upserts swapExecution with correct fields", async () => {
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
    expect(prisma.swapExecution.upsert).toHaveBeenCalledOnce();
    const call = prisma.swapExecution.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(call.create.amountIn).toBe("1000");
    expect(call.create.amountOut).toBe("990");
    expect(call.create.poolType).toBe("HydrationOmnipool");
    expect(call.create.recipient).toBe("0xSENDER");
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
    const call = prisma.swapExecution.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(call.create.poolType).toBe("unknown(99)");
  });
});
