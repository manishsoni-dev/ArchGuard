import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { verifyGitHubE2E } from "../src/scripts/verify-github-e2e.js";

describe("GitHub E2E checker", () => {
  it("reports missing PUBLIC_WEBHOOK_URL", async () => {
    const report = await verifyGitHubE2E(env({ PUBLIC_WEBHOOK_URL: undefined }), okDeps());

    expect(report.status).toBe("error");
    expect(report.checks.webhookUrl).toBe("error");
  });

  it("reports wrong analyzer provider", async () => {
    const report = await verifyGitHubE2E(env({ ANALYZER_PROVIDER: "mock" }), okDeps());

    expect(report.checks.analyzerMode).toBe("error");
  });

  it("reports wrong LLM provider", async () => {
    const report = await verifyGitHubE2E(env({ LLM_PROVIDER: "openai" }), okDeps());

    expect(report.checks.analyzerMode).toBe("error");
  });

  it("reports database redis and API statuses in structured JSON", async () => {
    const report = await verifyGitHubE2E(env(), {
      ...okDeps(),
      checkDatabase: async () => {
        throw new Error("db down");
      },
      checkRedis: async () => {
        throw new Error("redis down");
      },
      checkApiHealth: async () => {
        throw new Error("api down");
      }
    });

    expect(report.checks).toMatchObject({
      database: "error",
      redis: "error",
      apiHealth: "error",
      apiReady: "ok",
      githubAppEnv: "ok",
      webhookUrl: "ok",
      analyzerMode: "ok",
      queue: "ok"
    });
    expect(JSON.stringify(report)).not.toContain("webhook-secret");
  });
});

function okDeps() {
  return {
    checkDatabase: async () => undefined,
    checkRedis: async () => undefined,
    checkApiHealth: async () => undefined,
    checkApiReady: async () => undefined,
    checkQueue: async () => undefined
  };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    PORT: 3000,
    HOST: "0.0.0.0",
    DATABASE_URL: "postgresql://archguard:archguard@localhost:5432/archguard?schema=public",
    REDIS_URL: "redis://localhost:6379",
    GITHUB_APP_ID: 1,
    GITHUB_PRIVATE_KEY: generateKey(),
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_CLIENT_ID: "client",
    GITHUB_CLIENT_SECRET: "client-secret",
    DEV_WEBHOOK_TOKEN: "dev",
    EMBEDDING_PROVIDER: "fake",
    OPENAI_API_KEY: undefined,
    EMBEDDING_MODEL: "text-embedding-3-small",
    EMBEDDING_DIMENSIONS: 1536,
    EMBEDDING_BATCH_SIZE: 64,
    RETRIEVAL_TOP_K: 12,
    RETRIEVAL_MAX_CONTEXT_CHARS: 20_000,
    LLM_PROVIDER: "mock",
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
    PUBLIC_WEBHOOK_URL: "https://example.ngrok-free.app",
    TEST_GITHUB_OWNER: "acme",
    TEST_GITHUB_REPO: "widgets",
    APP_VERSION: "0.1.0",
    GIT_SHA: "test-sha",
    NODE_ENV: "test",
    ...overrides
  };
}

function generateKey(): string {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" }
  }).privateKey;
}
