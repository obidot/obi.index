import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvers } from "../src/graphql/resolvers.js";
import type { DecodedEvent } from "../src/sync/decoder.js";
import { handleCrossChainEvent } from "../src/sync/handlers/crosschain.js";
import { handleExecutorEvent } from "../src/sync/handlers/executor.js";
import { fetchTransactionSender } from "../src/sync/blockscout.js";

vi.mock("../src/sync/blockscout.js", () => ({
  fetchTransactionSender: vi.fn(),
}));

function baseEvent(overrides: Partial<DecodedEvent> = {}): DecodedEvent {
  return {
    contractName: "CrossChainRouter",
    contractAddress: "0xrouter",
    eventName: "MessageDispatched",
    args: {},
    blockNumber: 100,
    txHash: "0xorigin",
    logIndex: 0,
    timestamp: new Date("2026-03-27T10:00:00Z"),
    ...overrides,
  };
}

function makeMockPrisma() {
  return {
    crossChainDispatch: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleCrossChainEvent", () => {
  it("enriches MessageDispatched records with the transaction sender", async () => {
    const prisma = makeMockPrisma();
    vi.mocked(fetchTransactionSender).mockResolvedValue(
      "0xSender000000000000000000000000000000000001",
    );

    await handleCrossChainEvent(
      prisma as never,
      baseEvent({
        eventName: "MessageDispatched",
        args: {
          commitment: "0xcommitment",
          dest: "SEPOLIA",
          bodyLength: 96n,
        },
      }),
    );

    const call = prisma.crossChainDispatch.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(call.data[0].sender).toBe(
      "0xSender000000000000000000000000000000000001",
    );
    expect(call.data[0].commitment).toBe("0xcommitment");
    expect(call.data[0].status).toBe("dispatched");
  });

  it("creates an executed step using the matched dispatch metadata", async () => {
    const prisma = makeMockPrisma();
    prisma.crossChainDispatch.findFirst.mockResolvedValue({
      id: "dispatch-1",
      txHash: "0xorigin",
      logIndex: 0,
      blockNumber: 100,
      timestamp: new Date("2026-03-27T10:00:00Z"),
      messageType: "ismp_dispatch",
      sourceChain: "polkadot_hub",
      destChain: "SEPOLIA",
      sender: "0xuser",
      data: "bodyLength=96",
      commitment: "0xcommitment",
      status: "dispatched",
    });

    await handleCrossChainEvent(
      prisma as never,
      baseEvent({
        eventName: "MessageReceived",
        txHash: "0xfollowup",
        logIndex: 1,
        blockNumber: 120,
        timestamp: new Date("2026-03-27T10:10:00Z"),
        args: {
          source: "SEPOLIA",
          nonce: 7n,
          bodyLength: 96n,
        },
      }),
    );

    const call = prisma.crossChainDispatch.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(call.data[0].messageType).toBe("ismp_receive");
    expect(call.data[0].sender).toBe("0xuser");
    expect(call.data[0].commitment).toBe("0xcommitment");
    expect(call.data[0].status).toBe("executed");
  });

  it("attaches host-level request receipts to an existing commitment pipeline", async () => {
    const prisma = makeMockPrisma();
    prisma.crossChainDispatch.findFirst.mockResolvedValue({
      id: "dispatch-1",
      txHash: "0xorigin",
      logIndex: 0,
      blockNumber: 100,
      timestamp: new Date("2026-03-27T10:00:00Z"),
      messageType: "hyper_executor_dispatch",
      sourceChain: "polkadot_hub",
      destChain: "hyperbridge",
      sender: "0xuser",
      data: "messageId=7,expectedOut=12345",
      commitment: "0xcommitment",
      status: "dispatched",
    });

    await handleCrossChainEvent(
      prisma as never,
      baseEvent({
        contractName: "IsmpHost",
        contractAddress: "0xhost",
        eventName: "PostRequestHandled",
        txHash: "0xreceipt",
        logIndex: 2,
        blockNumber: 121,
        timestamp: new Date("2026-03-27T10:11:00Z"),
        args: {
          commitment: "0xcommitment",
          relayer: "0xrelayer",
        },
      }),
    );

    expect(prisma.crossChainDispatch.findFirst).toHaveBeenCalledWith({
      where: {
        commitment: "0xcommitment",
      },
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
    });

    const call = prisma.crossChainDispatch.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(call.data[0]).toMatchObject({
      messageType: "ismp_post_request_handled",
      sourceChain: "hyperbridge",
      destChain: "polkadot_hub",
      sender: "0xuser",
      commitment: "0xcommitment",
      data: "relayer=0xrelayer",
      status: "executed",
    });
  });

  it("records state machine updates from the local ISMP host", async () => {
    const prisma = makeMockPrisma();

    await handleCrossChainEvent(
      prisma as never,
      baseEvent({
        contractName: "IsmpHost",
        contractAddress: "0xhost",
        eventName: "StateMachineUpdated",
        txHash: "0xstate",
        logIndex: 4,
        blockNumber: 122,
        timestamp: new Date("2026-03-27T10:12:00Z"),
        args: {
          stateMachineId: "KUSAMA-4009",
          height: 987654n,
        },
      }),
    );

    const call = prisma.crossChainDispatch.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(call.data[0]).toMatchObject({
      messageType: "ismp_state_machine_updated",
      sourceChain: "KUSAMA-4009",
      destChain: "polkadot_hub",
      sender: "0xhost",
      data: "height=987654",
      status: "accepted",
    });
  });

  it("records source-side ISMP host post requests and reuses same-tx commitments when present", async () => {
    const prisma = makeMockPrisma();
    prisma.crossChainDispatch.findFirst.mockResolvedValue({
      id: "commitment-1",
      txHash: "0xorigin",
      logIndex: 2,
      blockNumber: 100,
      timestamp: new Date("2026-03-27T10:00:02Z"),
      messageType: "hyper_executor_commitment",
      sourceChain: "polkadot_hub",
      destChain: "hyperbridge",
      sender: "0xuser",
      data: "messageId=7",
      commitment: "0xcommitment",
      status: "committed",
    });

    await handleCrossChainEvent(
      prisma as never,
      baseEvent({
        contractName: "IsmpHost",
        contractAddress: "0xhost",
        eventName: "PostRequestEvent",
        txHash: "0xorigin",
        logIndex: 1,
        blockNumber: 100,
        timestamp: new Date("2026-03-27T10:00:01Z"),
        args: {
          source: "EVM-420420417",
          dest: "ETHEREUM",
          from: "0xuser",
          to: "0x1234",
          nonce: 7n,
          timeoutTimestamp: 1_742_000_000n,
          body: "0xabcdef",
          fee: 1_000_000_000_000_000_000n,
        },
      }),
    );

    expect(prisma.crossChainDispatch.findFirst).toHaveBeenCalledWith({
      where: {
        txHash: "0xorigin",
        commitment: { not: null },
      },
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
    });

    const call = prisma.crossChainDispatch.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(call.data[0]).toMatchObject({
      messageType: "ismp_host_post_request",
      sourceChain: "EVM-420420417",
      destChain: "ETHEREUM",
      sender: "0xuser",
      commitment: "0xcommitment",
      data: "nonce=7,timeoutTimestamp=1742000000,bodyLength=3,fee=1000000000000000000,to=0x1234",
      status: "committed",
    });
  });

  it("records XCM precompile sends and extracts a parachain destination when the local encoding matches", async () => {
    const prisma = makeMockPrisma();

    await handleCrossChainEvent(
      prisma as never,
      baseEvent({
        contractName: "XcmPrecompile",
        contractAddress: "0x00000000000000000000000000000000000A0000",
        eventName: "XcmSent",
        txHash: "0xxcm",
        logIndex: 5,
        blockNumber: 130,
        timestamp: new Date("2026-03-27T10:20:00Z"),
        args: {
          sender: "0xexecutor",
          dest: "0x05010100c91f",
          message: "0x11223344",
        },
      }),
    );

    const call = prisma.crossChainDispatch.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(call.data[0]).toMatchObject({
      messageType: "xcm_precompile_sent",
      sourceChain: "polkadot_hub",
      destChain: "2034",
      sender: "0xexecutor",
      data: "dest=0x05010100c91f,messageLength=4",
      status: "dispatched",
    });
  });
});

