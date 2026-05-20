import type { PrismaClient } from "@prisma/client";
import { UnrecoverableError } from "bullmq";
import type { Octokit } from "@octokit/rest";
import type { AnalysisJobPayload } from "./analysis-job.js";
import { parseAnalysisJobPayload } from "./analysis-job.js";
import type { GitHubAppConfig } from "../github/app-auth.js";
import { createInstallationOctokit, getInstallationAccessToken } from "../github/app-auth.js";
import {
  fetchPullRequestChangedFiles,
  fetchPullRequestDiff,
  fetchPullRequestMetadata,
  type PullRequestChangedFile,
  type PullRequestIdentity,
  type PullRequestMetadata
} from "../github/pull-request.js";
import {
  createArchitectureCheckRun,
  updateArchitectureCheckRun,
  updateArchitectureCheckRunFailure
} from "../github/checks.js";
import type { ArchitectureAnalyzer, AnalyzerRunMetadata } from "../analysis/analyzer.js";
import { analyzeWithMetadata } from "../analysis/analyzer.js";
import type { Retriever } from "../retrieval/retriever.js";
import type { RepositoryIndexer } from "../indexing/repository-indexer.js";
import type { ArchitectureAnalysisResult } from "../analysis/types.js";
import type { AppLogger } from "../logger.js";

type AnalysisRunStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export type AnalysisRunRecord = {
  id: string;
  tenantId: string;
  repositoryId: string;
  pullRequestId: string;
  headSha: string;
  status: AnalysisRunStatus;
  githubCheckRunId?: bigint | null;
};

export interface AnalysisRunStore {
  getRunForJob(payload: AnalysisJobPayload): Promise<AnalysisRunRecord | null>;
  markInProgress(analysisRunId: string, githubCheckRunId: bigint): Promise<AnalysisRunRecord>;
  complete(analysisRunId: string, result: ArchitectureAnalysisResult, metadata?: AnalyzerRunMetadata): Promise<void>;
  fail(analysisRunId: string, errorMessage: string): Promise<void>;
  markWebhookProcessed(webhookEventId: string): Promise<void>;
}

export interface GitHubAnalysisService {
  fetchPullRequestMetadata(identity: PullRequestIdentity): Promise<PullRequestMetadata>;
  fetchPullRequestChangedFiles(identity: PullRequestIdentity): Promise<PullRequestChangedFile[]>;
  fetchPullRequestDiff(identity: PullRequestIdentity): Promise<string>;
  createCheckRun(input: { owner: string; repo: string; headSha: string }): Promise<bigint>;
  updateCheckRun(input: {
    owner: string;
    repo: string;
    checkRunId: bigint;
    result: ArchitectureAnalysisResult;
    metadata?: AnalyzerRunMetadata;
  }): Promise<void>;
  updateCheckRunFailure(input: {
    owner: string;
    repo: string;
    checkRunId: bigint;
    summary: string;
  }): Promise<void>;
  getInstallationAccessToken(installationId: number): Promise<string>;
}

export type ProcessAnalysisJobContext = {
  jobId?: string;
  attempt: number;
  maxAttempts: number;
};

export class AnalysisJobProcessor {
  constructor(
    private readonly dependencies: {
      store: AnalysisRunStore;
      github: GitHubAnalysisService;
      analyzer: ArchitectureAnalyzer;
      retriever: Retriever;
      indexer: Pick<RepositoryIndexer, "indexRepository">;
      logger: AppLogger;
      retrieval?: {
        topK: number;
        maxContextChars: number;
      };
    }
  ) {}

  async processUnknownJobPayload(value: unknown, context: ProcessAnalysisJobContext): Promise<void> {
    const parsed = parseAnalysisJobPayload(value);
    await this.process(parsed, context);
  }

