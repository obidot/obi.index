// ── Agent Orchestrator ───────────────────────────────────
// Main loop: evaluate → analyze → build intent → sign → execute

import { PrismaClient } from "@prisma/client";
import { StrategyEvaluator } from "./strategy/evaluator.js";
import { ArbitrageDetector } from "./strategy/arbitrage.js";
import { LLMAnalyzer } from "./llm/analyzer.js";
import { createLLMProvider } from "./llm/provider.js";
import {
  buildIntent,
  DestType,
  type UniversalIntent,
} from "./intent/builder.js";
import { signIntent, getAgentAddress } from "./intent/signer.js";
import { TransactionExecutor } from "./executor/transaction.js";
import { ADDRESSES } from "../config/contracts.js";
import { logger } from "../utils/logger.js";
import type { Address } from "viem";

const AGENT_LOOP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MIN_CONFIDENCE = 60; // Only act on recommendations with >= 60% confidence

export class Orchestrator {
  private evaluator: StrategyEvaluator;
  private arbitrage: ArbitrageDetector;
  private analyzer: LLMAnalyzer;
  private executor: TransactionExecutor;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(prisma: PrismaClient) {
    this.evaluator = new StrategyEvaluator(prisma);
    this.arbitrage = new ArbitrageDetector(prisma);

    const llmProvider = createLLMProvider();
    this.analyzer = new LLMAnalyzer(llmProvider);
    this.executor = new TransactionExecutor();
  }

  /** Start the agent loop */
  start(): void {
    if (this.timer) return;

    logger.info(
      { intervalMs: AGENT_LOOP_INTERVAL_MS, agentAddress: getAgentAddress() },
      "Starting agent orchestrator",
    );

    // Run immediately, then on interval
    void this.cycle();
    this.timer = setInterval(() => void this.cycle(), AGENT_LOOP_INTERVAL_MS);
  }

  /** Stop the agent loop */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info("Agent orchestrator stopped");
  }

  /** Execute a single agent cycle */
  async cycle(): Promise<void> {
    if (this.running) {
      logger.warn("Previous agent cycle still running — skipping");
      return;
    }

    this.running = true;
    const startTime = Date.now();

    try {
      logger.info("Starting agent cycle");

      // Step 1: Evaluate strategies from on-chain data
      const opportunities = await this.evaluator.evaluate();
      logger.info(
        { opportunities: opportunities.length },
        "Opportunities found",
      );

      // Step 2: Detect arbitrage
      const arbOpportunities = await this.arbitrage.detect();
      logger.info(
        { arbitrage: arbOpportunities.length },
        "Arbitrage scan complete",
      );

      // Step 3: Build state snapshot for LLM
      const snapshot = await this.evaluator.buildStateSnapshot();

      // Enrich snapshot with detected opportunities
      const enrichedSnapshot = JSON.stringify(
        {
          ...JSON.parse(snapshot),
          yieldOpportunities: opportunities,
          arbitrageOpportunities: arbOpportunities.filter((a) => a.viable),
        },
        null,
        2,
      );

      // Step 4: LLM analysis
      const analysis = await this.analyzer.analyze(enrichedSnapshot);

      logger.info(
        {
          recommendation: analysis.recommendation,
          confidence: analysis.confidence,
          reasoning: analysis.reasoning,
        },
        "LLM recommendation received",
      );

      // Step 5: Execute if confidence is high enough and action is not "hold"
      if (
        analysis.confidence >= MIN_CONFIDENCE &&
        analysis.recommendation !== "hold" &&
        analysis.suggestedAction
      ) {
        await this.executeRecommendation(analysis);
      } else {
        logger.info(
          {
            confidence: analysis.confidence,
            recommendation: analysis.recommendation,
            threshold: MIN_CONFIDENCE,
          },
          "Skipping execution (below threshold or hold)",
        );
      }

      const elapsed = Date.now() - startTime;
      logger.info({ elapsedMs: elapsed }, "Agent cycle complete");
    } catch (error) {
      logger.error({ error }, "Agent cycle failed");
    } finally {
      this.running = false;
    }
  }

  /** Execute a recommended strategy */
  private async executeRecommendation(analysis: {
    recommendation: string;
    suggestedAction?: {
      tokenIn?: string;
      tokenOut?: string;
      amount?: string;
      targetChain?: string;
      protocol?: string;
    };
  }): Promise<void> {
    const action = analysis.suggestedAction;
    if (!action) return;

    try {
      // Determine destination type
      let destination = DestType.Local;
      let targetChain = 0n;

      if (action.targetChain) {
        const chainId = BigInt(action.targetChain);
        if (chainId > 0 && chainId < 10000) {
          destination = DestType.Parachain;
          targetChain = chainId;
        } else if (chainId > 10000) {
          destination = DestType.EVMChain;
          targetChain = chainId;
        }
      }

      const nonce = await this.executor.getNonce();

      const intent: UniversalIntent = buildIntent({
        tokenIn: (action.tokenIn ?? ADDRESSES.NativeAssetDOT) as Address,
        tokenOut: (action.tokenOut ?? ADDRESSES.NativeAssetUSDC) as Address,
        amountIn: BigInt(action.amount ?? "0"),
        minAmountOut: 0n, // Agent accepts any output (slippage guard in contract)
        destination,
        targetChain,
        targetProtocol: (action.protocol ?? ADDRESSES.ObidotVault) as Address,
        strategist: getAgentAddress(),
        nonce,
        deadlineSeconds: 300,
      });

      // Sign
      const signature = await signIntent(intent);

      // Execute
      const txHash = await this.executor.executeIntent(intent, signature);
      logger.info(
        { txHash, recommendation: analysis.recommendation },
        "Strategy executed on-chain",
      );
    } catch (error) {
      logger.error(
        { error, recommendation: analysis.recommendation },
        "Failed to execute strategy",
      );
    }
  }
}
