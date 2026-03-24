import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { logger } from "../src/utils/logger.js";
import { OpenAIProvider } from "../src/agent/llm/openai.js";
import { OpenRouterProvider } from "../src/agent/llm/openrouter.js";
import { createLLMProviderFromConfig } from "../src/agent/llm/provider.js";

describe("createLLMProviderFromConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an OpenRouter provider", () => {
    const provider = createLLMProviderFromConfig(
      "openrouter",
      "test-key",
      "anthropic/claude-sonnet-4",
    );

    expect(provider).toBeInstanceOf(OpenRouterProvider);
  });

  it("creates an OpenAI provider", () => {
    const provider = createLLMProviderFromConfig(
      "openai",
      "test-key",
      "gpt-4.1-mini",
    );

    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("warns when the API key is missing", () => {
    createLLMProviderFromConfig("openrouter", "", "anthropic/claude-sonnet-4");

    expect(logger.warn).toHaveBeenCalledWith(
      "No LLM_API_KEY set — agent LLM calls will fail",
    );
  });

  it("falls back to OpenRouter for unknown providers", () => {
    const provider = createLLMProviderFromConfig(
      "custom-provider",
      "test-key",
      "anthropic/claude-sonnet-4",
    );

    expect(provider).toBeInstanceOf(OpenRouterProvider);
    expect(logger.warn).toHaveBeenCalledWith(
      { provider: "custom-provider" },
      "Unknown LLM provider, defaulting to OpenRouter",
    );
  });

  it("fails closed for anthropic until a native client exists", () => {
    expect(() =>
      createLLMProviderFromConfig(
        "anthropic",
        "test-key",
        "claude-sonnet-4-20250514",
      ),
    ).toThrow(
      "LLM_PROVIDER=anthropic is not supported yet. Use openrouter/openai or implement Anthropic's Messages API.",
    );
  });
});
