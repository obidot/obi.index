// ── Blockscout Client Unit Tests ──────────────────────────
// Tests fetchLogs with mocked global fetch.

import { describe, it, expect, vi, afterEach } from "vitest";
import type { BlockscoutLog } from "../src/sync/blockscout.js";

// ── Helpers ────────────────────────────────────────────────

function makeLog(blockNumber: number, logIndex: number = 0): BlockscoutLog {
  return {
    address: { hash: "0x1234" },
    data: "0x",
    topics: ["0xabc"],
    block_number: blockNumber,
    block_hash: "0xblockhash",
    transaction_hash: `0xtx${blockNumber}`,
    index: logIndex,
  };
}

function mockFetch(
  pages: { items: BlockscoutLog[]; next_page_params: null | object }[],
): ReturnType<typeof vi.fn> {
  let callIndex = 0;
  const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
    const url = String(input);
    if (url.includes("/blocks/")) {
      const blockNumber = Number(url.split("/").pop());
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            timestamp: `2026-03-14T00:00:${String(blockNumber % 60).padStart(2, "0")}.000Z`,
          }),
      });
    }

    const page = pages[callIndex++] ?? { items: [], next_page_params: null };
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(page),
    });
  });

  vi.stubGlobal(
    "fetch",
    fetchMock,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

// ── Tests ──────────────────────────────────────────────────

describe("fetchLogs", () => {
  it("returns all logs on a single page", async () => {
    const logs = [makeLog(200), makeLog(201)];
    const fetchMock = mockFetch([{ items: logs, next_page_params: null }]);

    const { fetchLogs } = await import("../src/sync/blockscout.js");
    const result = await fetchLogs("0x1234", 0);
    expect(result).toHaveLength(2);
    expect(result[0].block_number).toBe(200);
    expect(result[0].block_timestamp).toBe("2026-03-14T00:00:20.000Z");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/logs")),
    ).toHaveLength(1);
  });

  it("filters out logs older than fromBlock", async () => {
    const logs = [makeLog(300), makeLog(100)];
    mockFetch([{ items: logs, next_page_params: null }]);

    const { fetchLogs } = await import("../src/sync/blockscout.js");
    const result = await fetchLogs("0x1234", 200);
    // makeLog(100) is filtered out
    expect(result).toHaveLength(1);
    expect(result[0].block_number).toBe(300);
  });

  it("stops pagination when last item is older than fromBlock", async () => {
    const page1 = {
      items: [makeLog(500), makeLog(150)],
      next_page_params: {
        block_number: 150,
        transaction_index: 0,
        log_index: 0,
        items_count: 50,
      },
    };
    const page2 = { items: [makeLog(100)], next_page_params: null };
    const fetchMock = mockFetch([page1, page2]);

    const { fetchLogs } = await import("../src/sync/blockscout.js");
    // page1's last item (150) < fromBlock (200) → should stop and NOT fetch page2
    const result = await fetchLogs("0x1234", 200);
    expect(result).toHaveLength(1);
    expect(result[0].block_number).toBe(500);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/logs")),
    ).toHaveLength(1);
  });

  it("returns empty array on API error (non-ok response)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    const { fetchLogs } = await import("../src/sync/blockscout.js");
    const pending = fetchLogs("0x1234", 0);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result).toEqual([]);
  });

  it("retries a rate-limited request and records retry metadata", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "0" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ items: [makeLog(700)], next_page_params: null }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ timestamp: "2026-03-14T00:00:40.000Z" }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const { fetchLogs, getBlockscoutFetchStatus } = await import(
      "../src/sync/blockscout.js"
    );
    const pending = fetchLogs("0x1234", 0);
    await vi.runAllTimersAsync();
    const result = await pending;
    const status = getBlockscoutFetchStatus();

    expect(result).toHaveLength(1);
    expect(status.lastRetryCount).toBe(1);
    expect(status.lastStatusCode).toBe(200);
    expect(status.consecutiveFailures).toBe(0);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/logs")),
    ).toHaveLength(2);
  });

  it("retries network failures up to the bounded limit", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockRejectedValueOnce(new Error("temporary dns"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ items: [makeLog(710)], next_page_params: null }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ timestamp: "2026-03-14T00:00:50.000Z" }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const { fetchLogs, getBlockscoutFetchStatus } = await import(
      "../src/sync/blockscout.js"
    );
    const pending = fetchLogs("0x1234", 0);
    await vi.runAllTimersAsync();
    const result = await pending;
    const status = getBlockscoutFetchStatus();

    expect(result).toHaveLength(1);
    expect(status.lastRetryCount).toBe(2);
    expect(status.lastError).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/logs")),
    ).toHaveLength(3);
  });

  it("uses index-based pagination params when Blockscout returns the current cursor shape", async () => {
    const page1 = {
      items: [makeLog(600), makeLog(590)],
      next_page_params: {
        block_number: 590,
        index: 7,
        items_count: 50,
      },
    };
    const page2 = {
      items: [makeLog(580)],
      next_page_params: null,
    };
    const fetchMock = mockFetch([page1, page2]);

    const { fetchLogs } = await import("../src/sync/blockscout.js");
    await fetchLogs("0x1234", 500);

    const logRequests = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/logs"));

    expect(logRequests).toHaveLength(2);
    expect(logRequests[1]).toContain("block_number=590");
    expect(logRequests[1]).toContain("index=7");
    expect(logRequests[1]).toContain("items_count=50");
  });

  it("paginates across multiple pages", async () => {
    const page1 = {
      items: [makeLog(600), makeLog(590)],
      next_page_params: {
        block_number: 590,
        transaction_index: 0,
        log_index: 0,
        items_count: 50,
      },
    };
    const page2 = {
      items: [makeLog(580), makeLog(570)],
      next_page_params: null,
    };
    const fetchMock = mockFetch([page1, page2]);

    const { fetchLogs } = await import("../src/sync/blockscout.js");
    const result = await fetchLogs("0x1234", 500);
    expect(result).toHaveLength(4);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/logs")),
    ).toHaveLength(2);
  });

  it("fetches block details for reorg verification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            hash: "0xblockhash",
            height: 123,
            parent_hash: "0xparenthash",
            timestamp: "2026-03-14T00:00:00.000Z",
          }),
      }),
    );

    const { fetchBlock } = await import("../src/sync/blockscout.js");
    const block = await fetchBlock(123);

    expect(block).toEqual({
      hash: "0xblockhash",
      height: 123,
      parent_hash: "0xparenthash",
      timestamp: "2026-03-14T00:00:00.000Z",
    });
  });
});

describe("fetchTransactionSender", () => {
  it("returns the transaction sender from Blockscout", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.includes("/transactions/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              from: { hash: "0xSender000000000000000000000000000000000001" },
            }),
        });
      }

      throw new Error(`unexpected url ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { fetchTransactionSender } = await import("../src/sync/blockscout.js");
    const sender = await fetchTransactionSender("0xdeadbeef");

    expect(sender).toBe("0xSender000000000000000000000000000000000001");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("caches transaction sender lookups by tx hash", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          from: { hash: "0xSender000000000000000000000000000000000001" },
        }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const { fetchTransactionSender } = await import("../src/sync/blockscout.js");
    const first = await fetchTransactionSender("0xfeedface");
    const second = await fetchTransactionSender("0xfeedface");

    expect(first).toBe("0xSender000000000000000000000000000000000001");
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
