// ── Blockscout REST Client ───────────────────────────────
// Fetches event logs per contract via GET /api/v2/addresses/{addr}/logs
// Because eth_getLogs is broken on PolkaVM, this is the only reliable source.

import { BLOCKSCOUT_URL } from "../config/constants.js";
import { logger } from "../utils/logger.js";

/** Raw log entry from Blockscout REST API */
export interface BlockscoutLog {
  address: { hash: string };
  data: string;
  topics: string[];
  block_number: number;
  block_hash: string;
  transaction_hash: string;
  /** Actual API field name is "index", not "log_index" */
  index: number;
  /** Not returned by the logs API — enriched after fetch via /blocks/{n} */
  block_timestamp?: string; // ISO 8601
}

/** Paginated response from Blockscout */
interface BlockscoutLogsResponse {
  items: BlockscoutLog[];
  next_page_params: {
    block_number: number;
    transaction_index: number;
    log_index: number;
    items_count: number;
  } | null;
}

/**
 * Fetch event logs for a contract address from Blockscout REST API.
 * Handles pagination automatically.
 *
 * @param contractAddress - The contract to fetch logs for
 * @param fromBlock - Only return logs from this block onward (inclusive)
 * @param maxPages - Safety limit on pagination (default 50)
 * @returns Array of raw Blockscout log entries
 */
/** Milliseconds to back off after a 429 response */
const RATE_LIMIT_BACKOFF_MS = 2_000;

export async function fetchLogs(
  contractAddress: string,
  fromBlock: number = 0,
  maxPages: number = 50,
): Promise<BlockscoutLog[]> {
  const allLogs: BlockscoutLog[] = [];
  let nextPageParams: BlockscoutLogsResponse["next_page_params"] = null;
  let page = 0;

  do {
    const url = buildUrl(contractAddress, nextPageParams);
    logger.debug({ url, page }, "Fetching Blockscout logs");

    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited — back off and retry once
        const retryAfter = response.headers.get("Retry-After");
        const backoffMs = retryAfter
          ? Number(retryAfter) * 1000
          : RATE_LIMIT_BACKOFF_MS;
        logger.debug(
          { status: 429, url, backoffMs },
          "Blockscout rate limited — backing off",
        );
        await sleep(backoffMs);
        // retry the same page
        continue;
      }
      logger.error(
        { status: response.status, url },
        "Blockscout API request failed",
      );
      break;
    }

    const data = (await response.json()) as BlockscoutLogsResponse;

    // Filter logs >= fromBlock
    const filtered = data.items.filter((log) => log.block_number >= fromBlock);
    allLogs.push(...filtered);

    // If we got logs older than fromBlock, we've gone far enough
    if (
      data.items.length > 0 &&
      data.items[data.items.length - 1].block_number < fromBlock
    ) {
      break;
    }

    nextPageParams = data.next_page_params;
    page++;
  } while (nextPageParams && page < maxPages);

  // Deduplicate by (transaction_hash, index) — Blockscout cursor-based pagination
  // can return the same log on both sides of a page boundary.
  const seen = new Set<string>();
  const dedupedLogs = allLogs.filter((log) => {
    const key = `${log.transaction_hash}:${log.index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  logger.info(
    {
      contract: contractAddress,
      count: dedupedLogs.length,
      duplicates: allLogs.length - dedupedLogs.length,
      pages: page,
    },
    "Fetched logs from Blockscout",
  );

  // Enrich logs with block timestamps (not included in log API response)
  if (dedupedLogs.length > 0) {
    const uniqueBlocks = [...new Set(dedupedLogs.map((l) => l.block_number))];
    const timestamps = await fetchBlockTimestamps(uniqueBlocks);
    for (const log of dedupedLogs) {
      const ts = timestamps.get(log.block_number);
      if (ts) log.block_timestamp = ts;
    }
  }

  return dedupedLogs;
}

/**
 * Fetch a single block's timestamp from Blockscout.
 */
export async function fetchBlockTimestamp(
  blockNumber: number,
): Promise<string | null> {
  const url = `${BLOCKSCOUT_URL}/api/v2/blocks/${blockNumber}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = (await response.json()) as { timestamp: string };
    return data.timestamp;
  } catch {
    return null;
  }
}

/**
 * Batch-fetch timestamps for multiple block numbers in parallel.
 * Returns a Map<blockNumber, isoTimestamp>.
 */
export async function fetchBlockTimestamps(
  blockNumbers: number[],
): Promise<Map<number, string>> {
  const entries = await Promise.all(
    blockNumbers.map(async (n) => {
      const ts = await fetchBlockTimestamp(n);
      return [n, ts] as const;
    }),
  );
  const result = new Map<number, string>();
  for (const [n, ts] of entries) {
    if (ts) result.set(n, ts);
  }
  return result;
}

// ── Internals ────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function buildUrl(
  address: string,
  pageParams: BlockscoutLogsResponse["next_page_params"],
): string {
  const base = `${BLOCKSCOUT_URL}/api/v2/addresses/${address}/logs`;
  if (!pageParams) return base;

  const params = new URLSearchParams({
    block_number: String(pageParams.block_number),
    transaction_index: String(pageParams.transaction_index),
    log_index: String(pageParams.log_index),
    items_count: String(pageParams.items_count),
  });
  return `${base}?${params.toString()}`;
}
