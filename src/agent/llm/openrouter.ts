// ── OpenRouter LLM Provider ──────────────────────────────

import type { LLMMessage, LLMResponse, LLMProvider } from "./provider.js";
import { logger } from "../../utils/logger.js";

interface OpenRouterChoice {
  message: { role: string; content: string };
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export class OpenRouterProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-Title": "Obidot AI Agent",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.3,
          max_tokens: 4096,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      logger.error(
        { status: response.status, body: text },
        "OpenRouter API error",
      );
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = (await response.json()) as OpenRouterResponse;
    const choice = data.choices[0];

    return {
      content: choice.message.content,
      model: data.model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          }
        : undefined,
    };
  }
}
