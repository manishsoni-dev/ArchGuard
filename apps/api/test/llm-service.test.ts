import { describe, expect, it, vi, afterEach } from "vitest";
import { LLMError } from "../src/llm/llm-errors.js";
import { createLLMService, llmConfigFromEnv } from "../src/llm/llm-service.js";
import { OpenAILLMProvider } from "../src/llm/openai-llm-provider.js";

describe("LLM service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects mock provider by default", () => {
    const service = createLLMService(
      llmConfigFromEnv({
        LLM_PROVIDER: "mock",
        LLM_MODEL: "gpt-4o-mini",
        LLM_TIMEOUT_MS: 30_000,
        LLM_MAX_OUTPUT_TOKENS: 1_200,
        OPENAI_API_KEY: undefined
      })
    );

    expect(service.provider.name).toBe("mock");
  });

  it("selects OpenAI only when configured", () => {
    const service = createLLMService(
      llmConfigFromEnv({
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-4o-mini",
        LLM_TIMEOUT_MS: 30_000,
        LLM_MAX_OUTPUT_TOKENS: 1_200,
        OPENAI_API_KEY: "test-key"
      })
    );

    expect(service.provider.name).toBe("openai");
  });

  it("fails clearly if OpenAI is selected without an API key", () => {
    expect(() =>
      createLLMService(
        llmConfigFromEnv({
          LLM_PROVIDER: "openai",
          LLM_MODEL: "gpt-4o-mini",
          LLM_TIMEOUT_MS: 30_000,
          LLM_MAX_OUTPUT_TOKENS: 1_200,
          OPENAI_API_KEY: undefined
        })
      )
    ).toThrow("OPENAI_API_KEY is required");
  });

  it("returns typed timeout errors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
      throw new Error("unreachable");
    });
    const provider = new OpenAILLMProvider("test-key", "gpt-4o-mini", 1, 100);

    await expect(
      provider.generate({
        messages: [{ role: "user", content: "hello" }]
      })
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "OpenAI chat completion timed out"
    } satisfies Partial<LLMError>);
  });
});
