import { describe, expect, it, vi } from "vitest";
import { AnalysisJobProcessor, type AnalysisRunRecord, type AnalysisRunStore } from "../src/jobs/processor.js";
import type { GitHubAnalysisService } from "../src/jobs/processor.js";
import type { AnalysisJobPayload } from "../src/jobs/analysis-job.js";
import type { ArchitectureAnalyzer, AnalyzerRunMetadata } from "../src/analysis/analyzer.js";
import type { ArchitectureAnalysisResult } from "../src/analysis/types.js";
import type { Retriever } from "../src/retrieval/retriever.js";
import { logger } from "../src/logger.js";

describe("AnalysisJobProcessor lifecycle", () => {
  it("moves AnalysisRun from QUEUED to IN_PROGRESS to COMPLETED", async () => {
    const store = new FakeAnalysisRunStore();
    const processor = createProcessor({ store });

    await processor.process(payload(), {
      jobId: "job-1",
      attempt: 1,
      maxAttempts: 3
    });

    expect(store.transitions).toEqual(["IN_PROGRESS", "COMPLETED"]);
    expect(store.run.status).toBe("COMPLETED");
    expect(store.run.githubCheckRunId).toBe(123n);
    expect(store.completedResult?.verdict).toBe("FIT");
    expect(store.completedMetadata?.analyzerProvider).toBe("mock");
    expect(store.completedMetadata?.analysisLatencyMs).toEqual(expect.any(Number));
  });

  it("persists failed analysis as FAILED on final attempt", async () => {
    const store = new FakeAnalysisRunStore();
    const processor = createProcessor({
      store,
      analyzer: {
        analyze: vi.fn(async () => {
          throw new Error("mock analyzer exploded");
        })
      }
    });

    await expect(
      processor.process(payload(), {
        jobId: "job-2",
        attempt: 3,
        maxAttempts: 3
      })
    ).rejects.toThrow("mock analyzer exploded");

    expect(store.transitions).toEqual(["IN_PROGRESS", "FAILED"]);
    expect(store.run.status).toBe("FAILED");
    expect(store.errorMessage).toBe("mock analyzer exploded");
  });
});

function createProcessor(input: {
  store: AnalysisRunStore;
  analyzer?: ArchitectureAnalyzer;
}): AnalysisJobProcessor {
  return new AnalysisJobProcessor({
    store: input.store,
    github: fakeGitHub(),
    analyzer:
      input.analyzer ??
      ({
        analyze: vi.fn(async (): Promise<ArchitectureAnalysisResult> => ({
          verdict: "FIT",
          confidence: 0.8,
          summary: "Looks consistent with the MVP heuristic.",
          findings: [],
          retrievedContextSummary: "No context."
        }))
      } satisfies ArchitectureAnalyzer),
    retriever: {
      retrieve: vi.fn(async () => [])
    } satisfies Retriever,
    indexer: {
      indexRepository: vi.fn(async () => undefined)
    },
    logger
  });
}

function fakeGitHub(): GitHubAnalysisService {
  return {
    fetchPullRequestMetadata: vi.fn(async () => ({
      id: 3003n,
      number: 42,
      title: "Add widget workflow",
      state: "open",
      headSha: "abc123",
      baseSha: "def456",
      diffUrl: "https://github.com/acme/widgets/pull/42.diff",
      openedByLogin: "octocat"
    })),
    fetchPullRequestChangedFiles: vi.fn(async () => [
      {
        filename: "services/widget-service.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        changes: 1,
        patch: "+export const ok = true;"
      }
    ]),
    fetchPullRequestDiff: vi.fn(async () =>
      [
        "diff --git a/services/widget-service.ts b/services/widget-service.ts",
        "+++ b/services/widget-service.ts",
        "@@ -1,1 +1,2 @@",
        "+export const ok = true;"
      ].join("\n")
    ),
    createCheckRun: vi.fn(async () => 123n),
    updateCheckRun: vi.fn(async () => undefined),
    updateCheckRunFailure: vi.fn(async () => undefined),
    getInstallationAccessToken: vi.fn(async () => "token")
  };
}

class FakeAnalysisRunStore implements AnalysisRunStore {
  readonly transitions: string[] = [];
  readonly run: AnalysisRunRecord = {
    id: "run-1",
    tenantId: "tenant-1",
    repositoryId: "repo-1",
    pullRequestId: "pr-1",
    headSha: "abc123",
    status: "QUEUED",
    githubCheckRunId: null
  };
  completedResult?: ArchitectureAnalysisResult;
  completedMetadata?: AnalyzerRunMetadata;
  errorMessage?: string;

  async getRunForJob(): Promise<AnalysisRunRecord | null> {
    return this.run;
  }

  async markInProgress(_analysisRunId: string, githubCheckRunId: bigint): Promise<AnalysisRunRecord> {
    this.run.status = "IN_PROGRESS";
    this.run.githubCheckRunId = githubCheckRunId;
    this.transitions.push("IN_PROGRESS");
    return this.run;
  }

  async complete(_analysisRunId: string, result: ArchitectureAnalysisResult, metadata?: AnalyzerRunMetadata): Promise<void> {
    this.run.status = "COMPLETED";
    this.completedResult = result;
    this.completedMetadata = metadata;
    this.transitions.push("COMPLETED");
  }

  async fail(_analysisRunId: string, errorMessage: string): Promise<void> {
    this.run.status = "FAILED";
    this.errorMessage = errorMessage;
    this.transitions.push("FAILED");
  }

  async markWebhookProcessed(): Promise<void> {}
}

function payload(): AnalysisJobPayload {
  return {
    tenantId: "tenant-1",
    repositoryId: "repo-1",
    owner: "acme",
    repo: "widgets",
    installationId: 1001,
    pullRequestNumber: 42,
    headSha: "abc123",
    webhookEventId: "webhook-1"
  };
}
