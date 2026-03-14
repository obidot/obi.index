// ── Intent Signer ────────────────────────────────────────
// Signs UniversalIntent (EIP-712 nested structs) and StrategyIntent
// using the agent's private key via viem's signTypedData.

import {
  createWalletClient,
  http,
  type WalletClient,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AGENT_PRIVATE_KEY,
  RPC_URL,
  CHAIN_ID,
} from "../../config/constants.js";
import {
  type UniversalIntent,
  type StrategyIntent,
  INTENT_DOMAIN,
  UNIVERSAL_INTENT_TYPES,
  STRATEGY_INTENT_TYPES,
} from "./builder.js";
import { logger } from "../../utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
//  Chain Definition
// ─────────────────────────────────────────────────────────────────────────────

const polkadotHubTestnet = {
  id: CHAIN_ID,
  name: "Polkadot Hub TestNet",
  nativeCurrency: { name: "DOT", symbol: "DOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  testnet: true,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
//  Lazy Wallet Singleton
// ─────────────────────────────────────────────────────────────────────────────

let _account: ReturnType<typeof privateKeyToAccount> | null = null;
let _wallet: WalletClient | null = null;

function getWallet(): {
  account: ReturnType<typeof privateKeyToAccount>;
  wallet: WalletClient;
} {
  if (!AGENT_PRIVATE_KEY) throw new Error("AGENT_PRIVATE_KEY not configured");

  if (!_account || !_wallet) {
    _account = privateKeyToAccount(AGENT_PRIVATE_KEY as Hex);
    _wallet = createWalletClient({
      account: _account,
      chain: polkadotHubTestnet,
      transport: http(RPC_URL),
    });
  }

  return { account: _account, wallet: _wallet };
}

/** Return the agent's EVM address (derived from AGENT_PRIVATE_KEY). */
export function getAgentAddress(): Address {
  return getWallet().account.address;
}

// ─────────────────────────────────────────────────────────────────────────────
//  UniversalIntent Signing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sign a UniversalIntent using EIP-712 typed data.
 *
 * The nested Asset and Destination sub-types are included in the type
 * definition so viem computes the same typehash as IntentDomain.sol:
 *   UNIVERSAL_INTENT_TYPEHASH = keccak256(
 *     "UniversalIntent(Asset inAsset,Asset outAsset,uint256 amount,uint256 minOut,
 *      Destination dest,bytes calldata_,uint256 nonce,uint256 deadline)"
 *     "Asset(address token,uint256 assetId)"
 *     "Destination(uint8 destType,uint32 paraId,uint8 chainId)"
 *   )
 *
 * The signer must hold SOLVER_ROLE on ObidotVault to execute.
 */
export async function signUniversalIntent(intent: UniversalIntent): Promise<Hex> {
  const { account } = getWallet();

  const signature = await account.signTypedData({
    domain: {
      name: INTENT_DOMAIN.name,
      version: INTENT_DOMAIN.version,
      chainId: INTENT_DOMAIN.chainId,
      verifyingContract: INTENT_DOMAIN.verifyingContract,
    },
    types: UNIVERSAL_INTENT_TYPES,
    primaryType: "UniversalIntent",
    message: {
      inAsset: {
        token: intent.inAsset.token,
        assetId: intent.inAsset.assetId,
      },
      outAsset: {
        token: intent.outAsset.token,
        assetId: intent.outAsset.assetId,
      },
      amount: intent.amount,
      minOut: intent.minOut,
      dest: {
        destType: intent.dest.destType,
        paraId: intent.dest.paraId,
        chainId: intent.dest.chainId,
      },
      calldata_: intent.calldata_,
      nonce: intent.nonce,
      deadline: intent.deadline,
    },
  });

  logger.info(
    { signer: account.address, nonce: intent.nonce.toString() },
    "UniversalIntent signed",
  );

  return signature;
}

// ─────────────────────────────────────────────────────────────────────────────
//  StrategyIntent Signing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sign a StrategyIntent using EIP-712 typed data.
 *
 * Typehash matches ObidotVault.sol line 61:
 *   "StrategyIntent(address asset,uint256 amount,uint256 minReturn,
 *    uint256 maxSlippageBps,uint256 deadline,uint256 nonce,
 *    bytes xcmCall,uint32 targetParachain,address targetProtocol)"
 *
 * The signer must hold STRATEGIST_ROLE on ObidotVault to execute.
 */
export async function signStrategyIntent(intent: StrategyIntent): Promise<Hex> {
  const { account } = getWallet();

  const signature = await account.signTypedData({
    domain: {
      name: INTENT_DOMAIN.name,
      version: INTENT_DOMAIN.version,
      chainId: INTENT_DOMAIN.chainId,
      verifyingContract: INTENT_DOMAIN.verifyingContract,
    },
    types: STRATEGY_INTENT_TYPES,
    primaryType: "StrategyIntent",
    message: {
      asset: intent.asset,
      amount: intent.amount,
      minReturn: intent.minReturn,
      maxSlippageBps: intent.maxSlippageBps,
      deadline: intent.deadline,
      nonce: intent.nonce,
      xcmCall: intent.xcmCall,
      targetParachain: intent.targetParachain,
      targetProtocol: intent.targetProtocol,
    },
  });

  logger.info(
    { signer: account.address, nonce: intent.nonce.toString() },
    "StrategyIntent signed",
  );

  return signature;
}
