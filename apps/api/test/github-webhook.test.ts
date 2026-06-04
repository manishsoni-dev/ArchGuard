import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, type ServerEnv } from "../src/server.js";
import { signGithubWebhookBody } from "../src/github/verify-signature.js";
import type { AnalysisEnqueuer } from "../src/jobs/enqueue-analysis.js";
import type {
  PreparedAnalysis,
  RecordWebhookEventInput,
  RecordWebhookEventResult,
  WebhookEventStatus,
  WebhookEventStore
} from "../src/db/webhook-events.js";
import type { AnalysisJobPayload } from "../src/jobs/analysis-job.js";

const secret = "webhook-test-secret";
let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("POST /webhooks/github", () => {
  it("returns accepted/ignored for unsupported webhook events and persists IGNORED", async () => {
    const eventStore = new FakeWebhookEventStore();
    const enqueuer = createMockEnqueuer();
    const payload = JSON.stringify({ hook: { id: 1 } });
    server = await buildServer({
      env: testEnv(),
      eventStore,
      enqueuer,
      readiness: readyChecks()
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/github",
      payload,
      headers: signedHeaders(payload, {
        event: "ping",
        delivery: "delivery-unsupported"
      })
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "ignored", reason: "unsupported_event" });
    expect(eventStore.recorded).toHaveLength(1);
    expect(eventStore.recorded[0]?.status).toBe("IGNORED");
    expect(enqueuer.enqueue).not.toHaveBeenCalled();
  });

  it("persists and enqueues supported pull_request events", async () => {
    const eventStore = new FakeWebhookEventStore();
    const enqueuer = createMockEnqueuer();
    const payload = JSON.stringify(createPullRequestPayload("opened"));
    server = await buildServer({
      env: testEnv(),
      eventStore,
      enqueuer,
      readiness: readyChecks()
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/github",
      payload,
      headers: signedHeaders(payload, {
        event: "pull_request",
        delivery: "delivery-pr-opened"
      })
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "accepted", jobId: "job-1" });
    expect(eventStore.recorded[0]).toMatchObject({
      githubDeliveryId: "delivery-pr-opened",
      eventName: "pull_request",
      action: "opened",
      repositoryFullName: "acme/widgets",
      pullRequestNumber: 42
    });
    expect(eventStore.statuses.get("webhook-1")).toBe("ENQUEUED");
    expect(enqueuer.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        repositoryId: "repo-1",
        owner: "acme",
        repo: "widgets",
        installationId: 1001,
        pullRequestNumber: 42,
        headSha: "abc123",
        webhookEventId: "webhook-1"
      })
    );
  });

  it("does not enqueue duplicate x-github-delivery values", async () => {
    const eventStore = new FakeWebhookEventStore();
    const enqueuer = createMockEnqueuer();
    const payload = JSON.stringify(createPullRequestPayload("opened"));
    server = await buildServer({
      env: testEnv(),
      eventStore,
      enqueuer,
      readiness: readyChecks()
    });

    const headers = signedHeaders(payload, {
      event: "pull_request",
      delivery: "delivery-duplicate"
    });

    const first = await server.inject({
      method: "POST",
      url: "/webhooks/github",
      payload,
      headers
    });
    const second = await server.inject({
      method: "POST",
      url: "/webhooks/github",
      payload,
      headers
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual({ status: "already_received" });
    expect(enqueuer.enqueue).toHaveBeenCalledTimes(1);
  });
});

class FakeWebhookEventStore implements WebhookEventStore {
  readonly recorded: RecordWebhookEventInput[] = [];
  readonly statuses = new Map<string, WebhookEventStatus>();
  private readonly deliveries = new Map<string, string>();
  private nextId = 1;

  async recordWebhookEvent(input: RecordWebhookEventInput): Promise<RecordWebhookEventResult> {
    const existingId = this.deliveries.get(input.githubDeliveryId);

    if (existingId) {
      return {
        duplicate: true,
        event: {
          id: existingId,
          githubDeliveryId: input.githubDeliveryId,
          status: this.statuses.get(existingId) ?? "RECEIVED"
        }
      };
    }

    const id = `webhook-${this.nextId}`;
    this.nextId += 1;
    this.deliveries.set(input.githubDeliveryId, id);
    this.statuses.set(id, input.status);
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

  async markWebhookEventStatus(id: string, status: WebhookEventStatus): Promise<void> {
    this.statuses.set(id, status);
  }

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

function testEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    DATABASE_URL: "postgresql://archguard:archguard@localhost:5432/archguard?schema=public",
    REDIS_URL: "redis://localhost:6379",
    GITHUB_APP_ID: 1,
    GITHUB_PRIVATE_KEY: "not-used-by-webhook-tests",
    GITHUB_WEBHOOK_SECRET: secret,
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

function readyChecks() {
  return {
    checkDatabase: async () => undefined,
    checkRedis: async () => undefined
  };
}

function createMockEnqueuer(): AnalysisEnqueuer & {
  enqueue: ReturnType<typeof vi.fn<(payload: AnalysisJobPayload) => Promise<{ jobId: string }>>>;
} {
  return {
    enqueue: vi.fn(async (_payload: AnalysisJobPayload) => ({ jobId: "job-1" }))
  };
}

function signedHeaders(payload: string, input: { event: string; delivery: string }) {
  return {
    "content-type": "application/json",
    "x-github-event": input.event,
    "x-github-delivery": input.delivery,
    "x-hub-signature-256": signGithubWebhookBody(payload, secret)
  };
}

function createPullRequestPayload(action: string) {
  return {
    action,
    installation: {
      id: 1001
    },
    repository: {
      id: 2002,
      name: "widgets",
      full_name: "acme/widgets",
      clone_url: "https://github.com/acme/widgets.git",
      default_branch: "main",
      owner: {
        login: "acme"
      }
    },
    pull_request: {
      id: 3003,
      number: 42,
      title: "Add widget workflow",
      state: "open",
      head: {
        sha: "abc123"
      },
      base: {
        sha: "def456"
      },
      diff_url: "https://github.com/acme/widgets/pull/42.diff",
      user: {
        login: "octocat"
      }
    }
  };
}
