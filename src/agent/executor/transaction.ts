// ── Transaction Executor ─────────────────────────────────
// Submits signed intents to the vault on-chain.
// Handles UniversalIntent (executeIntent) and StrategyIntent (executeLocalSwap).

import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  type WalletClient,
  type PublicClient,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AGENT_PRIVATE_KEY, RPC_URL, CHAIN_ID } from "../../config/constants.js";
import { ADDRESSES } from "../../config/contracts.js";
import type { UniversalIntent, StrategyIntent } from "../intent/builder.js";
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
//  ABI Fragments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * executeIntent ABI — correct nested tuple structure matching IntentTypes.sol.
 * inAsset/outAsset are (address token, uint256 assetId).
 * dest is (uint8 destType, uint32 paraId, uint8 chainId).
 */
const EXECUTE_INTENT_ABI = [
  {
    type: "function",
    name: "executeIntent",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          {
            name: "inAsset",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "assetId", type: "uint256" },
            ],
          },
          {
            name: "outAsset",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "assetId", type: "uint256" },
            ],
          },
          { name: "amount", type: "uint256" },
          { name: "minOut", type: "uint256" },
          {
            name: "dest",
            type: "tuple",
            components: [
              { name: "destType", type: "uint8" },
              { name: "paraId", type: "uint32" },
              { name: "chainId", type: "uint8" },
            ],
          },
          { name: "calldata_", type: "bytes" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "messageId", type: "uint64" }],
    stateMutability: "nonpayable",
  },
] as const;

/**
 * executeLocalSwap ABI — takes (SwapParams params, StrategyIntent intent, bytes sig).
 * SwapParams is a flat struct with a nested Route.
 */
