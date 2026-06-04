import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { CliArgumentError } from "../src/scripts/cli-args.js";
import { parseHostedPrProofArgs, runHostedPrProof } from "../src/scripts/hosted-pr-proof.js";

describe("hosted PR proof", () => {
  it("parses required arguments", () => {
    expect(
      parseHostedPrProofArgs([
        "owner=Manisshhhhhh",
        "repo=ArchGuard",
        "pr=4",
        "baseUrl=https://archguard.example.app"
      ])
    ).toEqual({
      owner: "Manisshhhhhh",
      repo: "ArchGuard",
      pr: 4,
      baseUrl: "https://archguard.example.app"
    });
  });

  it("returns friendly error for placeholder PR number", () => {
    try {
      parseHostedPrProofArgs([
        "owner=Manisshhhhhh",
        "repo=ArchGuard",
        "pr=PR_NUMBER",
        "baseUrl=https://archguard-production.up.railway.app"
      ]);
      throw new Error("expected parse to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CliArgumentError);
      const report = (error as CliArgumentError).report;
      expect(report.problems).toEqual([
        {
          field: "pr",
          message: "pr must be a numeric pull request number, e.g. pr=6."
        }
      ]);
      expect(JSON.stringify(report)).not.toContain("ZodError");
    }
  });

  it("reports missing Check Run as warning", async () => {
    const report = await runHostedPrProof(
      {
        owner: "Manisshhhhhh",
        repo: "ArchGuard",
        pr: 4,
        baseUrl: "https://archguard.example.app"
      },
      env(),
      {
        smokeDeployment: async () => ({
          status: "ok",
          checks: {
            health: "ok",
            ready: "ok",
            https: "ok",
            webhookUrl: "ok",
            version: "ok"
          },
          details: {
            health: httpDetails("https://archguard.example.app/health"),
            ready: httpDetails("https://archguard.example.app/ready"),
            version: httpDetails("https://archguard.example.app/version")
          },
          nextSteps: []
        }),
        checkGitHubApp: () => ({ status: "ok" }),
        createOctokit: () =>
          ({
            pulls: {
              get: async () => ({
                data: {
                  id: 1,
                  number: 4,
                  title: "docs",
                  state: "open",
                  head: { sha: "abc123" },
                  base: { sha: "base123" },
                  diff_url: "https://example.test/diff",
                  user: { login: "manish" }
                }
              }),
              listFiles: async () => ({ data: [] })
            },
            paginate: async () => [{ filename: "README.md", status: "modified", additions: 1, deletions: 0, changes: 1 }],
            checks: {
              listForRef: async () => ({ data: { check_runs: [] } })
            }
          }) as never,
        findAnalysisRun: async () => null
      }
    );

    expect(report.status).toBe("warning");
    expect(report.checks.githubCheckRun).toBe("warning");
    expect(report.proof).toMatchObject({
      pullRequestUrl: "https://github.com/Manisshhhhhh/ArchGuard/pull/4",
      headSha: "abc123",
      checkRunUrl: null
    });
  });
});

function env(): Env {
  return {
    PORT: 3000,
    HOST: "0.0.0.0",
    DATABASE_URL: "postgresql://archguard:archguard@postgres:5432/archguard?schema=public",
    REDIS_URL: "redis://redis:6379",
    GITHUB_APP_ID: 123,
    GITHUB_PRIVATE_KEY: generateKey(),
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    DEV_WEBHOOK_TOKEN: "",
    EMBEDDING_PROVIDER: "fake",
    OPENAI_API_KEY: undefined,
    EMBEDDING_MODEL: "text-embedding-3-small",
    EMBEDDING_DIMENSIONS: 1536,
    EMBEDDING_BATCH_SIZE: 64,
    RETRIEVAL_TOP_K: 12,
    RETRIEVAL_MAX_CONTEXT_CHARS: 20_000,
    LLM_PROVIDER: "mock",
    LLM_MODEL: "gpt-4o-mini",
    LLM_TIMEOUT_MS: 30_000,
    LLM_MAX_OUTPUT_TOKENS: 1_200,
    ANALYZER_PROVIDER: "rag",
    RAG_FALLBACK_TO_MOCK: true,
    RAG_PROMPT_VERSION: "archguard-rag-v1",
    RAG_MAX_CONTEXT_CHARS: 20_000,
    DEBUG_RAG_PROMPTS: false,
    RAG_WRITE_EVAL_REPORT: false,
    RAG_VALIDATE_GOLDEN: false,
    SMOKE_FAIL_ON_FALLBACK: true,
    PUBLIC_WEBHOOK_URL: "https://archguard.example.app",
    DEMO_REPO_URL: undefined,
    DEMO_DRIFT_PR_URL: undefined,
    DEMO_FIT_PR_URL: undefined,
    DEMO_ALLOWED_ORIGIN: "*",
    TEST_GITHUB_OWNER: "Manisshhhhhh",
    TEST_GITHUB_REPO: "ArchGuard",
    TEST_GITHUB_INSTALLATION_ID: 1,
    APP_VERSION: "0.1.0",
    GIT_SHA: "test-sha",
    NODE_ENV: "test"
  };
}

function httpDetails(url: string) {
  return {
    url,
    statusCode: 200,
    bodyPreview: "{}",
    errorMessage: null,
    looksLikeRailwayError: false,
    looksLikeHtml: false
  };
}

function generateKey(): string {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" }
  }).privateKey;
}
