// ── RPC Helpers (eth_call via viem) ──────────────────────
// Used for reading current contract state (totalAssets, paused, latestRoundData, etc.)

import {
  createPublicClient,
  http,
  type PublicClient,
  type Address,
  type Abi,
} from "viem";
import { RPC_URL, CHAIN_ID } from "../config/constants.js";
import {
  ADDRESSES,
  VAULT_ABI,
  KEEPER_ORACLE_ABI,
} from "../config/contracts.js";
import { logger } from "../utils/logger.js";

// ── Custom chain definition for Polkadot Hub TestNet ────
const polkadotHubTestnet = {
  id: CHAIN_ID,
  name: "Polkadot Hub TestNet",
  nativeCurrency: { name: "DOT", symbol: "DOT", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
} as const;

let _client: PublicClient | null = null;
const _warnedVaultFallbackReads = new Set<string>();

/** Get or create the viem public client (singleton) */
export function getClient(): PublicClient {
  if (!_client) {
    _client = createPublicClient({
      chain: polkadotHubTestnet,
      transport: http(RPC_URL),
    });
  }
  return _client;
}

/** Read current vault state via eth_call */
export async function readVaultState(): Promise<{
  totalAssets: bigint;
  totalSupply: bigint;
  paused: boolean;
  depositCap: bigint;
  maxDailyLoss: bigint;
  totalDeposited: bigint;
  totalWithdrawn: bigint;
}> {
  const client = getClient();
  const address = ADDRESSES.ObidotVault;

  const [totalAssets, totalSupply, paused, depositCap, maxDailyLoss] =
    await Promise.all([
      client.readContract({
        address,
        abi: VAULT_ABI,
        functionName: "totalAssets",
      }),
      client.readContract({
        address,
        abi: VAULT_ABI,
        functionName: "totalSupply",
      }),
      client.readContract({ address, abi: VAULT_ABI, functionName: "paused" }),
      client.readContract({
        address,
        abi: VAULT_ABI,
        functionName: "depositCap",
      }),
      client.readContract({
        address,
        abi: VAULT_ABI,
        functionName: "maxDailyLoss",
      }),
    ]);

  // totalDeposited / totalWithdrawn may revert on this vault version — graceful fallback
  let totalDeposited: bigint = 0n;
  try {
    totalDeposited = (await client.readContract({
      address,
      abi: VAULT_ABI,
      functionName: "totalDeposited",
    })) as bigint;
  } catch (error) {
    logVaultReadFallback("totalDeposited", address, error);
  }

  // totalWithdrawn may revert on-chain — graceful fallback to 0n
  let totalWithdrawn: bigint = 0n;
  try {
    totalWithdrawn = (await client.readContract({
      address,
      abi: VAULT_ABI,
      functionName: "totalWithdrawn",
    })) as bigint;
  } catch (error) {
    logVaultReadFallback("totalWithdrawn", address, error);
  }

  logger.debug(
    {
      totalAssets: totalAssets.toString(),
      totalSupply: totalSupply.toString(),
      paused,
    },
    "Read vault state via RPC",
  );

  return {
    totalAssets: totalAssets as bigint,
    totalSupply: totalSupply as bigint,
    paused: paused as boolean,
    depositCap: depositCap as bigint,
    maxDailyLoss: maxDailyLoss as bigint,
    totalDeposited: totalDeposited as bigint,
    totalWithdrawn: totalWithdrawn as bigint,
  };
}

/** Read current oracle price via eth_call */
export async function readOracleState(): Promise<{
  roundId: number;
  price: bigint;
  updatedAt: bigint;
  decimals: number;
  heartbeat: bigint;
}> {
  const client = getClient();
  const address = ADDRESSES.KeeperOracle;

  const [roundData, decimals, heartbeat] = await Promise.all([
    client.readContract({
      address,
      abi: KEEPER_ORACLE_ABI,
      functionName: "latestRoundData",
    }),
    client.readContract({
      address,
      abi: KEEPER_ORACLE_ABI,
      functionName: "decimals",
    }),
    client.readContract({
      address,
      abi: KEEPER_ORACLE_ABI,
      functionName: "heartbeat",
    }),
  ]);

  const [roundId, answer, , updatedAt] = roundData as [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];

  return {
    roundId: Number(roundId),
    price: answer,
    updatedAt,
    decimals: Number(decimals),
    heartbeat: heartbeat as bigint,
  };
}

/** Generic eth_call wrapper */
export async function readContract<TAbi extends Abi>(
  address: Address,
  abi: TAbi,
  functionName: string,
  args: unknown[] = [],
): Promise<unknown> {
  const client = getClient();
  return client.readContract({
    address,
    abi,
    functionName,
    args,
  } as Parameters<typeof client.readContract>[0]);
}

/** Get the current block number */
export async function getBlockNumber(): Promise<number> {
  const client = getClient();
  const blockNumber = await client.getBlockNumber();
  return Number(blockNumber);
}

function logVaultReadFallback(
  fn: "totalDeposited" | "totalWithdrawn",
  address: Address,
  error: unknown,
): void {
  const key = `${address}:${fn}`;
  const reason = extractErrorReason(error);

  // Warn once per function/address to avoid log spam in poller loop.
  if (!_warnedVaultFallbackReads.has(key)) {
    _warnedVaultFallbackReads.add(key);
    logger.warn(
      { address, functionName: fn, reason },
      `${fn}() reverted — defaulting to 0 (repeated warnings suppressed)`,
    );
  }
}

function extractErrorReason(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { shortMessage?: unknown; message?: unknown };
    if (typeof e.shortMessage === "string") {
      return e.shortMessage.split("\n")[0] ?? e.shortMessage;
    }
    if (typeof e.message === "string") {
      return e.message.split("\n")[0] ?? e.message;
    }
  }
  return "execution reverted";
}
