// ── Decoder Unit Tests ────────────────────────────────────
// Tests decodeLog / decodeLogs against real ABI fragments.

import { describe, it, expect } from "vitest";
import {
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { decodeLog, decodeLogs } from "../src/sync/decoder.js";
import { VAULT_ABI, SWAP_ROUTER_ABI } from "../src/config/contracts.js";
import type { BlockscoutLog } from "../src/sync/blockscout.js";

// ── Helpers ────────────────────────────────────────────────

function makeLog(overrides: Partial<BlockscoutLog> = {}): BlockscoutLog {
  return {
    address: { hash: "0x1234567890abcdef1234567890abcdef12345678" },
    data: "0x",
    topics: [],
    block_number: 100,
    block_hash: "0xabc",
    transaction_hash: "0xdeadbeef",
    log_index: 0,
    block_timestamp: "2026-03-14T00:00:00.000Z",
    ...overrides,
  };
}

// Encode a Deposit event log (ERC-4626)
function encodeDepositLog(): BlockscoutLog {
  const sender = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
  const owner = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
  const assets = 1_000_000n;
  const shares = 999_000n;

  const topics = encodeEventTopics({
    abi: VAULT_ABI,
    eventName: "Deposit",
    args: { sender, owner },
  }) as string[];

  const data = encodeAbiParameters(
    parseAbiParameters("uint256 assets, uint256 shares"),
    [assets, shares],
  );

  return makeLog({ topics, data });
}

// Encode a Swapped event log
function encodeSwappedLog(): BlockscoutLog {
  const senderAddr =
    "0xcccccccccccccccccccccccccccccccccccccccc" as `0x${string}`;
  const tokenIn = "0xdddddddddddddddddddddddddddddddddddddddd" as `0x${string}`;
  const tokenOut =
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as `0x${string}`;
  const amountIn = 500n;
  const amountOut = 490n;
  const poolType = 0;

  const topics = encodeEventTopics({
    abi: SWAP_ROUTER_ABI,
    eventName: "Swapped",
    args: { sender: senderAddr, tokenIn, tokenOut },
  }) as string[];

  const data = encodeAbiParameters(
    parseAbiParameters("uint256 amountIn, uint256 amountOut, uint8 poolType"),
    [amountIn, amountOut, poolType],
  );

  return makeLog({ topics, data });
}

// ── Tests ──────────────────────────────────────────────────

describe("decodeLog", () => {
  it("decodes a Deposit event correctly", () => {
    const log = encodeDepositLog();
    const event = decodeLog(log, VAULT_ABI, "ObidotVault");

    expect(event).not.toBeNull();
    expect(event!.eventName).toBe("Deposit");
    expect(event!.contractName).toBe("ObidotVault");
    expect(event!.blockNumber).toBe(100);
    expect(event!.txHash).toBe("0xdeadbeef");
    expect(String(event!.args.assets)).toBe("1000000");
    expect(String(event!.args.shares)).toBe("999000");
  });

  it("decodes a Swapped event correctly", () => {
    const log = encodeSwappedLog();
    const event = decodeLog(log, SWAP_ROUTER_ABI, "SwapRouter");

    expect(event).not.toBeNull();
    expect(event!.eventName).toBe("Swapped");
    expect(String(event!.args.amountIn)).toBe("500");
    expect(String(event!.args.amountOut)).toBe("490");
    expect(Number(event!.args.poolType)).toBe(0);
  });

  it("returns null for a log with no topics", () => {
    const log = makeLog({ topics: [] });
    expect(decodeLog(log, VAULT_ABI, "ObidotVault")).toBeNull();
  });

  it("returns null for a log that doesn't match the ABI (wrong topic)", () => {
    // A Deposit log tried against SwapRouter ABI — should return null
    const log = encodeDepositLog();
    const result = decodeLog(log, SWAP_ROUTER_ABI, "SwapRouter");
    expect(result).toBeNull();
  });

  it("sets timestamp from block_timestamp", () => {
    const log = encodeDepositLog();
    const event = decodeLog(log, VAULT_ABI, "ObidotVault");
    expect(event!.timestamp).toBeInstanceOf(Date);
    expect(event!.timestamp.getFullYear()).toBe(2026);
  });
});

describe("decodeLogs", () => {
  it("returns only matching events from a mixed batch", () => {
    const deposit = encodeDepositLog();
    const swap = encodeSwappedLog();
    const empty = makeLog({ topics: [] });

    // Only Deposit matches VAULT_ABI
    const events = decodeLogs([deposit, swap, empty], VAULT_ABI, "ObidotVault");
    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe("Deposit");
  });

  it("returns empty array for an empty log list", () => {
    expect(decodeLogs([], VAULT_ABI, "ObidotVault")).toEqual([]);
  });
});
