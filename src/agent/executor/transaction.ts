// ── Transaction Executor ─────────────────────────────────
// Submits signed intents + strategy transactions to the vault on-chain.

import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  type Address,
  type Hex,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AGENT_PRIVATE_KEY,
  RPC_URL,
  CHAIN_ID,
} from "../../config/constants.js";
import { ADDRESSES } from "../../config/contracts.js";
import type { UniversalIntent } from "../intent/builder.js";
import { logger } from "../../utils/logger.js";

const polkadotHubTestnet = {
  id: CHAIN_ID,
  name: "Polkadot Hub TestNet",
  nativeCurrency: { name: "DOT", symbol: "DOT", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
} as const;

// executeIntent ABI fragment
const EXECUTE_INTENT_ABI = [
  {
    type: "function",
    name: "executeIntent",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
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
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export class TransactionExecutor {
  private wallet: WalletClient;
  private publicClient: PublicClient;

  constructor() {
    if (!AGENT_PRIVATE_KEY) {
      throw new Error(
        "AGENT_PRIVATE_KEY is required for transaction execution",
      );
    }

    const account = privateKeyToAccount(AGENT_PRIVATE_KEY as Hex);

    this.wallet = createWalletClient({
      account,
      chain: polkadotHubTestnet,
      transport: http(RPC_URL),
    });

    this.publicClient = createPublicClient({
      chain: polkadotHubTestnet,
      transport: http(RPC_URL),
    });
  }

  /**
   * Submit an executeIntent transaction to the vault.
   */
  async executeIntent(intent: UniversalIntent, signature: Hex): Promise<Hex> {
    const data = encodeFunctionData({
      abi: EXECUTE_INTENT_ABI,
      functionName: "executeIntent",
      args: [
        {
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
        signature,
      ],
    });

    try {
      // Estimate gas first
      const gasEstimate = await this.publicClient.estimateGas({
        account: this.wallet.account!.address,
        to: ADDRESSES.ObidotVault,
        data,
      });

      logger.info(
        { gasEstimate: gasEstimate.toString(), nonce: intent.nonce.toString() },
        "Gas estimated for executeIntent",
      );

      // Send transaction
      const txHash = await this.wallet.sendTransaction({
        account: this.wallet.account!,
        to: ADDRESSES.ObidotVault,
        data,
        gas: (gasEstimate * 120n) / 100n, // 20% buffer
        chain: polkadotHubTestnet,
      });

      logger.info(
        { txHash, nonce: intent.nonce.toString() },
        "Intent transaction sent",
      );

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      if (receipt.status === "success") {
        logger.info(
          { txHash, blockNumber: receipt.blockNumber },
          "Intent transaction confirmed",
        );
      } else {
        logger.error(
          { txHash, status: receipt.status },
          "Intent transaction reverted",
        );
      }

      return txHash;
    } catch (error) {
      logger.error(
        { error, nonce: intent.nonce.toString() },
        "Failed to execute intent",
      );
      throw error;
    }
  }

  /** Get current nonce for the agent address */
  async getNonce(): Promise<bigint> {
    const count = await this.publicClient.getTransactionCount({
      address: this.wallet.account!.address as Address,
    });
    return BigInt(count);
  }
}
