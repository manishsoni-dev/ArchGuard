import { describe, expect, it } from "vitest";
import { createArchitectureAnalyzer } from "../src/analysis/analyzer-service.js";
import { logger } from "../src/logger.js";

describe("analyzer provider selection", () => {
  it("uses mock analyzer by default", () => {
    const analyzer = createArchitectureAnalyzer(env({ ANALYZER_PROVIDER: "mock" }), logger);

    expect(analyzer.providerName).toBe("mock");
  });

  it("uses RAG analyzer when configured", () => {
    const analyzer = createArchitectureAnalyzer(env({ ANALYZER_PROVIDER: "rag" }), logger);

    expect(analyzer.providerName).toBe("rag");
    expect(analyzer.promptVersion).toBe("archguard-rag-v1");
  });
});

function env(overrides: Partial<Parameters<typeof createArchitectureAnalyzer>[0]> = {}) {
  return {
    ANALYZER_PROVIDER: "mock" as const,
    RAG_FALLBACK_TO_MOCK: true,
    RAG_PROMPT_VERSION: "archguard-rag-v1",
    RAG_MAX_CONTEXT_CHARS: 20_000,
    DEBUG_RAG_PROMPTS: false,
    LLM_PROVIDER: "mock" as const,
    LLM_MODEL: "gpt-4o-mini",
    LLM_TIMEOUT_MS: 30_000,
    LLM_MAX_OUTPUT_TOKENS: 1_200,
    OPENAI_API_KEY: undefined,
    ...overrides
  };
}

