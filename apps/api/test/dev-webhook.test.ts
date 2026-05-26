import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, type ServerEnv } from "../src/server.js";
import type {
  PreparedAnalysis,
  RecordWebhookEventInput,
  RecordWebhookEventResult,
  WebhookEventStatus,
  WebhookEventStore
} from "../src/db/webhook-events.js";
import type { AnalysisEnqueuer } from "../src/jobs/enqueue-analysis.js";
import type { AnalysisJobPayload } from "../src/jobs/analysis-job.js";

let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("POST /dev/github-webhook-debug", () => {
  it("rejects when NODE_ENV=production", async () => {
    server = await buildServer({
      env: testEnv({ NODE_ENV: "production" }),
      eventStore: new FakeWebhookEventStore(),
      enqueuer: createMockEnqueuer(),
      readiness: readyChecks()
    });

    const response = await server.inject({
      method: "POST",
      url: "/dev/github-webhook-debug",
      payload: createPullRequestPayload(),
      headers: {
        "content-type": "application/json",
        "x-archguard-dev-token": "dev-token"
      }
    });

    expect(response.statusCode).toBe(404);
  });

  it("rejects missing x-archguard-dev-token", async () => {
    server = await buildServer({
      env: testEnv(),
      eventStore: new FakeWebhookEventStore(),
      enqueuer: createMockEnqueuer(),
      readiness: readyChecks()
    });

    const response = await server.inject({
      method: "POST",
      url: "/dev/github-webhook-debug",
      payload: createPullRequestPayload(),
      headers: {
        "content-type": "application/json"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_dev_webhook_token" });
  });

  it("accepts valid dev token and passes to shared handler", async () => {
    const eventStore = new FakeWebhookEventStore();
    const enqueuer = createMockEnqueuer();
    server = await buildServer({
      env: testEnv(),
      eventStore,
      enqueuer,
      readiness: readyChecks()
    });

    const response = await server.inject({
      method: "POST",
      url: "/dev/github-webhook-debug",
      payload: createPullRequestPayload(),
      headers: {
        "content-type": "application/json",
        "x-archguard-dev-token": "dev-token",
        "x-github-delivery": "debug-delivery"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "accepted", jobId: "job-1" });
    expect(eventStore.recorded[0]).toMatchObject({
      githubDeliveryId: "debug-delivery",
      eventName: "pull_request",
      action: "opened"
    });
    expect(enqueuer.enqueue).toHaveBeenCalledTimes(1);
  });
});

class FakeWebhookEventStore implements WebhookEventStore {
  readonly recorded: RecordWebhookEventInput[] = [];
  private nextId = 1;

  async recordWebhookEvent(input: RecordWebhookEventInput): Promise<RecordWebhookEventResult> {
    const id = `webhook-${this.nextId}`;
    this.nextId += 1;
    this.recorded.push(input);
    return {
      duplicate: false,
      event: {
        id,
        githubDeliveryId: input.githubDeliveryId,
        status: input.status
      }
    };
  }

  async markWebhookEventStatus(_id: string, _status: WebhookEventStatus): Promise<void> {}

  async preparePullRequestAnalysis(webhookEventId: string): Promise<PreparedAnalysis> {
    return {
      tenantId: "tenant-1",
      repositoryId: "repo-1",
      pullRequestId: "pr-1",
      analysisRunId: "run-1",
      jobPayload: {
        tenantId: "tenant-1",
        repositoryId: "repo-1",
        owner: "acme",
        repo: "widgets",
        installationId: 1001,
        pullRequestNumber: 42,
        headSha: "abc123",
        webhookEventId
      }
    };
  }
}

function createMockEnqueuer(): AnalysisEnqueuer & {
  enqueue: ReturnType<typeof vi.fn<(payload: AnalysisJobPayload) => Promise<{ jobId: string }>>>;
} {
  return {
    enqueue: vi.fn(async (_payload: AnalysisJobPayload) => ({ jobId: "job-1" }))
  };
}

function testEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    DATABASE_URL: "postgresql://archguard:archguard@localhost:5432/archguard?schema=public",
    REDIS_URL: "redis://localhost:6379",
    GITHUB_APP_ID: 1,
    GITHUB_PRIVATE_KEY: "not-used-by-dev-webhook-tests",
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    DEV_WEBHOOK_TOKEN: "dev-token",
    APP_VERSION: "0.1.0",
    GIT_SHA: "test-sha",
    NODE_ENV: "test",
    ...overrides
  };
}

function readyChecks() {
  return {
    checkDatabase: async () => undefined,
    checkRedis: async () => undefined
  };
}

function createPullRequestPayload() {
  return {
    action: "opened",
    installation: {
      id: 1001
    },
    repository: {
      id: 2002,
      name: "widgets",
      full_name: "acme/widgets",
      owner: {
        login: "acme"
      }
    },
    pull_request: {
      number: 42,
      head: {
        sha: "abc123"
      }
    }
  };
}
