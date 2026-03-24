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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    const { fetchLogs } = await import("../src/sync/blockscout.js");
    const result = await fetchLogs("0x1234", 0);
    expect(result).toEqual([]);
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
});
