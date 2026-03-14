// ── Intent Builder ───────────────────────────────────────
// Builds EIP-712 UniversalIntent and StrategyIntent structs for the AI agent.
// Mirrors IntentTypes.sol, IntentDomain.sol, and ObidotVault.sol exactly.

import { type Address, type Hex } from "viem";
import { ADDRESSES } from "../../config/contracts.js";
import { CHAIN_ID } from "../../config/constants.js";

// ─────────────────────────────────────────────────────────────────────────────
//  DestType enum — mirrors IntentTypes.sol
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Destination discriminator for UniversalIntent.
 * Native = XCM dispatch via XCMExecutor (parachain).
 * Hyper  = Hyperbridge ISMP dispatch via HyperExecutor (EVM chain).
 */
export enum DestType {
  Native = 0, // XCM → parachain
  Hyper = 1, // Hyperbridge → EVM chain
}

// ─────────────────────────────────────────────────────────────────────────────
//  Structs — mirror IntentTypes.sol exactly
// ─────────────────────────────────────────────────────────────────────────────

/** On-chain asset descriptor: (token address, remote assetId). */
export interface Asset {
  token: Address;
  assetId: bigint;
}

/** Routing destination: transport layer + chain identifier. */
export interface Destination {
  destType: DestType; // uint8
  paraId: number; // uint32 — populated when destType == Native
  chainId: number; // uint8  — populated when destType == Hyper (0=ETH, 1=Base, 2=Arb)
}

/**
 * Canonical cross-chain intent struct, mirrors IntentTypes.UniversalIntent.
 * All amounts are 18-decimal normalised.
 */
export interface UniversalIntent {
  inAsset: Asset;
  outAsset: Asset;
  amount: bigint;
  minOut: bigint;
  dest: Destination;
  calldata_: Hex; // SCALE-encoded XCM (Native) or ABI-encoded calldata (Hyper)
  nonce: bigint;
  deadline: bigint;
}

/**
 * StrategyIntent struct for executeLocalSwap and executeStrategy.
 * Mirrors ObidotVault.StrategyIntent.
 */
export interface StrategyIntent {
  asset: Address;
  amount: bigint;
  minReturn: bigint;
  maxSlippageBps: bigint;
  deadline: bigint;
  nonce: bigint;
  xcmCall: Hex; // SCALE-encoded XCM payload (empty "0x" for local swaps)
  targetParachain: number; // uint32 (0 = local swap sentinel)
  targetProtocol: Address;
}

// ─────────────────────────────────────────────────────────────────────────────
//  EIP-712 Domain
// ─────────────────────────────────────────────────────────────────────────────

/** EIP-712 domain for ObidotVault — must match DOMAIN_SEPARATOR() in the contract. */
export const INTENT_DOMAIN = {
  name: "ObidotVault",
  version: "1",
  chainId: BigInt(CHAIN_ID),
  verifyingContract: ADDRESSES.ObidotVault,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
//  EIP-712 Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EIP-712 types for UniversalIntent.
 * Must match UNIVERSAL_INTENT_TYPEHASH in IntentDomain.sol exactly:
 *   "UniversalIntent(Asset inAsset,Asset outAsset,uint256 amount,uint256 minOut,
 *    Destination dest,bytes calldata_,uint256 nonce,uint256 deadline)"
 *   "Asset(address token,uint256 assetId)"
 *   "Destination(uint8 destType,uint32 paraId,uint8 chainId)"
 */
