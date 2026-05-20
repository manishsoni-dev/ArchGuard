import { z } from "zod";
import type { AnalysisEnqueuer } from "../jobs/enqueue-analysis.js";
import type { AppLogger } from "../logger.js";
import type { WebhookEventStore } from "../db/webhook-events.js";

const supportedPullRequestActions = new Set(["opened", "synchronize", "reopened"]);

const genericWebhookPayloadSchema = z
  .object({
    action: z.string().optional(),
    repository: z
      .object({
        full_name: z.string().optional()
      })
      .optional(),
    pull_request: z
      .object({
        number: z.number().optional()
      })
      .optional()
  })
  .passthrough();

export const pullRequestPayloadSchema = z
  .object({
    action: z.string(),
    installation: z.object({
      id: z.number()
    }),
    repository: z.object({
      id: z.number(),
      name: z.string(),
      full_name: z.string(),
      clone_url: z.string().optional(),
      default_branch: z.string().optional(),
      owner: z.object({
        login: z.string()
      })
    }),
    pull_request: z.object({
      id: z.number().optional(),
      number: z.number(),
      title: z.string().optional(),
      state: z.string().optional(),
      head: z.object({
        sha: z.string()
      }),
      base: z
        .object({
          sha: z.string().optional()
        })
        .optional(),
      diff_url: z.string().optional(),
      user: z
        .object({
          login: z.string()
        })
        .nullable()
        .optional()
    })
  })
  .passthrough();

export type HandleGitHubWebhookInput = {
  githubDeliveryId: string;
  eventName: string;
  payload: unknown;
};

export type WebhookHandlerResult = {
  statusCode: 202 | 400 | 503;
  body: Record<string, unknown>;
};

export type GitHubWebhookHandlerDependencies = {
  eventStore: WebhookEventStore;
  enqueuer: AnalysisEnqueuer;
  logger: AppLogger;
};

export async function handleGitHubWebhook(
  input: HandleGitHubWebhookInput,
  dependencies: GitHubWebhookHandlerDependencies
): Promise<WebhookHandlerResult> {
  const genericPayload = genericWebhookPayloadSchema.safeParse(input.payload);
  const metadata = genericPayload.success ? genericPayload.data : {};

  const recorded = await dependencies.eventStore.recordWebhookEvent({
    githubDeliveryId: input.githubDeliveryId,
    eventName: input.eventName,
    action: metadata.action,
    repositoryFullName: metadata.repository?.full_name,
    pullRequestNumber: metadata.pull_request?.number,
    payloadJson: input.payload,
    status: input.eventName === "pull_request" ? "RECEIVED" : "IGNORED"
  });

  if (recorded.duplicate) {
    dependencies.logger.info(
      {
        githubDeliveryId: input.githubDeliveryId,
        repositoryFullName: metadata.repository?.full_name,
        pullRequestNumber: metadata.pull_request?.number
      },
      "GitHub webhook delivery already received"
    );
    return { statusCode: 202, body: { status: "already_received" } };
  }

  if (input.eventName !== "pull_request") {
    await dependencies.eventStore.markWebhookEventStatus(recorded.event.id, "IGNORED");
    return { statusCode: 202, body: { status: "ignored", reason: "unsupported_event" } };
  }

  const parsed = pullRequestPayloadSchema.safeParse(input.payload);

  if (!parsed.success) {
    await dependencies.eventStore.markWebhookEventStatus(recorded.event.id, "FAILED");
    return { statusCode: 400, body: { error: "invalid_payload", details: parsed.error.flatten() } };
  }

  if (!supportedPullRequestActions.has(parsed.data.action)) {
    await dependencies.eventStore.markWebhookEventStatus(recorded.event.id, "IGNORED");
    return { statusCode: 202, body: { status: "ignored", reason: "unsupported_pull_request_action" } };
  }

  try {
    const payload = normalizePullRequestPayload(parsed.data);
    const prepared = await dependencies.eventStore.preparePullRequestAnalysis(recorded.event.id, payload);
    const enqueued = await dependencies.enqueuer.enqueue(prepared.jobPayload);
    await dependencies.eventStore.markWebhookEventStatus(recorded.event.id, "ENQUEUED");

    dependencies.logger.info(
      {
        githubDeliveryId: input.githubDeliveryId,
        repositoryFullName: payload.repository.full_name,
        pullRequestNumber: payload.pull_request.number,
        tenantId: prepared.tenantId,
        installationId: payload.installation.id,
        analysisRunId: prepared.analysisRunId,
        jobId: enqueued.jobId
      },
      "GitHub pull_request webhook enqueued for architecture analysis"
    );

    return { statusCode: 202, body: { status: "accepted", jobId: enqueued.jobId } };
  } catch (error) {
    await dependencies.eventStore.markWebhookEventStatus(recorded.event.id, "FAILED");
    dependencies.logger.error(
      {
        err: error,
        githubDeliveryId: input.githubDeliveryId,
        repositoryFullName: parsed.data.repository.full_name,
        pullRequestNumber: parsed.data.pull_request.number,
        installationId: parsed.data.installation.id
      },
      "Failed to enqueue GitHub pull_request webhook"
    );
    return { statusCode: 503, body: { error: "enqueue_failed" } };
  }
}

function normalizePullRequestPayload(payload: z.infer<typeof pullRequestPayloadSchema>) {
  return {
    installation: {
      id: payload.installation.id
    },
    repository: {
      id: payload.repository.id,
      name: payload.repository.name,
      full_name: payload.repository.full_name,
      clone_url: payload.repository.clone_url ?? `https://github.com/${payload.repository.full_name}.git`,
      default_branch: payload.repository.default_branch,
      owner: {
        login: payload.repository.owner.login
      }
    },
    pull_request: {
      id: payload.pull_request.id ?? payload.pull_request.number,
      number: payload.pull_request.number,
      title: payload.pull_request.title ?? `Pull request #${payload.pull_request.number}`,
      state: payload.pull_request.state ?? "open",
      head: {
        sha: payload.pull_request.head.sha
      },
      base: {
        sha: payload.pull_request.base?.sha
      },
      diff_url: payload.pull_request.diff_url,
      user: payload.pull_request.user
    }
  };
}
