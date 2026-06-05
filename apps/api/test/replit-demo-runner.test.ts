import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type RunnerModule = {
  applyDemoDefaults: (source: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  validateRequiredEnv: (source: NodeJS.ProcessEnv) => string[];
  demoModeWarnings: (source: NodeJS.ProcessEnv) => string[];
  publicWebhookUrl: (source: NodeJS.ProcessEnv) => string;
};

describe("replit demo runner", () => {
  it("applies safe default demo providers when env is unset", async () => {
    const runner = await loadRunner();

    expect(runner.applyDemoDefaults(baseEnv())).toMatchObject({
      ANALYZER_PROVIDER: "rag",
      LLM_PROVIDER: "mock",
      EMBEDDING_PROVIDER: "fake"
    });
  });

  it("reports missing required Replit secrets", async () => {
    const runner = await loadRunner();

    expect(runner.validateRequiredEnv({ ...baseEnv(), DATABASE_URL: "", GITHUB_PRIVATE_KEY: "" })).toEqual([
      "DATABASE_URL",
      "GITHUB_PRIVATE_KEY"
    ]);
  });

  it("warns when provider mode differs from the default demo", async () => {
    const runner = await loadRunner();
    const env = {
      ...baseEnv(),
      ANALYZER_PROVIDER: "mock",
      LLM_PROVIDER: "openai",
      EMBEDDING_PROVIDER: "fake"
    };

    expect(runner.demoModeWarnings(env)).toEqual([
      "ANALYZER_PROVIDER is mock; expected rag for the default demo.",
      "LLM_PROVIDER is openai; expected mock for the default demo."
    ]);
  });

  it("formats the Replit public webhook URL without printing secrets", async () => {
    const runner = await loadRunner();

    expect(runner.publicWebhookUrl({ ...baseEnv(), REPLIT_DEV_DOMAIN: "archguard-demo.replit.app" })).toBe(
      "https://archguard-demo.replit.app/webhooks/github"
    );
  });
});

async function loadRunner(): Promise<RunnerModule> {
  const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
  return (await import(pathToFileURL(path.join(root, "scripts/replit-demo-runner.mjs")).href)) as RunnerModule;
}

function baseEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://archguard:archguard@localhost:5432/archguard?schema=public",
    REDIS_URL: "redis://localhost:6379",
    GITHUB_APP_ID: "1",
    GITHUB_PRIVATE_KEY: "private-key",
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret"
  };
}