const EXECUTE_LOCAL_SWAP_ABI = [
  {
    type: "function",
    name: "executeLocalSwap",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "route",
            type: "tuple",
            components: [
              { name: "poolType", type: "uint8" },
              { name: "pool", type: "address" },
              { name: "tokenIn", type: "address" },
              { name: "tokenOut", type: "address" },
              { name: "feeBps", type: "uint256" },
              { name: "data", type: "bytes32" },
            ],
          },
          { name: "amountIn", type: "uint256" },
          { name: "minAmountOut", type: "uint256" },
          { name: "to", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        name: "intent",
        type: "tuple",
        components: [
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
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [
      { name: "strategyId", type: "uint256" },
      { name: "amountOut", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
] as const;

/** intentNonces ABI — for reading the per-strategist nonce used by executeIntent. */
const INTENT_NONCES_ABI = [
  {
    type: "function",
    name: "intentNonces",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/** nonces ABI — for reading the per-strategist nonce used by executeStrategy / executeLocalSwap. */
const STRATEGY_NONCES_ABI = [
  {
    type: "function",
    name: "nonces",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
//  TransactionExecutor
// ─────────────────────────────────────────────────────────────────────────────

export class TransactionExecutor {
  private readonly wallet: WalletClient;
  private readonly publicClient: PublicClient;
  private readonly agentAddress: Address;

  constructor() {
    if (!AGENT_PRIVATE_KEY) {
      throw new Error("AGENT_PRIVATE_KEY is required for transaction execution");
    }

    const account = privateKeyToAccount(AGENT_PRIVATE_KEY as Hex);
    this.agentAddress = account.address;

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

  // ─────────────────────────────────────────────────────────────────────
  //  Nonce Reads
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Fetch the next nonce for UniversalIntent signing from vault.intentNonces(agent).
   * This is the canonical replay-protection counter for executeIntent().
   */
  async getIntentNonce(): Promise<bigint> {
    const nonce = await this.publicClient.readContract({
      address: ADDRESSES.ObidotVault,
      abi: INTENT_NONCES_ABI,
      functionName: "intentNonces",
      args: [this.agentAddress],
    });

    logger.debug({ intentNonce: nonce.toString() }, "Fetched intent nonce");
    return nonce as bigint;
  }

  /**
   * Fetch the next nonce for StrategyIntent signing from vault.nonces(agent).
   * Used by executeLocalSwap() and executeStrategy().
   */
  async getStrategyNonce(): Promise<bigint> {
    const nonce = await this.publicClient.readContract({
      address: ADDRESSES.ObidotVault,
      abi: STRATEGY_NONCES_ABI,
      functionName: "nonces",
      args: [this.agentAddress],
    });

    logger.debug({ strategyNonce: nonce.toString() }, "Fetched strategy nonce");
    return nonce as bigint;
  }

  // ─────────────────────────────────────────────────────────────────────
  //  executeIntent — cross-chain (XCM or Hyperbridge)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Submit a signed UniversalIntent to ObidotVault.executeIntent().
   * Requires the agent to hold SOLVER_ROLE.
   */
  async executeIntent(intent: UniversalIntent, signature: Hex): Promise<Hex> {
    const data = encodeFunctionData({
      abi: EXECUTE_INTENT_ABI,
      functionName: "executeIntent",
      args: [
        {
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
        signature,
      ],
    });

    return this._sendAndWait(data, "executeIntent", intent.nonce.toString());
  }

  // ─────────────────────────────────────────────────────────────────────
  //  executeLocalSwap — on-hub DEX via SwapRouter
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Submit a signed StrategyIntent + SwapParams to executeLocalSwap().
   * Requires the agent to hold STRATEGIST_ROLE.
   */
  async executeLocalSwap(
    swapParams: {
      poolType: number;
      pool: Address;
      tokenIn: Address;
      tokenOut: Address;
      feeBps: bigint;
      data: Hex;
      amountIn: bigint;
      minAmountOut: bigint;
      to: Address;
      deadline: bigint;
    },
    intent: StrategyIntent,
    signature: Hex,
  ): Promise<Hex> {
    const data = encodeFunctionData({
      abi: EXECUTE_LOCAL_SWAP_ABI,
      functionName: "executeLocalSwap",
      args: [
        {
          route: {
            poolType: swapParams.poolType,
            pool: swapParams.pool,
            tokenIn: swapParams.tokenIn,
            tokenOut: swapParams.tokenOut,
            feeBps: swapParams.feeBps,
            data: swapParams.data as `0x${string}`,
          },
          amountIn: swapParams.amountIn,
          minAmountOut: swapParams.minAmountOut,
          to: swapParams.to,
          deadline: swapParams.deadline,
        },
        {
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
        signature,
      ],
    });

    return this._sendAndWait(data, "executeLocalSwap", intent.nonce.toString());
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Internal
  // ─────────────────────────────────────────────────────────────────────

  private async _sendAndWait(
    data: Hex,
    fnName: string,
    nonce: string,
  ): Promise<Hex> {
    try {
      const gasEstimate = await this.publicClient.estimateGas({
        account: this.agentAddress,
        to: ADDRESSES.ObidotVault,
        data,
      });

      logger.info(
        { gasEstimate: gasEstimate.toString(), fnName, nonce },
        "Gas estimated",
      );

      const txHash = await this.wallet.sendTransaction({
        account: this.wallet.account!,
        to: ADDRESSES.ObidotVault,
        data,
        gas: (gasEstimate * 120n) / 100n, // 20% buffer
        chain: polkadotHubTestnet,
      });

      logger.info({ txHash, fnName, nonce }, "Transaction sent");

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      if (receipt.status === "success") {
        logger.info({ txHash, blockNumber: Number(receipt.blockNumber), fnName }, "Transaction confirmed");
      } else {
        logger.error({ txHash, status: receipt.status, fnName }, "Transaction reverted");
      }

      return txHash;
    } catch (error) {
      logger.error({ error, fnName, nonce }, `Failed to submit ${fnName}`);
      throw error;
    }
  }
}
