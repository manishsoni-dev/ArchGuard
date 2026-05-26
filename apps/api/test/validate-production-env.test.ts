import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateProductionEnv } from "../src/scripts/validate-production-env.js";

describe("validateProductionEnv", () => {
  it("accepts production mock/fake demo mode", () => {
    const report = validateProductionEnv(env());

    expect(report.status).toBe("ok");
    expect(report.checks).toMatchObject({
      nodeEnv: "ok",
      publicWebhookUrl: "ok",
      llmProvider: "ok",
      embeddingProvider: "ok"
    });
  });

  it("fails on localhost public webhook URL in production", () => {
    const report = validateProductionEnv(env({ PUBLIC_WEBHOOK_URL: "https://localhost:3000" }));

    expect(report.status).toBe("error");
    expect(report.checks.publicWebhookUrl).toBe("error");
  });

  it("fails on placeholder secrets without exposing values", () => {
    const report = validateProductionEnv(
      env({
        GITHUB_WEBHOOK_SECRET: "your_webhook_secret",
        GITHUB_CLIENT_SECRET: "PASTE_CLIENT_SECRET"
      })
    );

    expect(report.status).toBe("error");
    expect(report.checks.githubWebhookSecret).toBe("error");
    expect(report.checks.githubClientSecret).toBe("error");
    expect(JSON.stringify(report)).not.toContain("PASTE_CLIENT_SECRET");
  });

  it("requires OPENAI_API_KEY when LLM_PROVIDER=openai", () => {
    const report = validateProductionEnv(env({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "" }));

    expect(report.status).toBe("error");
    expect(report.checks.openaiApiKey).toBe("error");
  });
});

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://archguard:archguard@postgres:5432/archguard?schema=public",
    REDIS_URL: "redis://redis:6379",
    GITHUB_APP_ID: "987654",
    GITHUB_PRIVATE_KEY: generateKey().replace(/\n/g, "\\n"),
    GITHUB_WEBHOOK_SECRET: "prod-webhook-secret",
    GITHUB_CLIENT_ID: "prod-client-id",
    GITHUB_CLIENT_SECRET: "prod-client-secret",
    PUBLIC_WEBHOOK_URL: "https://archguard.example.com",
    ANALYZER_PROVIDER: "rag",
    LLM_PROVIDER: "mock",
    EMBEDDING_PROVIDER: "fake",
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
