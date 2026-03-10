// ── LLM Analyzer ─────────────────────────────────────────
// Uses LLM to analyze vault state and suggest strategies.

import type { LLMProvider, LLMMessage } from "./provider.js";
import { logger } from "../../utils/logger.js";

export interface AnalysisResult {
  recommendation:
    | "deposit"
    | "withdraw"
    | "swap"
    | "rebalance"
    | "hold"
    | "arbitrage";
  confidence: number; // 0-100
  reasoning: string;
  suggestedAction?: {
    tokenIn?: string;
    tokenOut?: string;
    amount?: string;
    targetChain?: string;
    protocol?: string;
  };
}

const SYSTEM_PROMPT = `You are the Obidot AI strategist for the first DEX aggregator on Polkadot Hub.
You analyze on-chain vault state, oracle prices, and market conditions to suggest optimal strategies.

Your role:
1. Evaluate yield opportunities across Polkadot parachains and EVM chains
2. Detect arbitrage between pools (HydrationOmnipool, AssetHub pairs, BifrostDEX)
3. Manage vault exposure and risk within configured limits
4. Suggest EIP-712 intent-based trades for multi-hop strategies

Always respond with valid JSON matching this schema:
{
  "recommendation": "deposit" | "withdraw" | "swap" | "rebalance" | "hold" | "arbitrage",
  "confidence": <0-100>,
  "reasoning": "<brief explanation>",
  "suggestedAction": {
    "tokenIn": "<address or symbol>",
    "tokenOut": "<address or symbol>",
    "amount": "<uint256 as string>",
    "targetChain": "<parachain ID or chain ID>",
    "protocol": "<protocol address>"
  }
}`;

export class LLMAnalyzer {
  constructor(private provider: LLMProvider) {}

  async analyze(stateSnapshot: string): Promise<AnalysisResult> {
    const messages: LLMMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyze the following vault state and market data, then recommend an action:\n\n${stateSnapshot}`,
      },
    ];

    try {
      const response = await this.provider.chat(messages);
      const parsed = JSON.parse(response.content) as AnalysisResult;

      logger.info(
        {
          recommendation: parsed.recommendation,
          confidence: parsed.confidence,
          model: response.model,
        },
        "LLM analysis complete",
      );

      return parsed;
    } catch (error) {
      logger.error({ error }, "LLM analysis failed");
      return {
        recommendation: "hold",
        confidence: 0,
        reasoning: "LLM analysis failed — defaulting to hold",
      };
    }
  }
}
