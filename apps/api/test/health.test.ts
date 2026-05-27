import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, resolveListenConfig, type ServerEnv } from "../src/server.js";
import type { WebhookEventStore } from "../src/db/webhook-events.js";
import type { AnalysisEnqueuer } from "../src/jobs/enqueue-analysis.js";

let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("health routes", () => {
  it("uses process-style PORT and 0.0.0.0 listen defaults", () => {
    expect(resolveListenConfig({ PORT: 4789, HOST: "0.0.0.0", NODE_ENV: "production" })).toEqual({
      port: 4789,
      host: "0.0.0.0"
    });
  });

  it("/health returns ok shape", async () => {
    server = await buildServer({
      env: testEnv(),
      eventStore: noopEventStore(),
      enqueuer: noopEnqueuer(),
      readiness: okReadiness()
    });

    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "archguard-api"
    });
  });

  it("/health does not depend on database redis or GitHub readiness", async () => {
    server = await buildServer({
      env: {
        ...testEnv(),
        GITHUB_PRIVATE_KEY:
          "-----BEGIN RSA PRIVATE KEY-----\nPASTE_REAL_KEY_LINES_HERE\n-----END RSA PRIVATE KEY-----"
      },
      eventStore: noopEventStore(),
      enqueuer: noopEnqueuer(),
      readiness: {
        checkDatabase: async () => {
          throw new Error("database unavailable");
        },
        checkRedis: async () => {
          throw new Error("redis unavailable");
        }
      }
    });

    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "archguard-api"
    });
  });

  it("/version returns safe build metadata", async () => {
    server = await buildServer({
      env: {
        ...testEnv(),
        APP_VERSION: "1.2.3",
        GIT_SHA: "abc123"
      },
      eventStore: noopEventStore(),
      enqueuer: noopEnqueuer(),
      readiness: okReadiness()
    });

    const response = await server.inject({
      method: "GET",
      url: "/version"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "archguard-api",
      version: "1.2.3",
      commit: "abc123",
      environment: "test"
    });
    expect(JSON.stringify(response.json())).not.toContain("webhook-secret");
  });

  it("/ready reports database and redis checks using mocked dependencies", async () => {
    server = await buildServer({
      env: testEnv(),
      eventStore: noopEventStore(),
      enqueuer: noopEnqueuer(),
      readiness: {
        checkDatabase: async () => undefined,
        checkRedis: async () => {
          throw new Error("redis unavailable");
        }
      }
    });

    const response = await server.inject({
      method: "GET",
      url: "/ready"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "degraded",
      checks: {
        database: "ok",
        redis: "error",
        env: "ok",
        githubApp: "ok"
      },
      githubAppDiagnostics: {
        appId: "ok",
        privateKey: "ok",
        webhookSecret: "ok",
        clientId: "ok",
        clientSecret: "ok"
      }
    });
  });

  it("/ready includes safe GitHub App diagnostics in development", async () => {
    server = await buildServer({
      env: {
        ...testEnv(),
        NODE_ENV: "development",
        GITHUB_PRIVATE_KEY:
          "-----BEGIN RSA PRIVATE KEY-----\nPASTE_REAL_KEY_LINES_HERE\n-----END RSA PRIVATE KEY-----"
      },
      eventStore: noopEventStore(),
      enqueuer: noopEnqueuer(),
      readiness: okReadiness()
    });

    const response = await server.inject({
      method: "GET",
      url: "/ready"
    });

    const body = response.json();
    expect(response.statusCode).toBe(503);
    expect(body.checks).toEqual({
      database: "ok",
      redis: "ok",
      env: "ok",
      githubApp: "error"
    });
    expect(body.githubAppDiagnostics).toEqual({
      appId: "ok",
      privateKey: "error",
      webhookSecret: "ok",
      clientId: "ok",
      clientSecret: "ok"
    });
    expect(JSON.stringify(body)).not.toContain("PASTE_REAL_KEY_LINES_HERE");
  });

  it("/ready omits GitHub App diagnostics in production", async () => {
    server = await buildServer({
      env: {
        ...testEnv(),
        NODE_ENV: "production",
        GITHUB_PRIVATE_KEY:
          "-----BEGIN RSA PRIVATE KEY-----\nPASTE_REAL_KEY_LINES_HERE\n-----END RSA PRIVATE KEY-----"
      },
      eventStore: noopEventStore(),
      enqueuer: noopEnqueuer(),
      readiness: okReadiness()
    });

    const response = await server.inject({
      method: "GET",
      url: "/ready"
    });

    const body = response.json();
    expect(response.statusCode).toBe(503);
    expect(body.githubAppDiagnostics).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("PASTE_REAL_KEY_LINES_HERE");
  });
});

function testEnv(): ServerEnv {
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
    NODE_ENV: "test"
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

function okReadiness() {
  return {
    checkDatabase: async () => undefined,
    checkRedis: async () => undefined
  };
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