  async process(payload: AnalysisJobPayload, context: ProcessAnalysisJobContext): Promise<void> {
    const logFields = {
      jobId: context.jobId,
      tenantId: payload.tenantId,
      repositoryFullName: `${payload.owner}/${payload.repo}`,
      pullRequestNumber: payload.pullRequestNumber,
      installationId: payload.installationId,
      githubDeliveryId: payload.webhookEventId
    };

    const analysisRun = await this.dependencies.store.getRunForJob(payload);

    if (!analysisRun) {
      throw new UnrecoverableError("Analysis run was not found for job payload");
    }

    if (analysisRun.status === "COMPLETED") {
      this.dependencies.logger.info(
        { ...logFields, analysisRunId: analysisRun.id },
        "Analysis run already completed; skipping job"
      );
      return;
    }

    let checkRunId = analysisRun.githubCheckRunId ?? undefined;

    try {
      this.dependencies.logger.info(
        { ...logFields, analysisRunId: analysisRun.id },
        "Starting ArchGuard analysis job"
      );

      const identity = {
        owner: payload.owner,
        repo: payload.repo,
        pullNumber: payload.pullRequestNumber
      };

      const [metadata, changedFiles, diff] = await Promise.all([
        this.dependencies.github.fetchPullRequestMetadata(identity),
        this.dependencies.github.fetchPullRequestChangedFiles(identity),
        this.dependencies.github.fetchPullRequestDiff(identity)
      ]);

      if (metadata.headSha !== payload.headSha) {
        throw new UnrecoverableError("Pull request head SHA no longer matches job payload");
      }

      checkRunId =
        checkRunId ??
        (await this.dependencies.github.createCheckRun({
          owner: payload.owner,
          repo: payload.repo,
          headSha: payload.headSha
        }));

      const inProgressRun = await this.dependencies.store.markInProgress(analysisRun.id, checkRunId);
      const token = await this.dependencies.github.getInstallationAccessToken(payload.installationId);

      await this.dependencies.indexer.indexRepository({
        tenantId: payload.tenantId,
        repositoryId: payload.repositoryId,
        cloneUrl: `https://github.com/${payload.owner}/${payload.repo}.git`,
        fullName: `${payload.owner}/${payload.repo}`,
        authToken: token
      });

      const changedFileNames = changedFiles.map((file) => file.filename);
      const retrievedContext = await this.retrieveContextOrDegrade({
        tenantId: payload.tenantId,
        repositoryId: payload.repositoryId,
        diff,
        changedFiles: changedFileNames
      });

      if (!retrievedContext) {
        const result: ArchitectureAnalysisResult = {
          verdict: "INSUFFICIENT_EVIDENCE",
          confidence: 0.4,
          summary: "ArchGuard could not retrieve repository architecture context for this PR.",
          findings: [],
          retrievedContextSummary: "Retrieval failed before analysis; no context was available."
        };
        await this.dependencies.store.complete(inProgressRun.id, result, {
          analyzerProvider: this.dependencies.analyzer.providerName ?? "mock",
          promptVersion: this.dependencies.analyzer.promptVersion,
          modelName: this.dependencies.analyzer.modelName,
          fallbackUsed: false
        });
        await this.dependencies.github.updateCheckRun({
          owner: payload.owner,
          repo: payload.repo,
          checkRunId,
          result,
          metadata: {
            analyzerProvider: this.dependencies.analyzer.providerName ?? "mock",
            promptVersion: this.dependencies.analyzer.promptVersion,
            modelName: this.dependencies.analyzer.modelName,
            fallbackUsed: false
          }
        });
        await this.dependencies.store.markWebhookProcessed(payload.webhookEventId);
        return;
      }

      const analysis = await analyzeWithMetadata(this.dependencies.analyzer, {
        repositoryFullName: `${payload.owner}/${payload.repo}`,
        pullRequestNumber: payload.pullRequestNumber,
        diff,
        changedFiles: changedFileNames,
        retrievedContext
      });

      await this.dependencies.store.complete(inProgressRun.id, analysis.result, analysis.metadata);
      await this.dependencies.github.updateCheckRun({
        owner: payload.owner,
        repo: payload.repo,
        checkRunId,
        result: analysis.result,
        metadata: analysis.metadata
      });
      await this.dependencies.store.markWebhookProcessed(payload.webhookEventId);

      this.dependencies.logger.info(
        {
          ...logFields,
          analysisRunId: analysisRun.id,
          verdict: analysis.result.verdict,
          analyzerProvider: analysis.metadata.analyzerProvider,
          fallbackUsed: analysis.metadata.fallbackUsed
        },
        "Completed ArchGuard analysis job"
      );
    } catch (error) {
      if (checkRunId) {
        await this.safeUpdateFailureCheckRun(payload, checkRunId, error);
      }

      if (shouldPersistFailure(error, context)) {
        await this.dependencies.store.fail(analysisRun.id, publicErrorMessage(error));
      }

      this.dependencies.logger.error(
        {
          ...logFields,
          analysisRunId: analysisRun.id,
          err: error
        },
        "ArchGuard analysis job failed"
      );

      throw error;
    }
  }

  private async safeUpdateFailureCheckRun(
    payload: AnalysisJobPayload,
    checkRunId: bigint,
    error: unknown
  ): Promise<void> {
    try {
      await this.dependencies.github.updateCheckRunFailure({
        owner: payload.owner,
        repo: payload.repo,
        checkRunId,
        summary: `ArchGuard analysis failed: ${publicErrorMessage(error)}`
      });
    } catch (checkRunError) {
      this.dependencies.logger.error(
        {
          tenantId: payload.tenantId,
          repositoryFullName: `${payload.owner}/${payload.repo}`,
          pullRequestNumber: payload.pullRequestNumber,
          installationId: payload.installationId,
          githubDeliveryId: payload.webhookEventId,
          err: checkRunError
        },
        "Failed to update GitHub Check Run after analysis failure"
      );
    }
  }