describe("handleExecutorEvent", () => {
  it("persists XCM executor dispatches as cross-chain pipeline steps", async () => {
    const prisma = makeMockPrisma();
    vi.mocked(fetchTransactionSender).mockResolvedValue(
      "0xSender000000000000000000000000000000000002",
    );

    await handleExecutorEvent(
      prisma as never,
      baseEvent({
        contractName: "XCMExecutor",
        contractAddress: "0xxcm",
        eventName: "Dispatched",
        args: {
          messageId: 42n,
          expectedOut: 12345n,
        },
      }),
    );

    const call = prisma.crossChainDispatch.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(call.data[0]).toMatchObject({
      messageType: "xcm_executor_dispatch",
      destChain: "xcm",
      sender: "0xSender000000000000000000000000000000000002",
      status: "dispatched",
      data: "messageId=42,expectedOut=12345",
    });
  });

  it("attaches HyperExecutor commitments to the same-tx dispatch pipeline", async () => {
    const prisma = makeMockPrisma();
    vi.mocked(fetchTransactionSender).mockResolvedValue(
      "0xSender000000000000000000000000000000000003",
    );

    await handleExecutorEvent(
      prisma as never,
      baseEvent({
        contractName: "HyperExecutor",
        contractAddress: "0xhyper",
        eventName: "Committed",
        logIndex: 3,
        args: {
          messageId: 7n,
          commitment: "0xcommitment",
        },
      }),
    );

    expect(prisma.crossChainDispatch.updateMany).toHaveBeenCalledWith({
      where: {
        txHash: "0xorigin",
        commitment: null,
        messageType: {
          in: ["hyper_executor_dispatch", "ismp_host_post_request"],
        },
      },
      data: {
        commitment: "0xcommitment",
      },
    });

    const call = prisma.crossChainDispatch.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(call.data[0]).toMatchObject({
      messageType: "hyper_executor_commitment",
      commitment: "0xcommitment",
      sender: "0xSender000000000000000000000000000000000003",
      status: "committed",
      data: "messageId=7",
    });
  });

  it("records XcmSent as a same-tx precompile step on top of the executor dispatch", async () => {
    const prisma = makeMockPrisma();
    prisma.crossChainDispatch.findFirst.mockResolvedValue({
      id: "executor-dispatch-1",
      txHash: "0xorigin",
      logIndex: 0,
      blockNumber: 100,
      timestamp: new Date("2026-03-27T10:00:00Z"),
      messageType: "xcm_executor_dispatch",
      sourceChain: "polkadot_hub",
      destChain: "xcm",
      sender: "0xuser",
      data: "messageId=42,expectedOut=12345",
      commitment: null,
      status: "dispatched",
    });

    await handleExecutorEvent(
      prisma as never,
      baseEvent({
        contractName: "XcmPrecompile",
        contractAddress: "0x00000000000000000000000000000000000a0000",
        eventName: "XcmSent",
        logIndex: 2,
        args: {
          sender: "0xxcmexecutor",
          dest: "0x01020304",
          message: "0xaabbccdd",
        },
      }),
    );

    expect(prisma.crossChainDispatch.findFirst).toHaveBeenCalledWith({
      where: {
        txHash: "0xorigin",
        messageType: "xcm_executor_dispatch",
      },
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
    });

    const call = prisma.crossChainDispatch.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(call.data[0]).toMatchObject({
      messageType: "xcm_precompile_sent",
      sourceChain: "polkadot_hub",
      destChain: "xcm",
      sender: "0xuser",
      status: "dispatched",
      data: "precompileSender=0xxcmexecutor,destLength=4,messageLength=4",
    });
  });
});

