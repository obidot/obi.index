// ── LLM Provider Interface & Factory ─────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** Abstract LLM provider */
export interface LLMProvider {
  chat(messages: LLMMessage[]): Promise<LLMResponse>;
}

import {
  LLM_PROVIDER,
  LLM_API_KEY,
  LLM_MODEL,
} from "../../config/constants.js";
import { OpenRouterProvider } from "./openrouter.js";
import { OpenAIProvider } from "./openai.js";
import { logger } from "../../utils/logger.js";

/** Create an LLM provider based on config */
export function createLLMProvider(): LLMProvider {
  if (!LLM_API_KEY) {
    logger.warn("No LLM_API_KEY set — agent LLM calls will fail");
  }

  switch (LLM_PROVIDER) {
    case "openrouter":
      return new OpenRouterProvider(LLM_API_KEY, LLM_MODEL);
    case "openai":
      return new OpenAIProvider(
        LLM_API_KEY,
        LLM_MODEL,
        "https://api.openai.com/v1",
      );
    case "anthropic":
      // Use OpenAI-compatible endpoint for Anthropic via proxy
      return new OpenAIProvider(
        LLM_API_KEY,
        LLM_MODEL,
        "https://api.anthropic.com/v1",
      );
    default:
      logger.warn(
        { provider: LLM_PROVIDER },
        "Unknown LLM provider, defaulting to OpenRouter",
      );
      return new OpenRouterProvider(LLM_API_KEY, LLM_MODEL);
  }
}
