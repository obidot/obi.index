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

  const [
    totalAssets,
    totalSupply,
    paused,
    depositCap,
    maxDailyLoss,
    totalDeposited,
    totalWithdrawn,
  ] = await Promise.all([
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
    client.readContract({
      address,
      abi: VAULT_ABI,
      functionName: "totalDeposited",
    }),
    client.readContract({
      address,
      abi: VAULT_ABI,
      functionName: "totalWithdrawn",
    }),
  ]);

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
