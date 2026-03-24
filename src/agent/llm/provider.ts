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

export function createLLMProviderFromConfig(
  provider: string,
  apiKey: string,
  model: string,
): LLMProvider {
  if (!apiKey) {
    logger.warn("No LLM_API_KEY set — agent LLM calls will fail");
  }

  switch (provider) {
    case "openrouter":
      return new OpenRouterProvider(apiKey, model);
    case "openai":
      return new OpenAIProvider(apiKey, model, "https://api.openai.com/v1");
    case "anthropic":
      throw new Error(
        "LLM_PROVIDER=anthropic is not supported yet. Use openrouter/openai or implement Anthropic's Messages API.",
      );
    default:
      logger.warn(
        { provider },
        "Unknown LLM provider, defaulting to OpenRouter",
      );
      return new OpenRouterProvider(apiKey, model);
  }
}

/** Create an LLM provider based on config */
export function createLLMProvider(): LLMProvider {
  return createLLMProviderFromConfig(LLM_PROVIDER, LLM_API_KEY, LLM_MODEL);
}
