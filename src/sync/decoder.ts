// ── Event Log Decoder (viem) ─────────────────────────────
// Decodes raw Blockscout log entries into typed event data using viem ABI.

import { decodeEventLog, type Abi, type DecodeEventLogReturnType } from "viem";
import type { BlockscoutLog } from "./blockscout.js";
import { logger } from "../utils/logger.js";

/** Decoded event with metadata */
export interface DecodedEvent {
  contractName: string;
  contractAddress: string;
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  timestamp: Date;
}

/**
 * Decode a single Blockscout log entry against a given ABI.
 * Returns null if the log doesn't match any event in the ABI.
 */
export function decodeLog(
  log: BlockscoutLog,
  abi: Abi,
  contractName: string,
): DecodedEvent | null {
  try {
    const topics = log.topics.filter(Boolean) as [
      `0x${string}`,
      ...`0x${string}`[],
    ];
    if (topics.length === 0) return null;

    const decoded: DecodeEventLogReturnType = decodeEventLog({
      abi,
      data: log.data as `0x${string}`,
      topics,
    });

    return {
      contractName,
      contractAddress: log.address.hash,
      eventName: decoded.eventName,
      args: (decoded.args ?? {}) as Record<string, unknown>,
      blockNumber: log.block_number,
      txHash: log.transaction_hash,
      logIndex: log.log_index,
      timestamp: new Date(log.block_timestamp),
    };
  } catch {
    // Log doesn't match any event in this ABI — expected for
    // non-matching contracts or internal OZ events
    logger.trace(
      {
        topic0: log.topics[0],
        contract: contractName,
        block: log.block_number,
      },
      "Could not decode log (likely non-matching event)",
    );
    return null;
  }
}

/**
 * Decode a batch of Blockscout logs against a given ABI.
 * Skips logs that don't match any event.
 */
export function decodeLogs(
  logs: BlockscoutLog[],
  abi: Abi,
  contractName: string,
): DecodedEvent[] {
  const decoded: DecodedEvent[] = [];
  for (const log of logs) {
    const event = decodeLog(log, abi, contractName);
    if (event) decoded.push(event);
  }
  return decoded;
}