describe("cross-chain GraphQL queries", () => {
  it("builds a pipeline from dispatch and follow-up lifecycle steps", async () => {
    const prisma = makeMockPrisma();
    prisma.crossChainDispatch.findMany
      .mockResolvedValueOnce([
        {
          id: "dispatch-1",
          txHash: "0xorigin",
          logIndex: 0,
          blockNumber: 100,
          timestamp: new Date("2026-03-27T10:00:00Z"),
          messageType: "ismp_dispatch",
          sourceChain: "polkadot_hub",
          destChain: "SEPOLIA",
          sender: "0xuser",
          data: "bodyLength=96",
          commitment: "0xcommitment",
          status: "dispatched",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "dispatch-1",
          txHash: "0xorigin",
          logIndex: 0,
          blockNumber: 100,
          timestamp: new Date("2026-03-27T10:00:00Z"),
          messageType: "ismp_dispatch",
          sourceChain: "polkadot_hub",
          destChain: "SEPOLIA",
          sender: "0xuser",
          data: "bodyLength=96",
          commitment: "0xcommitment",
          status: "dispatched",
        },
        {
          id: "receive-1",
          txHash: "0xfollowup",
          logIndex: 1,
          blockNumber: 120,
          timestamp: new Date("2026-03-27T10:10:00Z"),
          messageType: "ismp_receive",
          sourceChain: "SEPOLIA",
          destChain: "polkadot_hub",
          sender: "0xuser",
          data: "bodyLength=96,nonce=7",
          commitment: "0xcommitment",
          status: "executed",
        },
      ]);

    const result = await resolvers.Query.crossChainPipeline(
      undefined,
      { intentId: "0xorigin" },
      { prisma } as never,
    );

    expect(result).toMatchObject({
      txHash: "0xorigin",
      commitment: "0xcommitment",
      sender: "0xuser",
      latestStatus: "executed",
      latestMessageType: "ismp_receive",
    });
    expect(result?.steps).toHaveLength(2);
  });

  it("returns sender-filtered recent pipelines with the latest status", async () => {
    const prisma = makeMockPrisma();
    prisma.crossChainDispatch.findMany.mockResolvedValue([
      {
        id: "dispatch-1",
        txHash: "0xorigin",
        logIndex: 0,
        blockNumber: 100,
        timestamp: new Date("2026-03-27T10:00:00Z"),
        messageType: "ismp_dispatch",
        sourceChain: "polkadot_hub",
        destChain: "SEPOLIA",
        sender: "0xuser",
        data: "bodyLength=96",
        commitment: "0xcommitment",
        status: "dispatched",
      },
      {
        id: "receive-1",
        txHash: "0xfollowup",
        logIndex: 1,
        blockNumber: 120,
        timestamp: new Date("2026-03-27T10:10:00Z"),
        messageType: "ismp_receive",
        sourceChain: "SEPOLIA",
        destChain: "polkadot_hub",
        sender: "0xuser",
        data: "bodyLength=96,nonce=7",
        commitment: "0xcommitment",
        status: "executed",
      },
    ]);

    const result = await resolvers.Query.crossChainPipelines(
      undefined,
      { limit: 10, sender: "0xuser", status: "executed" },
      { prisma } as never,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      txHash: "0xorigin",
      latestStatus: "executed",
      sender: "0xuser",
    });
  });

  it("resolves a HyperExecutor tx hash into a commitment-linked pipeline", async () => {
    const prisma = makeMockPrisma();
    prisma.crossChainDispatch.findMany
      .mockResolvedValueOnce([
        {
          id: "executor-dispatch-1",
          txHash: "0xorigin",
          logIndex: 0,
          blockNumber: 100,
          timestamp: new Date("2026-03-27T10:00:00Z"),
          messageType: "hyper_executor_dispatch",
          sourceChain: "polkadot_hub",
          destChain: "hyperbridge",
          sender: "0xuser",
          data: "messageId=7,expectedOut=12345",
          commitment: "0xcommitment",
          status: "dispatched",
        },
        {
          id: "executor-commitment-1",
          txHash: "0xorigin",
          logIndex: 1,
          blockNumber: 100,
          timestamp: new Date("2026-03-27T10:00:01Z"),
          messageType: "hyper_executor_commitment",
          sourceChain: "polkadot_hub",
          destChain: "hyperbridge",
          sender: "0xuser",
          data: "messageId=7",
          commitment: "0xcommitment",
          status: "committed",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "executor-dispatch-1",
          txHash: "0xorigin",
          logIndex: 0,
          blockNumber: 100,
          timestamp: new Date("2026-03-27T10:00:00Z"),
          messageType: "hyper_executor_dispatch",
          sourceChain: "polkadot_hub",
          destChain: "hyperbridge",
          sender: "0xuser",
          data: "messageId=7,expectedOut=12345",
          commitment: "0xcommitment",
          status: "dispatched",
        },
        {
          id: "executor-commitment-1",
          txHash: "0xorigin",
          logIndex: 1,
          blockNumber: 100,
          timestamp: new Date("2026-03-27T10:00:01Z"),
          messageType: "hyper_executor_commitment",
          sourceChain: "polkadot_hub",
          destChain: "hyperbridge",
          sender: "0xuser",
          data: "messageId=7",
          commitment: "0xcommitment",
          status: "committed",
        },
        {
          id: "router-dispatch-1",
          txHash: "0xorigin",
          logIndex: 2,
          blockNumber: 100,
          timestamp: new Date("2026-03-27T10:00:02Z"),
          messageType: "ismp_dispatch",
          sourceChain: "polkadot_hub",
          destChain: "SEPOLIA",
          sender: "0xuser",
          data: "bodyLength=96",
          commitment: "0xcommitment",
          status: "dispatched",
        },
        {
          id: "router-receive-1",
          txHash: "0xfollowup",
          logIndex: 0,
          blockNumber: 120,
          timestamp: new Date("2026-03-27T10:10:00Z"),
          messageType: "ismp_receive",
          sourceChain: "SEPOLIA",
          destChain: "polkadot_hub",
          sender: "0xuser",
          data: "bodyLength=96,nonce=7",
          commitment: "0xcommitment",
          status: "executed",
        },
      ]);

    const result = await resolvers.Query.crossChainPipeline(
      undefined,
      { intentId: "0xorigin" },
      { prisma } as never,
    );

    expect(result).toMatchObject({
      txHash: "0xorigin",
      commitment: "0xcommitment",
      latestStatus: "executed",
      latestMessageType: "ismp_receive",
    });
    expect(result?.steps.map((step) => step.messageType)).toEqual([
      "hyper_executor_dispatch",
      "hyper_executor_commitment",
      "ismp_dispatch",
      "ismp_receive",
    ]);
  });
});
