import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHourlyPriceHistory } from "../src/graphql/priceHistory.js";
import { resolvers } from "../src/graphql/resolvers.js";

const TOKEN_IN = "0xAaaA000000000000000000000000000000000001";
const TOKEN_OUT = "0xBbbB000000000000000000000000000000000002";

function unixSeconds(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("buildHourlyPriceHistory", () => {
  it("aggregates hourly OHLCV bars across forward and reverse swaps", () => {
    const bars = buildHourlyPriceHistory({
      tokenIn: TOKEN_IN.toLowerCase(),
      tokenOut: TOKEN_OUT.toLowerCase(),
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      from: unixSeconds("2026-03-14T00:00:00Z"),
      to: unixSeconds("2026-03-14T02:00:00Z"),
      swaps: [
        {
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          amountIn: "1000000000000000000",
          amountOut: "2000000",
          timestamp: new Date("2026-03-14T00:10:00Z"),
          blockNumber: 1,
          logIndex: 0,
        },
        {
          tokenIn: TOKEN_OUT,
          tokenOut: TOKEN_IN,
          amountIn: "3000000",
          amountOut: "1000000000000000000",
          timestamp: new Date("2026-03-14T00:20:00Z"),
          blockNumber: 2,
          logIndex: 0,
        },
        {
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          amountIn: "2000000000000000000",
          amountOut: "5000000",
          timestamp: new Date("2026-03-14T00:50:00Z"),
          blockNumber: 3,
          logIndex: 0,
        },
        {
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          amountIn: "1000000000000000000",
          amountOut: "4000000",
          timestamp: new Date("2026-03-14T01:05:00Z"),
          blockNumber: 4,
          logIndex: 0,
        },
      ],
    });

    expect(bars).toEqual([
      {
        timestamp: unixSeconds("2026-03-14T00:00:00Z"),
        open: "2",
        high: "3",
        low: "2",
        close: "2.5",
        volumeIn: "4",
        volumeOut: "10",
        trades: 3,
      },
      {
        timestamp: unixSeconds("2026-03-14T01:00:00Z"),
        open: "4",
        high: "4",
        low: "4",
        close: "4",
        volumeIn: "1",
        volumeOut: "4",
        trades: 1,
      },
    ]);
  });

  it("skips malformed or zero-sized swaps instead of inventing bars", () => {
    const bars = buildHourlyPriceHistory({
      tokenIn: TOKEN_IN,
      tokenOut: TOKEN_OUT,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      from: unixSeconds("2026-03-14T00:00:00Z"),
      to: unixSeconds("2026-03-14T01:00:00Z"),
      swaps: [
        {
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          amountIn: "1000000000000000000",
          amountOut: "2000000",
          timestamp: new Date("2026-03-14T00:10:00Z"),
          blockNumber: 1,
          logIndex: 0,
        },
        {
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          amountIn: "0",
          amountOut: "3000000",
          timestamp: new Date("2026-03-14T00:20:00Z"),
          blockNumber: 2,
          logIndex: 0,
        },
        {
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          amountIn: "not-a-number",
          amountOut: "4000000",
          timestamp: new Date("2026-03-14T00:30:00Z"),
          blockNumber: 3,
          logIndex: 0,
        },
      ],
    });

    expect(bars).toEqual([
      {
        timestamp: unixSeconds("2026-03-14T00:00:00Z"),
        open: "2",
        high: "2",
        low: "2",
        close: "2",
        volumeIn: "1",
        volumeOut: "2",
        trades: 1,
      },
    ]);
  });
});

describe("Query.priceHistory", () => {
  it("fails safely when token decimals are unavailable", async () => {
    const prisma = {
      token: {
        findMany: vi.fn().mockResolvedValue([
          {
            address: TOKEN_IN,
            symbol: "TKA",
            name: "Token A",
            decimals: 18,
          },
        ]),
      },
      priceHistoryPoint: {
        findMany: vi.fn().mockResolvedValue([
          {
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: "1000000000000000000",
            amountOut: "2000000",
            timestamp: new Date("2026-03-14T00:10:00Z"),
            blockNumber: 1,
            logIndex: 0,
          },
        ]),
      },
    };

    const result = await resolvers.Query.priceHistory(
      undefined,
      {
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        from: unixSeconds("2026-03-14T00:00:00Z"),
        to: unixSeconds("2026-03-14T01:00:00Z"),
      },
      { prisma } as never,
    );

    expect(result).toEqual([]);
    expect(prisma.priceHistoryPoint.findMany).toHaveBeenCalledOnce();
    expect(prisma.token.findMany).toHaveBeenCalledOnce();
  });

  it("queries a canonical pair id so reverse swaps stay in the same history stream", async () => {
    const prisma = {
      token: {
        findMany: vi.fn().mockResolvedValue([
          {
            address: TOKEN_IN,
            symbol: "TKA",
            name: "Token A",
            decimals: 18,
          },
          {
            address: TOKEN_OUT,
            symbol: "TKB",
            name: "Token B",
            decimals: 6,
          },
        ]),
      },
      priceHistoryPoint: {
        findMany: vi.fn().mockResolvedValue([
          {
            tokenIn: TOKEN_OUT,
            tokenOut: TOKEN_IN,
            amountIn: "3000000",
            amountOut: "1000000000000000000",
            timestamp: new Date("2026-03-14T00:20:00Z"),
            blockNumber: 2,
            logIndex: 0,
          },
        ]),
      },
    };

    const result = await resolvers.Query.priceHistory(
      undefined,
      {
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        from: unixSeconds("2026-03-14T00:00:00Z"),
        to: unixSeconds("2026-03-14T01:00:00Z"),
      },
      { prisma } as never,
    );

    expect(prisma.priceHistoryPoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pairId: `${TOKEN_IN.toLowerCase()}:${TOKEN_OUT.toLowerCase()}`,
        }),
      }),
    );
    expect(result).toEqual([
      {
        timestamp: unixSeconds("2026-03-14T00:00:00Z"),
        open: "3",
        high: "3",
        low: "3",
        close: "3",
        volumeIn: "1",
        volumeOut: "3",
        trades: 1,
      },
    ]);
  });
});

