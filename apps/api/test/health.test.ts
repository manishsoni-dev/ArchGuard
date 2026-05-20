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

describe("health routes", () => {
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
      }
    });
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