export const UNIVERSAL_INTENT_TYPES = {
  UniversalIntent: [
    { name: "inAsset", type: "Asset" },
    { name: "outAsset", type: "Asset" },
    { name: "amount", type: "uint256" },
    { name: "minOut", type: "uint256" },
    { name: "dest", type: "Destination" },
    { name: "calldata_", type: "bytes" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  Asset: [
    { name: "token", type: "address" },
    { name: "assetId", type: "uint256" },
  ],
  Destination: [
    { name: "destType", type: "uint8" },
    { name: "paraId", type: "uint32" },
    { name: "chainId", type: "uint8" },
  ],
} as const;

/**
 * EIP-712 types for StrategyIntent.
 * Must match the typehash in ObidotVault.sol:
 *   "StrategyIntent(address asset,uint256 amount,uint256 minReturn,
 *    uint256 maxSlippageBps,uint256 deadline,uint256 nonce,
 *    bytes xcmCall,uint32 targetParachain,address targetProtocol)"
 */
export const STRATEGY_INTENT_TYPES = {
  StrategyIntent: [
    { name: "asset", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "minReturn", type: "uint256" },
    { name: "maxSlippageBps", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "xcmCall", type: "bytes" },
    { name: "targetParachain", type: "uint32" },
    { name: "targetProtocol", type: "address" },
  ],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
//  Builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a UniversalIntent for cross-chain dispatch (XCM or Hyperbridge).
 * Used with ObidotVault.executeIntent() — requires SOLVER_ROLE.
 */
export function buildUniversalIntent(params: {
  inToken: Address;
  inAssetId?: bigint;
  outToken: Address;
  outAssetId?: bigint;
  amount: bigint;
  minOut: bigint; // oracle-derived floor; must be > 0
  dest: Destination;
  calldata_?: Hex; // SCALE-encoded XCM or ABI calldata
  nonce: bigint; // from vault.intentNonces(agentAddress)
  deadlineSeconds?: number;
}): UniversalIntent {
  const deadline = BigInt(
    Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 300),
  );

  return {
    inAsset: {
      token: params.inToken,
      assetId: params.inAssetId ?? 0n,
    },
    outAsset: {
      token: params.outToken,
      assetId: params.outAssetId ?? 0n,
    },
    amount: params.amount,
    minOut: params.minOut,
    dest: params.dest,
    calldata_: params.calldata_ ?? "0x",
    nonce: params.nonce,
    deadline,
  };
}

/**
 * Build a StrategyIntent for local swaps via executeLocalSwap().
 * Used with ObidotVault.executeLocalSwap() — requires STRATEGIST_ROLE.
 *
 * @param nonce  From vault.nonces(agentAddress) — separate from intentNonces.
 */
export function buildStrategyIntent(params: {
  asset: Address; // vault underlying ERC-20
  amount: bigint;
  minReturn: bigint;
  maxSlippageBps?: bigint;
  nonce: bigint; // from vault.nonces(agentAddress)
  deadlineSeconds?: number;
  targetProtocol?: Address;
}): StrategyIntent {
  const deadline = BigInt(
    Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 300),
  );

  return {
    asset: params.asset,
    amount: params.amount,
    minReturn: params.minReturn,
    maxSlippageBps: params.maxSlippageBps ?? 200n, // 2% default
    deadline,
    nonce: params.nonce,
    xcmCall: "0x", // empty for local swaps
    targetParachain: 0, // 0 = local sentinel
    targetProtocol:
      params.targetProtocol ??
      "0x0000000000000000000000000000000000000000",
  };
}

/**
 * Compute oracle-derived minOut floor, mirroring the on-chain calculation:
 *   _min = amount * oracleAnswer * (BPS_DENOMINATOR - 200) / (BPS_DENOMINATOR * 10^decimals)
 *
 * The agent MUST set minOut >= this value or the vault will revert.
 *
 * @param amount        Amount of inAsset (18-decimal).
 * @param oracleAnswer  Raw oracle answer (e.g. 8-decimal Chainlink price).
 * @param oracleDecimals Oracle answer decimal places.
 * @param slippageBps   Additional agent-side slippage buffer (default 0 — let contract enforce 2%).
 */
export function computeMinOut(
  amount: bigint,
  oracleAnswer: bigint,
  oracleDecimals: number,
  slippageBps: bigint = 0n,
): bigint {
  if (oracleAnswer <= 0n) return 0n;
  const bpsDenominator = 10_000n;
  const maxSlippage = 200n; // 2% — vault enforces this ceiling
  const effectiveSlippage = slippageBps > maxSlippage ? maxSlippage : slippageBps;
  const numerator = amount * oracleAnswer * (bpsDenominator - effectiveSlippage);
  const denominator = bpsDenominator * 10n ** BigInt(oracleDecimals);
  // Floor division — matches Math.Rounding.Floor in the vault
  return numerator / denominator;
}
