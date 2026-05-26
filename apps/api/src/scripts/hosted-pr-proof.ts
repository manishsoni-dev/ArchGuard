import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { prisma } from "../db/prisma.js";
import { loadEnv, type Env } from "../env.js";
import { checkGitHubAppConfig } from "../github/github-app-check.js";
import { createInstallationOctokit } from "../github/app-auth.js";
import { fetchPullRequestChangedFiles, fetchPullRequestMetadata } from "../github/pull-request.js";
import { smokeDeployment, type DeploymentSmokeReport } from "./smoke-deployment.js";

type CheckStatus = "ok" | "warning" | "error";
type ArchitectureVerdict = "FIT" | "DRIFT_RISK" | "INSUFFICIENT_EVIDENCE";

export type HostedPrProofReport = {
  status: "ok" | "warning" | "error";
  checks: {
    deploymentHealth: "ok" | "error";
    deploymentReady: "ok" | "error";
    githubPr: "ok" | "error";
    changedFiles: CheckStatus;
    githubCheckRun: CheckStatus;
    analysisRun: CheckStatus;
  };
  proof: {
    pullRequestUrl: string | null;
    checkRunUrl: string | null;
    verdict: ArchitectureVerdict | null;
    conclusion: string | null;
    headSha: string | null;
  };
  nextSteps: string[];
};

export type HostedPrProofInput = {
  owner: string;
  repo: string;
  pr: number;
  baseUrl: string;
};

export type HostedPrProofDependencies = {
  smokeDeployment: (input: { baseUrl: string }) => Promise<DeploymentSmokeReport>;
  checkGitHubApp: (env: Env) => { status: "ok" | "error" };
  createOctokit: (env: Env) => Octokit;
  findAnalysisRun: (input: { repositoryFullName: string; pullRequestNumber: number; headSha: string }) => Promise<{
    verdict: string | null;
    githubCheckRunId: bigint | null;
  } | null>;
};

const argsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pr: z.coerce.number().int().positive(),
  baseUrl: z.string().url()
});

export function parseHostedPrProofArgs(argv: string[]): HostedPrProofInput {
  const values: Record<string, string> = {};
  for (const arg of argv) {
    for (const key of ["owner", "repo", "pr", "baseUrl"] as const) {
      if (arg.startsWith(`${key}=`)) values[key] = arg.slice(key.length + 1);
      if (arg.startsWith(`--${key}=`)) values[key] = arg.slice(key.length + 3);
    }
  }
  return argsSchema.parse(values);
}

export async function runHostedPrProof(
  input: HostedPrProofInput,
  env: Env = loadEnv(),
  dependencies: HostedPrProofDependencies = defaultDependencies(env)
): Promise<HostedPrProofReport> {
  const deployment = await dependencies.smokeDeployment({ baseUrl: input.baseUrl });
  const githubApp = dependencies.checkGitHubApp(env);
  const proof: HostedPrProofReport["proof"] = {
    pullRequestUrl: null,
    checkRunUrl: null,
    verdict: null,
    conclusion: null,
    headSha: null
  };

  let githubPr: CheckStatus = githubApp.status === "ok" ? "ok" : "error";
  let changedFiles: CheckStatus = "error";
  let githubCheckRun: CheckStatus = "error";
  let analysisRun: CheckStatus = "warning";

  try {
    const octokit = dependencies.createOctokit(env);
    const pr = await fetchPullRequestMetadata(octokit, {
      owner: input.owner,
      repo: input.repo,
      pullNumber: input.pr
    });
    proof.pullRequestUrl = `https://github.com/${input.owner}/${input.repo}/pull/${input.pr}`;
    proof.headSha = pr.headSha;
    githubPr = "ok";

    const files = await fetchPullRequestChangedFiles(octokit, {
      owner: input.owner,
      repo: input.repo,
      pullNumber: input.pr
    });
    changedFiles = files.length ? "ok" : "warning";

    const checkRun = await findArchGuardCheckRun(octokit, input.owner, input.repo, pr.headSha);
    if (checkRun) {
      githubCheckRun = "ok";
      proof.checkRunUrl = checkRun.html_url ?? null;
      proof.conclusion = checkRun.conclusion ?? null;
      proof.verdict = parseVerdict(`${checkRun.output?.title ?? ""}\n${checkRun.output?.summary ?? ""}`);
    } else {
      githubCheckRun = "warning";
    }

    const run = await dependencies.findAnalysisRun({
      repositoryFullName: `${input.owner}/${input.repo}`,
      pullRequestNumber: input.pr,
      headSha: pr.headSha
    });
    if (run) {
      analysisRun = "ok";
      proof.verdict = parseVerdict(run.verdict ?? "") ?? proof.verdict;
    }
  } catch {
    githubPr = githubPr === "ok" ? "error" : githubPr;
  }

  const checks = {
    deploymentHealth: deployment.checks.health,
    deploymentReady: deployment.checks.ready,
    githubPr: githubPr === "ok" ? "ok" : "error",
    changedFiles,
    githubCheckRun,
    analysisRun
  } satisfies HostedPrProofReport["checks"];

  return {
    status: overallStatus(checks),
    checks,
    proof,
    nextSteps: nextStepsFor(checks, input)
  };
}

