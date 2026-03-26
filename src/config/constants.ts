// ── Chain & Environment Constants ────────────────────────
import { config } from "dotenv";

config();

export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 420420417);

export const RPC_URL =
  process.env.RPC_URL ?? "https://eth-rpc-testnet.polkadot.io/";

/**
 * Substrate WebSocket RPC endpoint — used exclusively by BlockWatcher for
 * chain_subscribeNewHeads (real-time block push). Falls back to HTTP polling
 * via RPC_URL if this endpoint is unavailable or unset.
 *
 * Default: Dwellir Paseo Asset Hub node (confirmed supporting chain_subscribeNewHeads).
 */
export const SUBSTRATE_WS_URL =
  process.env.SUBSTRATE_WS_URL ?? "wss://asset-hub-paseo-rpc.n.dwellir.com";

export const BLOCKSCOUT_URL =
  process.env.BLOCKSCOUT_URL ?? "https://blockscout-testnet.polkadot.io";

export const GRAPHQL_PORT = Number(process.env.PORT ?? 4350);

export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000);

export const RAPID_SYNC = (process.env.RAPID_SYNC ?? "true") !== "false";

export const HEAD_POLL_INTERVAL_MS = Number(
  process.env.HEAD_POLL_INTERVAL_MS ?? 1_500,
);

export const POLL_CONCURRENCY = Math.max(
  1,
  Number(process.env.POLL_CONCURRENCY ?? 4),
);

export const STATE_REFRESH_INTERVAL_MS = Number(
  process.env.STATE_REFRESH_INTERVAL_MS ?? 30_000,
);

export const START_BLOCK = Number(process.env.START_BLOCK ?? 0);

export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

// ── LLM / Agent ─────────────────────────────────────────
export const LLM_PROVIDER = process.env.LLM_PROVIDER ?? "openrouter";

/**
 * Maximum slippage in basis points for agent intent execution.
 * The vault enforces a hard 2% ceiling on-chain; the agent uses this value
 * to compute the minOut floor before signing — set lower for extra safety.
 * Default: 200 (2%) — matches the vault's on-chain SlippageGuard.
 */
export const AGENT_MAX_SLIPPAGE_BPS = Number(
  process.env.AGENT_MAX_SLIPPAGE_BPS ?? 200,
);

export const LLM_API_KEY = process.env.LLM_API_KEY ?? "";

export const LLM_MODEL = process.env.LLM_MODEL ?? "anthropic/claude-sonnet-4";

export const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY ?? "";

// ── Database ─────────────────────────────────────────────
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://obidot:obidot@localhost:5432/obidot_index";
