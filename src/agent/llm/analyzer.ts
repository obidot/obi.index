// ── LLM Analyzer ─────────────────────────────────────────
// Sends vault state snapshots to an LLM and parses the structured response.
// Uses Zod to validate the response — falls back to "hold" on any failure.

import { z } from "zod";
import type { LLMProvider, LLMMessage } from "./provider.js";
import { logger } from "../../utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
//  Response Schema
// ─────────────────────────────────────────────────────────────────────────────

const suggestedActionSchema = z.object({
  tokenIn: z.string().optional(),
  tokenOut: z.string().optional(),
  amount: z.string().optional(),
  targetParachain: z.string().optional(), // uint32 as string — XCM destination
  targetChain: z.string().optional(), // uint8 as string — Hyperbridge chain index
  protocol: z.string().optional(),
  poolType: z.number().int().min(0).max(3).optional(), // ISwapRouter.PoolType
  pool: z.string().optional(), // pool adapter address
  feeBps: z.string().optional(),
});

const analysisResultSchema = z.object({
  recommendation: z.enum([
    "xcm_strategy", // cross-chain via XCM (Native DestType)
    "hyper_strategy", // cross-chain via Hyperbridge (Hyper DestType)
    "local_swap", // on-hub DEX swap via SwapRouter
    "arbitrage", // on-hub arbitrage swap
    "hold", // no action
  ]),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
  suggestedAction: suggestedActionSchema.optional(),
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
//  System Prompt
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Obidot AI strategist for the first cross-chain DEX aggregator on Polkadot Hub.

You analyze on-chain vault state and market conditions to suggest the most profitable strategy.

Available actions:
- "xcm_strategy":   Deploy capital cross-chain via XCM to a Polkadot parachain (e.g. Bifrost 2030, Hydration 2034).
                    Provide targetParachain (uint32 parachain ID) and amount.
- "hyper_strategy": Deploy capital cross-chain via Hyperbridge ISMP to an EVM chain.
                    Provide targetChain (0=Ethereum, 1=Base, 2=Arbitrum) and amount.
- "local_swap":     Execute a swap on Polkadot Hub through the SwapRouter DEX aggregator.
                    Provide tokenIn, tokenOut, amount, poolType (0=HydrationOmnipool, 1=AssetHubPair, 2=BifrostDEX), pool address.
- "arbitrage":      Execute an arbitrage swap on Polkadot Hub between two pool types.
                    Same fields as local_swap with clear spread rationale.
- "hold":           No action — market conditions do not justify any deployment.

Rules:
- Only suggest actions when confidence >= 65.
- Never deploy more than 20% of vault totalAssets in a single intent.
- Amount fields must be quoted uint256 strings (18-decimal normalised).
- All token addresses must be 0x-prefixed hex strings.
- Respond ONLY with a JSON object — no markdown, no prose outside JSON.

Response schema:
{
  "recommendation": "xcm_strategy" | "hyper_strategy" | "local_swap" | "arbitrage" | "hold",
  "confidence": <0-100>,
  "reasoning": "<1-2 sentence explanation>",
  "suggestedAction": {
    "tokenIn":        "<0x address>",
    "tokenOut":       "<0x address>",
    "amount":         "<uint256 as string>",
    "targetParachain": "<uint32 as string>",
    "targetChain":    "<uint8 as string>",
    "poolType":       <0|1|2|3>,
    "pool":           "<adapter address>",
    "feeBps":         "<uint256 as string>",
    "protocol":       "<protocol address>"
  }
}`;

// ─────────────────────────────────────────────────────────────────────────────
//  LLMAnalyzer
// ─────────────────────────────────────────────────────────────────────────────

const HOLD_RESPONSE: AnalysisResult = {
  recommendation: "hold",
  confidence: 0,
  reasoning: "LLM analysis failed — defaulting to hold",
};

export class LLMAnalyzer {
  private static readonly MAX_ATTEMPTS = 3;

  constructor(private readonly provider: LLMProvider) {}

  /**
   * Analyze a vault state snapshot and return a structured recommendation.
   * Retries up to MAX_ATTEMPTS times if the LLM output fails Zod validation.
   * Returns a safe "hold" result if all attempts fail.
   */
  async analyze(stateSnapshot: string): Promise<AnalysisResult> {
    const messages: LLMMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyze the following Obidot vault state and suggest an action:\n\n${stateSnapshot}`,
      },
    ];

    for (let attempt = 1; attempt <= LLMAnalyzer.MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.provider.chat(messages);

        // Strip markdown code fences if the model wraps in ```json ... ```
        const cleaned = response.content
          .replace(/^```(?:json)?\s*/m, "")
          .replace(/\s*```\s*$/m, "")
          .trim();

        let rawJson: unknown;
        try {
          rawJson = JSON.parse(cleaned);
        } catch {
          logger.warn(
            { attempt, preview: cleaned.slice(0, 200) },
            "LLM output is not valid JSON — retrying",
          );
          continue;
        }

        const parseResult = analysisResultSchema.safeParse(rawJson);
        if (!parseResult.success) {
          logger.warn(
            { attempt, errors: parseResult.error.flatten() },
            "LLM output failed Zod validation — retrying",
          );
          continue;
        }

        logger.info(
          {
            attempt,
            recommendation: parseResult.data.recommendation,
            confidence: parseResult.data.confidence,
            model: response.model,
          },
          "LLM analysis complete",
        );

        return parseResult.data;
      } catch (error) {
        logger.error({ attempt, error }, "LLM invocation failed");
      }
    }

    logger.error(
      { maxAttempts: LLMAnalyzer.MAX_ATTEMPTS },
      "All LLM attempts exhausted — returning hold",
    );
    return HOLD_RESPONSE;
  }
}
