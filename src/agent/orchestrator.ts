// ── Agent Orchestrator ───────────────────────────────────
// Main loop: health check → evaluate → snapshot → analyze → sign → execute.
// Handles UniversalIntent (XCM/Hyper cross-chain) and StrategyIntent (local swaps).

import { PrismaClient } from "@prisma/client";
import { StrategyEvaluator } from "./strategy/evaluator.js";
import { ArbitrageDetector } from "./strategy/arbitrage.js";
import { LLMAnalyzer } from "./llm/analyzer.js";
import { createLLMProvider } from "./llm/provider.js";
import {
  buildUniversalIntent,
  buildStrategyIntent,
  computeMinOut,
  DestType,
} from "./intent/builder.js";
import { signUniversalIntent, signStrategyIntent, getAgentAddress } from "./intent/signer.js";
import { TransactionExecutor } from "./executor/transaction.js";
import { readVaultState, readOracleState } from "../sync/rpc.js";
import { ADDRESSES } from "../config/contracts.js";
import { AGENT_MAX_SLIPPAGE_BPS } from "../config/constants.js";
import { logger } from "../utils/logger.js";
import type { Address } from "viem";

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_LOOP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MIN_CONFIDENCE = 60; // act on recommendations with >= 60% confidence
const MIN_VAULT_ASSETS = 1_000_000_000_000_000_000n; // 1 DOT — don't act on empty vault
const INTENT_DEADLINE_SECONDS = 300; // 5 minutes until intent expires

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export class Orchestrator {
  private readonly evaluator: StrategyEvaluator;
  private readonly arbitrage: ArbitrageDetector;
  private readonly analyzer: LLMAnalyzer;
  private readonly executor: TransactionExecutor;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(prisma: PrismaClient) {
    this.evaluator = new StrategyEvaluator(prisma);
    this.arbitrage = new ArbitrageDetector(prisma);
    this.analyzer = new LLMAnalyzer(createLLMProvider());
    this.executor = new TransactionExecutor();
  }

  /** Start the agent loop. Runs immediately then on AGENT_LOOP_INTERVAL_MS. */
  start(): void {
    if (this.timer) return;

    logger.info(
      { intervalMs: AGENT_LOOP_INTERVAL_MS, agentAddress: getAgentAddress() },
      "Starting agent orchestrator",
    );

    void this.cycle();
    this.timer = setInterval(() => void this.cycle(), AGENT_LOOP_INTERVAL_MS);
  }

  /** Stop the agent loop after the current cycle completes. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info("Agent orchestrator stopped");
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Cycle
  // ─────────────────────────────────────────────────────────────────────

  /** Execute a single agent decision cycle. */
  async cycle(): Promise<void> {
    if (this.running) {
      logger.warn("Previous cycle still running — skipping");
      return;
    }

    this.running = true;
    const startTime = Date.now();

    try {
      logger.info("Agent cycle started");

      // ── Phase 0: Vault health check (via live RPC) ─────────────────
      const vaultState = await readVaultState().catch(() => null);
      if (!vaultState) {
        logger.warn("Cannot read vault state via RPC — skipping cycle");
        return;
      }
      if (vaultState.paused) {
        logger.warn("Vault is paused — skipping cycle");
        return;
      }
      if (vaultState.totalAssets < MIN_VAULT_ASSETS) {
        logger.info("Vault totalAssets below 1 DOT — skipping cycle");
        return;
      }

      // ── Phase 1: Strategy evaluation ──────────────────────────────
      const [opportunities, arbOpportunities] = await Promise.all([
        this.evaluator.evaluate(),
        this.arbitrage.detect(),
      ]);
      logger.info(
        { opportunities: opportunities.length, arbitrage: arbOpportunities.length },
        "Evaluation complete",
      );

      // ── Phase 2: Build enriched LLM snapshot ──────────────────────
      const baseSnapshot = await this.evaluator.buildStateSnapshot();
      const enrichedSnapshot = JSON.stringify(
        {
          ...JSON.parse(baseSnapshot),
          yieldOpportunities: opportunities,
          arbitrageOpportunities: arbOpportunities.filter((a) => a.viable),
        },
        null,
        2,
      );

      // ── Phase 3: LLM analysis ─────────────────────────────────────
      const analysis = await this.analyzer.analyze(enrichedSnapshot);
      logger.info(
        {
          recommendation: analysis.recommendation,
          confidence: analysis.confidence,
          reasoning: analysis.reasoning,
        },
        "LLM recommendation",
      );

      // ── Phase 4: Execute if above threshold ────────────────────────
      if (
        analysis.confidence >= MIN_CONFIDENCE &&
        analysis.recommendation !== "hold" &&
        analysis.suggestedAction
      ) {
        await this._execute(analysis.recommendation, analysis.suggestedAction, vaultState);
      } else {
        logger.info(
          { confidence: analysis.confidence, threshold: MIN_CONFIDENCE },
          "Below threshold or hold — no action",
        );
      }

      logger.info({ elapsedMs: Date.now() - startTime }, "Agent cycle complete");
    } catch (error) {
      logger.error({ error }, "Agent cycle failed");
    } finally {
      this.running = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Execution Routing
  // ─────────────────────────────────────────────────────────────────────

  private async _execute(
    recommendation: string,
    action: {
      tokenIn?: string;
      tokenOut?: string;
      amount?: string;
      targetParachain?: string;
      targetChain?: string;
      protocol?: string;
      poolType?: number;
      pool?: string;
      feeBps?: string;
    },
    vaultState: { totalAssets: bigint; paused: boolean },
  ): Promise<void> {
    try {
      switch (recommendation) {
        case "xcm_strategy":
          await this._executeXcmIntent(action, vaultState.totalAssets);
          break;
        case "hyper_strategy":
          await this._executeHyperIntent(action, vaultState.totalAssets);
          break;
        case "local_swap":
        case "arbitrage":
          await this._executeLocalSwap(action, vaultState.totalAssets);
          break;
        default:
          logger.warn({ recommendation }, "Unknown recommendation type — skipping");
      }
    } catch (error) {
      logger.error({ error, recommendation }, "Execution failed");
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Cross-chain: XCM (Native DestType)
  // ─────────────────────────────────────────────────────────────────────

  private async _executeXcmIntent(
    action: { tokenIn?: string; tokenOut?: string; amount?: string; targetParachain?: string; protocol?: string },
    totalAssets: bigint,
  ): Promise<void> {
    const amount = this._validateAmount(action.amount, totalAssets);
    if (amount === null) return;

    const paraId = action.targetParachain ? Number(action.targetParachain) : 0;
    if (paraId === 0) {
      logger.warn("xcm_strategy requires a non-zero targetParachain — skipping");
      return;
    }

    const oracleState = await readOracleState().catch(() => null);
    const minOut = oracleState
      ? computeMinOut(amount, oracleState.price, oracleState.decimals, BigInt(AGENT_MAX_SLIPPAGE_BPS))
      : 0n;

    const nonce = await this.executor.getIntentNonce();

    const intent = buildUniversalIntent({
      inToken: (action.tokenIn ?? ADDRESSES.NativeAssetDOT) as Address,
      outToken: (action.tokenOut ?? ADDRESSES.NativeAssetDOT) as Address,
      amount,
      minOut,
      dest: { destType: DestType.Native, paraId, chainId: 0 },
      calldata_: "0x",
      nonce,
      deadlineSeconds: INTENT_DEADLINE_SECONDS,
    });

    const signature = await signUniversalIntent(intent);
    const txHash = await this.executor.executeIntent(intent, signature);
    logger.info({ txHash, paraId, amount: amount.toString() }, "XCM intent executed");
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Cross-chain: Hyperbridge (Hyper DestType)
  // ─────────────────────────────────────────────────────────────────────

  private async _executeHyperIntent(
    action: { tokenIn?: string; tokenOut?: string; amount?: string; targetChain?: string; protocol?: string },
    totalAssets: bigint,
  ): Promise<void> {
    const amount = this._validateAmount(action.amount, totalAssets);
    if (amount === null) return;

    // targetChain: 0=Ethereum, 1=Base, 2=Arbitrum
    const chainId = action.targetChain !== undefined ? Number(action.targetChain) : 0;

    const oracleState = await readOracleState().catch(() => null);
    const minOut = oracleState
      ? computeMinOut(amount, oracleState.price, oracleState.decimals, BigInt(AGENT_MAX_SLIPPAGE_BPS))
      : 0n;

    const nonce = await this.executor.getIntentNonce();

    const intent = buildUniversalIntent({
      inToken: (action.tokenIn ?? ADDRESSES.NativeAssetDOT) as Address,
      outToken: (action.tokenOut ?? ADDRESSES.NativeAssetDOT) as Address,
      amount,
      minOut,
      dest: { destType: DestType.Hyper, paraId: 0, chainId },
      calldata_: "0x",
      nonce,
      deadlineSeconds: INTENT_DEADLINE_SECONDS,
    });

    const signature = await signUniversalIntent(intent);
    const txHash = await this.executor.executeIntent(intent, signature);
    logger.info({ txHash, chainId, amount: amount.toString() }, "Hyperbridge intent executed");
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Local swap / arbitrage via executeLocalSwap
  // ─────────────────────────────────────────────────────────────────────

  private async _executeLocalSwap(
    action: {
      tokenIn?: string;
      tokenOut?: string;
      amount?: string;
      poolType?: number;
      pool?: string;
      feeBps?: string;
    },
    totalAssets: bigint,
  ): Promise<void> {
    const amount = this._validateAmount(action.amount, totalAssets);
    if (amount === null) return;

    const tokenIn = (action.tokenIn ?? ADDRESSES.NativeAssetDOT) as Address;
    const tokenOut = (action.tokenOut ?? ADDRESSES.NativeAssetUSDC) as Address;
    const poolType = action.poolType ?? 0; // default HydrationOmnipool
    const pool = (action.pool ?? ADDRESSES.SwapRouter) as Address;
    const feeBps = BigInt(action.feeBps ?? "30"); // default 30 bps

    const oracleState = await readOracleState().catch(() => null);
    const minAmountOut = oracleState
      ? computeMinOut(amount, oracleState.price, oracleState.decimals, BigInt(AGENT_MAX_SLIPPAGE_BPS))
      : 0n;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + INTENT_DEADLINE_SECONDS);

    const nonce = await this.executor.getStrategyNonce();

    const strategyIntent = buildStrategyIntent({
      asset: (ADDRESSES.NativeAssetDOT) as Address,
      amount,
      minReturn: minAmountOut,
      maxSlippageBps: BigInt(AGENT_MAX_SLIPPAGE_BPS),
      nonce,
      deadlineSeconds: INTENT_DEADLINE_SECONDS,
    });

    const signature = await signStrategyIntent(strategyIntent);

    const txHash = await this.executor.executeLocalSwap(
      {
        poolType,
        pool,
        tokenIn,
        tokenOut,
        feeBps,
        data: "0x0000000000000000000000000000000000000000000000000000000000000000",
        amountIn: amount,
        minAmountOut,
        to: getAgentAddress(),
        deadline,
      },
      strategyIntent,
      signature,
    );

    logger.info(
      { txHash, tokenIn, tokenOut, amount: amount.toString() },
      "Local swap executed",
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Validate the LLM-supplied amount string:
   * - Must be a valid positive integer string
   * - Must not exceed 20% of totalAssets (single-deployment cap)
   * Returns parsed BigInt or null if invalid.
   */
  private _validateAmount(amountStr: string | undefined, totalAssets: bigint): bigint | null {
    if (!amountStr) {
      logger.warn("No amount in suggestedAction — skipping");
      return null;
    }

    let amount: bigint;
    try {
      amount = BigInt(amountStr);
    } catch {
      logger.warn({ amountStr }, "Invalid amount string — skipping");
      return null;
    }

    if (amount <= 0n) {
      logger.warn({ amount: amount.toString() }, "Non-positive amount — skipping");
      return null;
    }

    // Cap at 20% of totalAssets
    const cap = totalAssets / 5n;
    if (amount > cap) {
      logger.warn(
        { amount: amount.toString(), cap: cap.toString() },
        "Amount exceeds 20% of totalAssets — capping",
      );
      amount = cap;
    }

    return amount;
  }
}