describe("Query.protocolStats", () => {
  it("returns estimated USD metrics with coverage metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T12:00:00Z"));

    const prisma = {
      token: {
        findMany: vi.fn().mockResolvedValue([
          {
            address: TOKEN_IN,
            symbol: "tDOT",
            name: "Test DOT",
            decimals: 18,
          },
          {
            address: TOKEN_OUT,
            symbol: "tUSDC",
            name: "Test USDC",
            decimals: 6,
          },
        ]),
      },
      oracleState: {
        findMany: vi.fn().mockResolvedValue([
          { asset: "DOT", price: "500000000", decimals: 8 },
        ]),
      },
      vaultState: {
        findFirst: vi.fn().mockResolvedValue({
          totalAssets: "10000000000000000000",
        }),
      },
      swapExecution: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              tokenIn: TOKEN_IN,
              tokenOut: TOKEN_OUT,
              amountIn: "1000000000000000000",
              amountOut: "5000000",
              recipient: "0xabc",
              poolType: "UniswapV2",
              hops: 1,
              timestamp: new Date("2026-03-20T10:00:00Z"),
            },
            {
              tokenIn: TOKEN_OUT,
              tokenOut: TOKEN_IN,
              amountIn: "200000000",
              amountOut: "40000000000000000000",
              recipient: "0xdef",
              poolType: "HydrationOmnipool",
              hops: 1,
              timestamp: new Date("2026-03-20T11:00:00Z"),
            },
          ])
          .mockResolvedValueOnce([
            {
              tokenIn: TOKEN_IN,
              tokenOut: TOKEN_OUT,
              amountIn: "1000000000000000000",
              amountOut: "5000000",
              recipient: "0xabc",
              poolType: "UniswapV2",
              hops: 1,
              timestamp: new Date("2026-03-20T10:00:00Z"),
            },
            {
              tokenIn: TOKEN_OUT,
              tokenOut: TOKEN_IN,
              amountIn: "200000000",
              amountOut: "40000000000000000000",
              recipient: "0xdef",
              poolType: "HydrationOmnipool",
              hops: 1,
              timestamp: new Date("2026-03-20T11:00:00Z"),
            },
            {
              tokenIn: TOKEN_IN,
              tokenOut: TOKEN_OUT,
              amountIn: "3000000000000000000",
              amountOut: "15000000",
              recipient: "0xabc",
              poolType: "UniswapV2",
              hops: 1,
              timestamp: new Date("2026-03-19T11:00:00Z"),
            },
          ]),
        count: vi.fn().mockResolvedValue(42),
      },
    };

    const result = await resolvers.Query.protocolStats(
      undefined,
      {},
      { prisma } as never,
    );

    expect(result).toEqual({
      volume24h: "205.00",
      feeRevenue24h: "0.61",
      uniqueTraders7d: 2,
      tvl: "50.00",
      totalSwaps: 42,
      activeAdapters: 2,
      pricedSwapCoverage24h: 2,
      estimationNote: expect.stringContaining("stable-token parity"),
    });
  });
});

