// ── OpenAI-Compatible LLM Provider ───────────────────────
// Works with OpenAI, Azure, and any OpenAI-compatible API.

import type { LLMMessage, LLMResponse, LLMProvider } from "./provider.js";
import { logger } from "../../utils/logger.js";

interface OpenAIChoice {
  message: { role: string; content: string };
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export class OpenAIProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string,
  ) {}

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error({ status: response.status, body: text }, "OpenAI API error");
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = (await response.json()) as OpenAIResponse;
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
