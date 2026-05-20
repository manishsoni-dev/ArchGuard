import { describe, expect, it, vi } from "vitest";
import { smokeTestOpenAIRag, validateOpenAIRagSmokeEnv } from "../src/scripts/smoke-test-openai-rag.js";
import type { Env } from "../src/env.js";

describe("OpenAI RAG smoke script", () => {
  it("refuses to run without LLM_PROVIDER=openai", () => {
    expect(() => validateOpenAIRagSmokeEnv(env({ LLM_PROVIDER: "mock" }))).toThrow();
  });

  it("refuses to run without OPENAI_API_KEY", () => {
    expect(() => validateOpenAIRagSmokeEnv(env({ OPENAI_API_KEY: undefined }))).toThrow();
  });

  it("does not call OpenAI in tests when a report runner is injected", async () => {
    const runEvaluation = vi.fn(async () => report({ fallbackUsed: false, passed: true }));

    await expect(smokeTestOpenAIRag({ env: env(), runEvaluation })).resolves.toMatchObject({ passed: true });
    expect(runEvaluation).toHaveBeenCalledOnce();
  });

  it("fails if fallback occurs and SMOKE_FAIL_ON_FALLBACK=true", async () => {
    await expect(
      smokeTestOpenAIRag({
        env: env({ SMOKE_FAIL_ON_FALLBACK: true }),
        runEvaluation: async () => report({ fallbackUsed: true, passed: true })
      })
    ).resolves.toMatchObject({ passed: false });
  });
});

function env(overrides: Partial<Env> = {}): Env {
  return {
    PORT: 3000,
    DATABASE_URL: "postgresql://archguard:archguard@localhost:5432/archguard?schema=public",
    REDIS_URL: "redis://localhost:6379",
    GITHUB_APP_ID: 1,
    GITHUB_PRIVATE_KEY: "private",
    GITHUB_WEBHOOK_SECRET: "secret",
    GITHUB_CLIENT_ID: "client",
    GITHUB_CLIENT_SECRET: "client-secret",
    DEV_WEBHOOK_TOKEN: "dev",
    EMBEDDING_PROVIDER: "fake",
    OPENAI_API_KEY: "sk-test",
    EMBEDDING_MODEL: "text-embedding-3-small",
    EMBEDDING_DIMENSIONS: 1536,
    EMBEDDING_BATCH_SIZE: 64,
    RETRIEVAL_TOP_K: 12,
    RETRIEVAL_MAX_CONTEXT_CHARS: 20_000,
    LLM_PROVIDER: "openai",
    LLM_MODEL: "gpt-4o-mini",
    LLM_TIMEOUT_MS: 30_000,
    LLM_MAX_OUTPUT_TOKENS: 1_200,
    ANALYZER_PROVIDER: "rag",
    RAG_FALLBACK_TO_MOCK: true,
    RAG_PROMPT_VERSION: "archguard-rag-v1",
    RAG_MAX_CONTEXT_CHARS: 20_000,
    DEBUG_RAG_PROMPTS: false,
    RAG_WRITE_EVAL_REPORT: false,
    RAG_VALIDATE_GOLDEN: false,
    SMOKE_FAIL_ON_FALLBACK: true,
    NODE_ENV: "test",
    ...overrides
  };
}

function report(input: { fallbackUsed: boolean; passed: boolean }) {
  return {
    runId: "run-1",
    timestamp: "2026-05-20T00:00:00.000Z",
    analyzerProvider: "rag",
    llmProvider: "openai",
    modelName: "gpt-4o-mini",
    promptVersion: "archguard-rag-v1",
    totalCases: 1,
    passedCases: input.passed ? 1 : 0,
    failedCases: input.passed ? 0 : 1,
    averageLatencyMs: 10,
    confidenceBuckets: {
      "0.0-0.5": { total: 0, passed: 0 },
      "0.5-0.8": { total: 0, passed: 0 },
      "0.8-1.0": { total: 1, passed: input.passed ? 1 : 0 }
    },
    cases: [
      {
        name: "frontend importing db",
        description: "case",
        expectedVerdict: "DRIFT_RISK" as const,
        actualVerdict: "DRIFT_RISK" as const,
        passed: input.passed,
        confidence: 0.9,
        latencyMs: 10,
        fallbackUsed: input.fallbackUsed,
        topEvidenceFiles: [],
        tokenEstimate: {
          estimatedInputTokens: 1,
          estimatedOutputTokens: 1,
          estimatedTotalTokens: 2
        }
      }
    ],
    passed: input.passed
  };
}