describe("Query.topRoutes", () => {
  it("formats grouped route usage with token labels and estimated volume", async () => {
    const prisma = {
      token: {
        findMany: vi.fn().mockResolvedValue([
          {
            address: TOKEN_IN,
            symbol: "tDOT",
            name: "Test DOT",
            decimals: 18,
          },
          {
            address: TOKEN_OUT,
            symbol: "tUSDC",
            name: "Test USDC",
            decimals: 6,
          },
        ]),
      },
      oracleState: {
        findMany: vi.fn().mockResolvedValue([
          { asset: "DOT", price: "500000000", decimals: 8 },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        {
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          poolType: "UniswapV2",
          hops: 1,
          swapCount: 7,
          amountInTotal: "300000000000000000000",
          amountOutTotal: "1500000000",
          lastSwapAt: new Date("2026-03-20T11:00:00Z"),
        },
      ]),
    };

    const result = await resolvers.Query.topRoutes(
      undefined,
      { limit: 5 },
      { prisma } as never,
    );

    expect(result).toEqual([
      {
        routeKey: `${TOKEN_IN.toLowerCase()}:${TOKEN_OUT.toLowerCase()}:UniswapV2:1`,
        label: "tDOT -> tUSDC via UniswapV2",
        tokenIn: TOKEN_IN,
        tokenInSymbol: "tDOT",
        tokenOut: TOKEN_OUT,
        tokenOutSymbol: "tUSDC",
        poolType: "UniswapV2",
        hops: 1,
        swapCount: 7,
        amountInTotal: "300",
        amountOutTotal: "1,500",
        estimatedVolumeUsd: "1500.00",
        priced: true,
        lastSwapAt: "2026-03-20T11:00:00.000Z",
      },
    ]);
  });
});

describe("Query.poolAnalytics", () => {
  it("builds per-pair price range and estimated fee totals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T12:00:00Z"));

    const prisma = {
      token: {
        findMany: vi.fn().mockResolvedValue([
          {
            address: TOKEN_IN,
            symbol: "tDOT",
            name: "Test DOT",
            decimals: 18,
          },
          {
            address: TOKEN_OUT,
            symbol: "tUSDC",
            name: "Test USDC",
            decimals: 6,
          },
        ]),
      },
      oracleState: {
        findMany: vi.fn().mockResolvedValue([
          { asset: "DOT", price: "500000000", decimals: 8 },
        ]),
      },
      swapExecution: {
        findMany: vi.fn().mockResolvedValue([
          {
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: "1000000000000000000",
            amountOut: "5000000",
            recipient: "0xabc",
            poolType: "UniswapV2",
            hops: 1,
            timestamp: new Date("2026-03-20T10:10:00Z"),
            blockNumber: 1,
            logIndex: 0,
          },
          {
            tokenIn: TOKEN_OUT,
            tokenOut: TOKEN_IN,
            amountIn: "12000000",
            amountOut: "2000000000000000000",
            recipient: "0xdef",
            poolType: "UniswapV2",
            hops: 1,
            timestamp: new Date("2026-03-20T10:20:00Z"),
            blockNumber: 2,
            logIndex: 0,
          },
        ]),
      },
    };

    const result = await resolvers.Query.poolAnalytics(
      undefined,
      { pair: "tDOT/tUSDC", window: "24H" },
      { prisma } as never,
    );

    expect(result).toEqual({
      pair: "tDOT/tUSDC",
      window: "24H",
      volumeIn: "3",
      volumeOut: "17",
      estimatedVolumeUsd: "17.00",
      estimatedFeesUsd: "0.05",
      tradeCount: 2,
      pricedTrades: 2,
      priceHigh: "6",
      priceLow: "5",
      lastPrice: "6",
    });
  });
});
