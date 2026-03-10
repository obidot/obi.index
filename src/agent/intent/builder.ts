// ── Intent Builder ───────────────────────────────────────
// Builds EIP-712 UniversalIntent structs for the AI agent.

import { type Address } from "viem";
import { ADDRESSES } from "../../config/contracts.js";
import { CHAIN_ID } from "../../config/constants.js";
import { logger } from "../../utils/logger.js";

/** Destination enum (mirrors IntentTypes.sol) */
export enum DestType {
  Local = 0,
  Parachain = 1,
  EVMChain = 2,
}

/** UniversalIntent struct (mirrors IntentTypes.sol) */
export interface UniversalIntent {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  destination: DestType;
  targetChain: bigint;
  targetProtocol: Address;
  deadline: bigint;
  nonce: bigint;
  strategist: Address;
}

/** EIP-712 domain for ObidotVault */
export const INTENT_DOMAIN = {
  name: "ObidotVault",
  version: "1",
  chainId: BigInt(CHAIN_ID),
  verifyingContract: ADDRESSES.ObidotVault,
} as const;

/** EIP-712 type definition for UniversalIntent */
export const INTENT_TYPES = {
  UniversalIntent: [
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "destination", type: "uint8" },
    { name: "targetChain", type: "uint256" },
    { name: "targetProtocol", type: "address" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "strategist", type: "address" },
  ],
} as const;

/**
 * Build a UniversalIntent from strategy parameters.
 */
export function buildIntent(params: {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  destination: DestType;
  targetChain: bigint;
  targetProtocol: Address;
  strategist: Address;
  nonce: bigint;
  deadlineSeconds?: number;
}): UniversalIntent {
  const deadline = BigInt(
    Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 300),
  );

  const intent: UniversalIntent = {
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: params.amountIn,
    minAmountOut: params.minAmountOut,
    destination: params.destination,
    targetChain: params.targetChain,
    targetProtocol: params.targetProtocol,
    deadline,
    nonce: params.nonce,
    strategist: params.strategist,
  };

  logger.info(
    {
      tokenIn: params.tokenIn,
      amountIn: params.amountIn.toString(),
      destination: DestType[params.destination],
      deadline: deadline.toString(),
    },
    "Intent built",
  );

  return intent;
}
