import type { Octokit } from "@octokit/rest";
import type { AnalyzerRunMetadata } from "../analysis/analyzer.js";
import type { ArchitectureAnalysisResult, ArchitectureVerdict } from "../analysis/types.js";

const checkRunName = "ArchGuard Architecture Fitness";

export type CheckRunIdentity = {
  owner: string;
  repo: string;
  headSha: string;
};

export function conclusionForVerdict(verdict: ArchitectureVerdict): "success" | "neutral" | "action_required" {
  if (verdict === "FIT") {
    return "success";
  }

  if (verdict === "DRIFT_RISK") {
    return "action_required";
  }

  return "neutral";
}

export async function createArchitectureCheckRun(
  octokit: Octokit,
  identity: CheckRunIdentity
): Promise<bigint> {
  const response = await octokit.checks.create({
    owner: identity.owner,
    repo: identity.repo,
    name: checkRunName,
    head_sha: identity.headSha,
    status: "in_progress",
    started_at: new Date().toISOString(),
    output: {
      title: "ArchGuard architecture analysis started",
      summary: "ArchGuard is evaluating this pull request against repository architecture signals."
    }
  });

  return BigInt(response.data.id);
}

export async function updateArchitectureCheckRun(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  checkRunId: bigint;
  result: ArchitectureAnalysisResult;
  metadata?: AnalyzerRunMetadata;
}): Promise<void> {
  const { octokit, owner, repo, checkRunId, result, metadata } = params;

  await octokit.checks.update({
    owner,
    repo,
    check_run_id: Number(checkRunId),
    status: "completed",
    completed_at: new Date().toISOString(),
    conclusion: conclusionForVerdict(result.verdict),
    output: {
      title: `ArchGuard verdict: ${result.verdict}`,
      summary: renderCheckRunSummary(result, metadata)
    }
  });
}

export async function updateArchitectureCheckRunFailure(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  checkRunId: bigint;
  summary: string;
}): Promise<void> {
  const { octokit, owner, repo, checkRunId, summary } = params;

  await octokit.checks.update({
    owner,
    repo,
    check_run_id: Number(checkRunId),
    status: "completed",
    completed_at: new Date().toISOString(),
    conclusion: "neutral",
    output: {
      title: "ArchGuard analysis could not complete",
      summary: [
        summary,
        "",
        "_ArchGuard is advisory in this MVP. This neutral result means analysis failed, not that the PR is architecture-fit._"
      ].join("\n")
    }
  });
}

export function renderCheckRunSummary(result: ArchitectureAnalysisResult, metadata?: AnalyzerRunMetadata): string {
  const findingRows = result.findings.length
    ? result.findings
        .map((finding) => {
          const location = finding.filePath
            ? `${finding.filePath}${finding.startLine ? `:${finding.startLine}` : ""}`
            : "";
          return `| ${finding.severity} | ${finding.title} | ${location} | ${finding.recommendation} |`;
        })
        .join("\n")
    : "| - | No findings | - | - |";
  const evidenceRows = result.findings.flatMap((finding) =>
    finding.evidence.slice(0, 3).map((evidence) => {
      const location = finding.filePath
        ? `${finding.filePath}${finding.startLine ? `:${finding.startLine}` : ""}`
        : "Retrieved context";
      return `- ${location}: ${evidence}`;
    })
  );
  const topEvidenceFiles = Array.from(
    new Set([
      ...result.findings.flatMap((finding) => (finding.filePath ? [finding.filePath] : [])),
      ...extractFilePaths(result.retrievedContextSummary)
    ])
  ).slice(0, 8);

  return [
    `**Verdict:** ${result.verdict}`,
    `**Confidence:** ${Math.round(result.confidence * 100)}%`,
    `**Analyzer provider:** ${metadata?.analyzerProvider ?? "mock"}`,
    metadata?.modelName ? `**Model:** ${metadata.modelName}` : undefined,
    `**Fallback used:** ${metadata?.fallbackUsed ? "yes" : "no"}`,
    "",
    result.summary,
    "",
    "### Findings",
    "",
    "| Severity | Finding | Location | Recommendation |",
    "| --- | --- | --- | --- |",
    findingRows,
    "",
    "### Evidence",
    "",
    "Top evidence files:",
    topEvidenceFiles.length ? topEvidenceFiles.map((filePath) => `- ${filePath}`).join("\n") : "- None",
    "",
    evidenceRows.length ? evidenceRows.join("\n") : "- No specific evidence references.",
    "",
    `**Retrieved context:** ${result.retrievedContextSummary}`,
    "",
    "_ArchGuard is advisory in this MVP. Treat results as an architecture fitness signal, not a merge gate._"
  ].filter((line) => line !== undefined).join("\n");
}

function extractFilePaths(value: string): string[] {
  return value.match(/(?:docs|src|backend|frontend|ui)\/[A-Za-z0-9._/-]+/g) ?? [];
}