  private async retrieveContextOrDegrade(input: {
    tenantId: string;
    repositoryId: string;
    diff: string;
    changedFiles: string[];
  }) {
    try {
      return await this.dependencies.retriever.retrieve({
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        queryText: input.diff,
        changedFiles: input.changedFiles,
        limit: this.dependencies.retrieval?.topK ?? 12,
        maxContextChars: this.dependencies.retrieval?.maxContextChars
      });
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        throw error;
      }

      this.dependencies.logger.error(
        { tenantId: input.tenantId, repositoryId: input.repositoryId, err: error },
        "Retrieval failed; completing analysis with insufficient evidence"
      );
      return undefined;
    }
  }
}

export class PrismaAnalysisRunStore implements AnalysisRunStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getRunForJob(payload: AnalysisJobPayload): Promise<AnalysisRunRecord | null> {
    const pullRequest = await this.prisma.pullRequest.findUnique({
      where: {
        repositoryId_number: {
          repositoryId: payload.repositoryId,
          number: payload.pullRequestNumber
        }
      }
    });

    if (!pullRequest) {
      return null;
    }

    const run = await this.prisma.analysisRun.findUnique({
      where: {
        pullRequestId_headSha: {
          pullRequestId: pullRequest.id,
          headSha: payload.headSha
        }
      }
    });

    return run ? toAnalysisRunRecord(run) : null;
  }

  async markInProgress(analysisRunId: string, githubCheckRunId: bigint): Promise<AnalysisRunRecord> {
    const run = await this.prisma.analysisRun.update({
      where: { id: analysisRunId },
      data: {
        status: "IN_PROGRESS",
        githubCheckRunId,
        startedAt: new Date(),
        errorMessage: null
      }
    });

    return toAnalysisRunRecord(run);
  }

  async complete(analysisRunId: string, result: ArchitectureAnalysisResult, metadata?: AnalyzerRunMetadata): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.finding.deleteMany({
        where: { analysisRunId }
      }),
      this.prisma.analysisRun.update({
        where: { id: analysisRunId },
        data: {
          status: "COMPLETED",
          verdict: result.verdict,
          confidence: result.confidence,
          summary: result.summary,
          errorMessage: null,
          retrievedContextSummary: result.retrievedContextSummary,
          rawResult: JSON.parse(JSON.stringify(result)),
          analyzerProvider: metadata?.analyzerProvider,
          promptVersion: metadata?.promptVersion,
          modelName: metadata?.modelName,
          analysisLatencyMs: metadata?.analysisLatencyMs,
          fallbackUsed: metadata?.fallbackUsed ?? false,
          completedAt: new Date()
        }
      }),
      ...result.findings.map((finding) =>
        this.prisma.finding.create({
          data: {
            analysisRunId,
            title: finding.title,
            severity: finding.severity,
            filePath: finding.filePath,
            startLine: finding.startLine,
            endLine: finding.endLine,
            evidence: finding.evidence,
            recommendation: finding.recommendation
          }
        })
      )
    ]);
  }

  async fail(analysisRunId: string, errorMessage: string): Promise<void> {
    await this.prisma.analysisRun.update({
      where: { id: analysisRunId },
      data: {
        status: "FAILED",
        errorMessage,
        completedAt: new Date()
      }
    });
  }

  async markWebhookProcessed(webhookEventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        processedAt: new Date()
      }
    });
  }
}

export function createGitHubAnalysisService(config: GitHubAppConfig, installationId: number): GitHubAnalysisService {
  const octokit = createInstallationOctokit(config, installationId);
  return createOctokitGitHubAnalysisService(config, installationId, octokit);
}

export function createOctokitGitHubAnalysisService(
  config: GitHubAppConfig,
  installationId: number,
  octokit: Octokit
): GitHubAnalysisService {
  return {
    fetchPullRequestMetadata: (identity) => fetchPullRequestMetadata(octokit, identity),
    fetchPullRequestChangedFiles: (identity) => fetchPullRequestChangedFiles(octokit, identity),
    fetchPullRequestDiff: (identity) => fetchPullRequestDiff(octokit, identity),
    createCheckRun: (input) => createArchitectureCheckRun(octokit, input),
    updateCheckRun: (input) =>
      updateArchitectureCheckRun({
        octokit,
        ...input
      }),
    updateCheckRunFailure: (input) =>
      updateArchitectureCheckRunFailure({
        octokit,
        ...input
      }),
    getInstallationAccessToken: () => getInstallationAccessToken(config, installationId)
  };
}

function shouldPersistFailure(error: unknown, context: ProcessAnalysisJobContext): boolean {
  return error instanceof UnrecoverableError || context.attempt >= context.maxAttempts;
}

function publicErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown analysis failure";
}

function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /P1001|P1002|database.*unavailable|connection.*refused/i.test(error.message);
}

function toAnalysisRunRecord(run: {
  id: string;
  tenantId: string;
  repositoryId: string;
  pullRequestId: string;
  headSha: string;
  status: string;
  githubCheckRunId: bigint | null;
}): AnalysisRunRecord {
  return {
    id: run.id,
    tenantId: run.tenantId,
    repositoryId: run.repositoryId,
    pullRequestId: run.pullRequestId,
    headSha: run.headSha,
    status: run.status as AnalysisRunStatus,
    githubCheckRunId: run.githubCheckRunId
  };
}
