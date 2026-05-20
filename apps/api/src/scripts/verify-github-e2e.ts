import { fileURLToPath } from "node:url";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { loadEnv, type Env } from "../env.js";
import { checkGitHubAppConfig } from "../github/github-app-check.js";
import { analysisQueueName } from "../jobs/analysis-job.js";

type CheckStatus = "ok" | "error";

export type GitHubE2ECheckReport = {
  status: "ok" | "error";
  checks: {
    database: CheckStatus;
    redis: CheckStatus;
    apiHealth: CheckStatus;
    apiReady: CheckStatus;
    githubAppEnv: CheckStatus;
    webhookUrl: CheckStatus;
    analyzerMode: CheckStatus;
    queue: CheckStatus;
  };
  nextSteps: string[];
};

export type GitHubE2ECheckDependencies = {
  checkDatabase: () => Promise<void>;
  checkRedis: () => Promise<void>;
  checkApiHealth: () => Promise<void>;
  checkApiReady: () => Promise<void>;
  checkQueue: () => Promise<void>;
};

const e2eEnvSchema = z.object({
  PUBLIC_WEBHOOK_URL: z.string().url(),
  TEST_GITHUB_OWNER: z.string().min(1),
  TEST_GITHUB_REPO: z.string().min(1),
  ANALYZER_PROVIDER: z.literal("rag"),
  LLM_PROVIDER: z.literal("mock")
});

export async function verifyGitHubE2E(
  env: Env = loadEnv(),
  dependencies: GitHubE2ECheckDependencies = createDefaultDependencies(env)
): Promise<GitHubE2ECheckReport> {
  const checks = {
    database: await statusOf(dependencies.checkDatabase),
    redis: await statusOf(dependencies.checkRedis),
    apiHealth: await statusOf(dependencies.checkApiHealth),
    apiReady: await statusOf(dependencies.checkApiReady),
    githubAppEnv: checkGitHubAppConfig(env).status,
    webhookUrl: e2eEnvSchema.pick({ PUBLIC_WEBHOOK_URL: true, TEST_GITHUB_OWNER: true, TEST_GITHUB_REPO: true }).safeParse(env).success ? "ok" : "error",
    analyzerMode: e2eEnvSchema.pick({ ANALYZER_PROVIDER: true, LLM_PROVIDER: true }).safeParse(env).success ? "ok" : "error",
    queue: await statusOf(dependencies.checkQueue)
  } satisfies GitHubE2ECheckReport["checks"];
  const nextSteps = nextStepsForChecks(checks, env);
  const status = Object.values(checks).every((check) => check === "ok") ? "ok" : "error";

  return { status, checks, nextSteps };
}

function createDefaultDependencies(env: Env): GitHubE2ECheckDependencies {
  return {
    checkDatabase: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    checkRedis: async () => {
      const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
      try {
        await withTimeout(redis.ping(), 2_000);
      } finally {
        redis.disconnect();
      }
    },
    checkApiHealth: async () => checkHttpOk(`http://localhost:${env.PORT}/health`),
    checkApiReady: async () => checkHttpOk(`http://localhost:${env.PORT}/ready`),
    checkQueue: async () => {
      const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
      const queue = new Queue(analysisQueueName, {
        connection
      });
      try {
        await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
      } finally {
        await queue.close();
        connection.disconnect();
      }
    }
  };
}

async function statusOf(check: () => Promise<void>): Promise<CheckStatus> {
  try {
    await check();
    return "ok";
  } catch {
    return "error";
  }
}

async function checkHttpOk(url: string): Promise<void> {
  const response = await withTimeout(fetch(url), 2_000);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function nextStepsForChecks(checks: GitHubE2ECheckReport["checks"], env: Env): string[] {
  const nextSteps: string[] = [];

  if (checks.database === "error") nextSteps.push("Start Postgres and run pnpm prisma:migrate.");
  if (checks.redis === "error" || checks.queue === "error") nextSteps.push("Start Redis and confirm REDIS_URL is correct.");
  if (checks.apiHealth === "error") nextSteps.push(`Start the API with pnpm dev and confirm http://localhost:${env.PORT}/health.`);
  if (checks.apiReady === "error") nextSteps.push("Check /ready for database, Redis, env, or GitHub App key errors.");
  if (checks.githubAppEnv === "error") nextSteps.push("Set required GitHub App env vars without printing secrets.");
  if (checks.webhookUrl === "error") nextSteps.push("Set PUBLIC_WEBHOOK_URL, TEST_GITHUB_OWNER, and TEST_GITHUB_REPO.");
  if (checks.analyzerMode === "error") nextSteps.push("Set ANALYZER_PROVIDER=rag and LLM_PROVIDER=mock for Phase 5.");

  return nextSteps;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void verifyGitHubE2E()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.status !== "ok") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
