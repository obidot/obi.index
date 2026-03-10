// ── Intent Signer ────────────────────────────────────────
// Signs EIP-712 UniversalIntent using the agent's private key.

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
  INTENT_DOMAIN,
  INTENT_TYPES,
} from "./builder.js";
import { logger } from "../../utils/logger.js";

// Custom chain definition
const polkadotHubTestnet = {
  id: CHAIN_ID,
  name: "Polkadot Hub TestNet",
  nativeCurrency: { name: "DOT", symbol: "DOT", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
} as const;

let _wallet: WalletClient | null = null;
let _account: ReturnType<typeof privateKeyToAccount> | null = null;

function getWallet(): {
  wallet: WalletClient;
  account: ReturnType<typeof privateKeyToAccount>;
} {
  if (!AGENT_PRIVATE_KEY) {
    throw new Error("AGENT_PRIVATE_KEY is not configured");
  }

  if (!_wallet || !_account) {
    _account = privateKeyToAccount(AGENT_PRIVATE_KEY as Hex);
    _wallet = createWalletClient({
      account: _account,
      chain: polkadotHubTestnet,
      transport: http(RPC_URL),
    });
  }

  return { wallet: _wallet, account: _account };
}

/** Get the agent's address */
export function getAgentAddress(): Address {
  const { account } = getWallet();
  return account.address;
}

/**
 * Sign a UniversalIntent using EIP-712 typed data.
 * Returns the signature bytes.
 */
export async function signIntent(intent: UniversalIntent): Promise<Hex> {
  const { account } = getWallet();

  const signature = await account.signTypedData({
    domain: {
      name: INTENT_DOMAIN.name,
      version: INTENT_DOMAIN.version,
      chainId: INTENT_DOMAIN.chainId,
      verifyingContract: INTENT_DOMAIN.verifyingContract,
    },
    types: INTENT_TYPES,
    primaryType: "UniversalIntent",
    message: {
      tokenIn: intent.tokenIn,
      tokenOut: intent.tokenOut,
      amountIn: intent.amountIn,
      minAmountOut: intent.minAmountOut,
      destination: intent.destination,
      targetChain: intent.targetChain,
      targetProtocol: intent.targetProtocol,
      deadline: intent.deadline,
      nonce: intent.nonce,
      strategist: intent.strategist,
    },
  });

  logger.info(
    { signer: account.address, nonce: intent.nonce.toString() },
    "Intent signed",
  );

  return signature;
}