async function findArchGuardCheckRun(octokit: Octokit, owner: string, repo: string, ref: string) {
  const response = await octokit.checks.listForRef({
    owner,
    repo,
    ref,
    check_name: "ArchGuard Architecture Fitness"
  });
  return response.data.check_runs[0] ?? null;
}

function parseVerdict(value: string): ArchitectureVerdict | null {
  const match = value.match(/\b(FIT|DRIFT_RISK|INSUFFICIENT_EVIDENCE)\b/);
  return (match?.[1] as ArchitectureVerdict | undefined) ?? null;
}

function defaultDependencies(env: Env): HostedPrProofDependencies {
  return {
    smokeDeployment,
    checkGitHubApp: checkGitHubAppConfig,
    createOctokit: (sourceEnv) => {
      if (!sourceEnv.TEST_GITHUB_INSTALLATION_ID) {
        throw new Error("TEST_GITHUB_INSTALLATION_ID is required for hosted PR proof.");
      }
      return createInstallationOctokit(
        { appId: sourceEnv.GITHUB_APP_ID, privateKey: sourceEnv.GITHUB_PRIVATE_KEY },
        sourceEnv.TEST_GITHUB_INSTALLATION_ID
      );
    },
    findAnalysisRun: async ({ repositoryFullName, pullRequestNumber, headSha }) =>
      prisma.analysisRun.findFirst({
        where: {
          headSha,
          repository: { fullName: repositoryFullName },
          pullRequest: { number: pullRequestNumber }
        },
        select: {
          verdict: true,
          githubCheckRunId: true
        },
        orderBy: { createdAt: "desc" }
      })
  };
}

function overallStatus(checks: HostedPrProofReport["checks"]): HostedPrProofReport["status"] {
  const values = Object.values(checks);
  if (values.some((value) => value === "error")) return "error";
  if (values.some((value) => value === "warning")) return "warning";
  return "ok";
}

function nextStepsFor(checks: HostedPrProofReport["checks"], input: HostedPrProofInput): string[] {
  const nextSteps: string[] = [];
  if (checks.deploymentHealth === "error" || checks.deploymentReady === "error") {
    nextSteps.push(`Run pnpm smoke:deployment -- baseUrl=${input.baseUrl} and inspect /ready.`);
  }
  if (checks.githubPr === "error") nextSteps.push("Confirm GitHub App credentials and installation id can read this PR.");
  if (checks.changedFiles !== "ok") nextSteps.push("Confirm the PR has changed files and is accessible to the GitHub App.");
  if (checks.githubCheckRun !== "ok") nextSteps.push("Redeliver the pull_request webhook or push a new commit to the PR.");
  if (checks.analysisRun !== "ok") nextSteps.push("Check pnpm analysis:runs against the deployed database.");
  return nextSteps;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runHostedPrProof(parseHostedPrProofArgs(process.argv.slice(2)))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.status === "error") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
