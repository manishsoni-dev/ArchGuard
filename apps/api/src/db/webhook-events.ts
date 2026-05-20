import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { AnalysisJobPayload } from "../jobs/analysis-job.js";

export type WebhookEventStatus = "RECEIVED" | "ENQUEUED" | "IGNORED" | "FAILED";

export type RecordWebhookEventInput = {
  githubDeliveryId: string;
  eventName: string;
  action?: string;
  repositoryFullName?: string;
  pullRequestNumber?: number;
  payloadJson: unknown;
  status: WebhookEventStatus;
};

export type RecordedWebhookEvent = {
  id: string;
  githubDeliveryId: string;
  status: string;
};

export type RecordWebhookEventResult =
  | { duplicate: false; event: RecordedWebhookEvent }
  | { duplicate: true; event: RecordedWebhookEvent };

export type PullRequestWebhookPayloadForPersistence = {
  installation: {
    id: number;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    clone_url: string;
    default_branch?: string;
    owner: {
      login: string;
    };
  };
  pull_request: {
    id: number;
    number: number;
    title: string;
    state: string;
    head: {
      sha: string;
    };
    base: {
      sha?: string;
    };
    diff_url?: string;
    user?: {
      login: string;
    } | null;
  };
};

export type PreparedAnalysis = {
  tenantId: string;
  repositoryId: string;
  pullRequestId: string;
  analysisRunId: string;
  jobPayload: AnalysisJobPayload;
};

export interface WebhookEventStore {
  recordWebhookEvent(input: RecordWebhookEventInput): Promise<RecordWebhookEventResult>;
  markWebhookEventStatus(id: string, status: WebhookEventStatus): Promise<void>;
  preparePullRequestAnalysis(
    webhookEventId: string,
    payload: PullRequestWebhookPayloadForPersistence
  ): Promise<PreparedAnalysis>;
}

export class PrismaWebhookEventStore implements WebhookEventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async recordWebhookEvent(input: RecordWebhookEventInput): Promise<RecordWebhookEventResult> {
    try {
      const event = await this.prisma.webhookEvent.create({
        data: {
          githubDeliveryId: input.githubDeliveryId,
          eventName: input.eventName,
          action: input.action,
          repositoryFullName: input.repositoryFullName,
          pullRequestNumber: input.pullRequestNumber,
          payloadJson: toJson(input.payloadJson),
          status: input.status
        },
        select: {
          id: true,
          githubDeliveryId: true,
          status: true
        }
      });

      return { duplicate: false, event };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const event = await this.prisma.webhookEvent.findUniqueOrThrow({
          where: { githubDeliveryId: input.githubDeliveryId },
          select: {
            id: true,
            githubDeliveryId: true,
            status: true
          }
        });
        return { duplicate: true, event };
      }

      throw error;
    }
  }

  async markWebhookEventStatus(id: string, status: WebhookEventStatus): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status,
        processedAt: status === "RECEIVED" ? null : new Date()
      }
    });
  }

  async preparePullRequestAnalysis(
    webhookEventId: string,
    payload: PullRequestWebhookPayloadForPersistence
  ): Promise<PreparedAnalysis> {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.upsert({
        where: { githubInstallationId: payload.installation.id },
        create: {
          name: payload.repository.owner.login,
          githubInstallationId: payload.installation.id
        },
        update: {
          name: payload.repository.owner.login
        }
      });

      const repository = await tx.repository.upsert({
        where: { githubRepositoryId: BigInt(payload.repository.id) },
        create: {
          tenantId: tenant.id,
          githubRepositoryId: BigInt(payload.repository.id),
          owner: payload.repository.owner.login,
          name: payload.repository.name,
          fullName: payload.repository.full_name,
          cloneUrl: payload.repository.clone_url,
          defaultBranch: payload.repository.default_branch
        },
        update: {
          owner: payload.repository.owner.login,
          name: payload.repository.name,
          fullName: payload.repository.full_name,
          cloneUrl: payload.repository.clone_url,
          defaultBranch: payload.repository.default_branch
        }
      });

      const pullRequest = await tx.pullRequest.upsert({
        where: {
          repositoryId_number: {
            repositoryId: repository.id,
            number: payload.pull_request.number
          }
        },
        create: {
          tenantId: tenant.id,
          repositoryId: repository.id,
          githubPullRequestId: BigInt(payload.pull_request.id),
          number: payload.pull_request.number,
          title: payload.pull_request.title,
          state: payload.pull_request.state,
          headSha: payload.pull_request.head.sha,
          baseSha: payload.pull_request.base.sha,
          diffUrl: payload.pull_request.diff_url,
          openedByLogin: payload.pull_request.user?.login
        },
        update: {
          githubPullRequestId: BigInt(payload.pull_request.id),
          title: payload.pull_request.title,
          state: payload.pull_request.state,
          headSha: payload.pull_request.head.sha,
          baseSha: payload.pull_request.base.sha,
          diffUrl: payload.pull_request.diff_url,
          openedByLogin: payload.pull_request.user?.login
        }
      });

      const existingRun = await tx.analysisRun.findUnique({
        where: {
          pullRequestId_headSha: {
            pullRequestId: pullRequest.id,
            headSha: payload.pull_request.head.sha
          }
        }
      });

      const analysisRun =
        existingRun ??
        (await tx.analysisRun.create({
          data: {
            tenantId: tenant.id,
            repositoryId: repository.id,
            pullRequestId: pullRequest.id,
            headSha: payload.pull_request.head.sha,
            status: "QUEUED"
          }
        }));

      await tx.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          tenantId: tenant.id,
          repositoryId: repository.id
        }
      });

      return {
        tenantId: tenant.id,
        repositoryId: repository.id,
        pullRequestId: pullRequest.id,
        analysisRunId: analysisRun.id,
        jobPayload: {
          tenantId: tenant.id,
          repositoryId: repository.id,
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          installationId: payload.installation.id,
          pullRequestNumber: payload.pull_request.number,
          headSha: payload.pull_request.head.sha,
          webhookEventId
        }
      };
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
