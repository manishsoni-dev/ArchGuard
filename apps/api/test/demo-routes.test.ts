import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, type ServerEnv } from "../src/server.js";
import type { WebhookEventStore } from "../src/db/webhook-events.js";
import type { AnalysisEnqueuer } from "../src/jobs/enqueue-analysis.js";

let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("demo routes", () => {
  it("GET / returns a safe HTML demo API landing response", async () => {
    server = await buildTestServer({
      DEMO_REPO_URL: "https://github.com/manishsoni-dev/ArchGuard"
    });

    const response = await server.inject({
      method: "GET",
      url: "/"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.body).toContain("ArchGuard");
    expect(response.body).toContain("AI-powered architecture fitness checks");
    expect(response.body).toContain("/health");
    expect(response.body).toContain("/ready");
    expect(response.body).toContain("/version");
    expect(response.body).toContain("/demo");
    expect(response.body).toContain("/demo/status");
    expect(response.body).toContain("/demo/proof");
    expect(response.body).toContain("https://github.com/manishsoni-dev/ArchGuard");
    expect(response.body).toContain("This is a demo API. No secrets or raw prompts are exposed.");
    expect(response.body).not.toContain("webhook-secret");
    expect(response.body).not.toContain("client-secret");
    expect(response.body).not.toContain("postgresql://");
    expect(response.body).not.toContain("redis://");
  });

  it("GET /demo returns readable HTML overview without secrets", async () => {
    server = await buildTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/demo"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Architecture fitness for real PRs");
    expect(response.body).toContain("PR #1: DRIFT_RISK");
    expect(response.body).toContain("Analyzer");
    expect(response.body).toContain("rag");
    expect(response.body).not.toContain("webhook-secret");
    expect(response.body).not.toContain("client-secret");
  });

  it("GET /demo/status returns safe live demo mode and endpoint links", async () => {
    server = await buildTestServer({
      DEMO_ALLOWED_ORIGIN: "https://demo.archguard.example"
    });

    const response = await server.inject({
      method: "GET",
      url: "/demo/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://demo.archguard.example");
    expect(response.json()).toEqual({
      service: "archguard-api",
      status: "ok",
      mode: {
        analyzerProvider: "rag",
        llmProvider: "mock",
        embeddingProvider: "fake"
      },
      endpoints: {
        health: "/health",
        ready: "/ready",
        version: "/version",
        demo: "/demo",
        demoStatus: "/demo/status",
        demoProof: "/demo/proof"
      },
      repositoryUrl: null,
      note: "This is a demo API. No secrets or raw prompts are exposed."
    });
    expect(JSON.stringify(response.json())).not.toContain("webhook-secret");
  });

  it("GET /demo/proof returns static proof data and null URLs when env is missing", async () => {
    server = await buildTestServer({
      DEMO_REPO_URL: undefined,
      DEMO_DRIFT_PR_URL: undefined,
      DEMO_FIT_PR_URL: undefined
    });

    const response = await server.inject({
      method: "GET",
      url: "/demo/proof"
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.repositoryUrl).toBeNull();
    expect(body.examples).toHaveLength(5);
    expect(body.examples.map((example: { verdict: string }) => example.verdict)).toEqual([
      "DRIFT_RISK",
      "FIT",
      "FIT",
      "FIT",
      "FIT"
    ]);
    expect(body.examples[0].url).toBeNull();
    expect(body.examples[1].url).toBeNull();
    expect(JSON.stringify(body)).not.toContain("postgresql://");
    expect(JSON.stringify(body)).not.toContain("redis://");
  });

  it("OPTIONS on public demo paths returns CORS headers", async () => {
    server = await buildTestServer();

    const response = await server.inject({
      method: "OPTIONS",
      url: "/ready"
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers["access-control-allow-methods"]).toBe("GET, OPTIONS");
  });
});

async function buildTestServer(overrides: Partial<ServerEnv> = {}): Promise<FastifyInstance> {
  return buildServer({
    env: testEnv(overrides),
    eventStore: noopEventStore(),
    enqueuer: noopEnqueuer(),
    readiness: {
      checkDatabase: async () => undefined,
      checkRedis: async () => undefined
    }
  });
}

function testEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    DATABASE_URL: "postgresql://archguard:archguard@localhost:5432/archguard?schema=public",
    REDIS_URL: "redis://localhost:6379",
    GITHUB_APP_ID: 1,
    GITHUB_PRIVATE_KEY: generatePrivateKey(),
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    DEV_WEBHOOK_TOKEN: "dev-token",
    APP_VERSION: "0.1.0",
    GIT_SHA: "test-sha",
    ANALYZER_PROVIDER: "rag",
    LLM_PROVIDER: "mock",
    EMBEDDING_PROVIDER: "fake",
    DEMO_REPO_URL: undefined,
    DEMO_DRIFT_PR_URL: undefined,
    DEMO_FIT_PR_URL: undefined,
    DEMO_ALLOWED_ORIGIN: "*",
    NODE_ENV: "test",
    ...overrides
  };
}

function generatePrivateKey(): string {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: "pkcs1",
      format: "pem"
    },
    publicKeyEncoding: {
      type: "pkcs1",
      format: "pem"
    }
  }).privateKey;
}

function noopEventStore(): WebhookEventStore {
  return {
    recordWebhookEvent: async () => ({
      duplicate: false,
      event: {
        id: "webhook-1",
        githubDeliveryId: "delivery-1",
        status: "IGNORED"
      }
    }),
    markWebhookEventStatus: async () => undefined,
    preparePullRequestAnalysis: async () => {
      throw new Error("not used");
    }
  };
}

function noopEnqueuer(): AnalysisEnqueuer {
  return {
    enqueue: async () => ({ jobId: "job-1" })
  };
}
