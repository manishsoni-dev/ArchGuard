import { readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkMigrationStatus } from "../src/scripts/migration-status.js";
import { checkProductionCommands } from "../src/scripts/production-command-check.js";
import { diagnoseRailwayEnv } from "../src/scripts/railway-diagnose.js";
import { runSecretsCheck } from "../src/scripts/secrets-check.js";

describe("deployment operations helpers", () => {
  it("migration status handles database unreachable", () => {
    const report = checkMigrationStatus(() => ({
      status: 1,
      stdout: "",
      stderr: "Error: P1001: Can't reach database server"
    }));

    expect(report.status).toBe("error");
    expect(report.pendingMigrations).toBeNull();
  });

  it("secrets checker ignores test fixture PEM", () => {
    const report = runSecretsCheck({
      files: {
        "apps/api/test/fixtures/test-private-key.pem": "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
        "README.md": "safe"
      }
    });

    expect(report.status).toBe("ok");
    expect(report.findings).toEqual([]);
  });

  it("secrets checker flags obvious real-looking secrets", () => {
    const leakedSecret = "OPENAI_API_KEY=" + "sk-realLookingSecret1234567890";
    const report = runSecretsCheck({
      files: {
        "src/leak.ts": leakedSecret
      }
    });

    expect(report.status).toBe("error");
    expect(report.findings).toEqual([{ filePath: "src/leak.ts", rule: "openai-api-key" }]);
  });

  it("README links to deployment and operations docs", () => {
    const readme = readFileSync("../../README.md", "utf8");

    expect(readme).toContain("docs/deployment.md");
    expect(readme).toContain("docs/operations.md");
    expect(readme).toContain("docs/railway-deployment.md");
    expect(readme).toContain("deploy/processes.md");
    expect(readme).toContain("Do not run commands with literal placeholders");
  });

  it("railway diagnose masks secrets and reports missing database url", () => {
    const report = diagnoseRailwayEnv({
      NODE_ENV: "production",
      PORT: "3000",
      REDIS_URL: "redis://example.internal:6379",
      GITHUB_APP_ID: "42",
      GITHUB_PRIVATE_KEY: "not-a-key",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
      PUBLIC_WEBHOOK_URL: "https://archguard-production.up.railway.app",
      ANALYZER_PROVIDER: "rag",
      LLM_PROVIDER: "mock",
      EMBEDDING_PROVIDER: "fake"
    });

    const serialized = JSON.stringify(report);
    expect(report.status).toBe("error");
    expect(report.checks.databaseUrl).toBe("error");
    expect(report.checks.privateKeyParse).toBe("error");
    expect(serialized).not.toContain("redis://example.internal");
    expect(serialized).not.toContain("webhook-secret");
    expect(serialized).not.toContain("client-secret");
  });

  it("production command check catches missing worker command", () => {
    const root = mkdtempSync(path.join(tmpdir(), "archguard-command-check-"));
    mkdirSync(path.join(root, "apps/api"), { recursive: true });
    mkdirSync(path.join(root, "docs"), { recursive: true });
    mkdirSync(path.join(root, "deploy"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { build: "pnpm -r build" } }));
    writeFileSync(path.join(root, "apps/api/package.json"), JSON.stringify({ scripts: { start: "node dist/src/server.js" } }));
    writeFileSync(path.join(root, "Dockerfile.api"), 'EXPOSE 3000\nCMD ["node", "apps/api/dist/src/server.js"]\n');
    writeFileSync(path.join(root, "Dockerfile.worker"), 'CMD ["node", "apps/api/dist/src/jobs/worker.js"]\n');
    writeFileSync(path.join(root, "docs/deployment.md"), "pnpm prisma migrate deploy --schema prisma/schema.prisma");
    writeFileSync(path.join(root, "deploy/processes.md"), "");

    const report = checkProductionCommands(root);

    expect(report.status).toBe("error");
    expect(report.checks.workerScript).toBe("error");
  });

  it("railway deployment doc exists and mentions required operational paths", () => {
    const doc = readFileSync("../../docs/railway-deployment.md", "utf8");

    expect(doc).toContain("archguard-api");
    expect(doc).toContain("archguard-worker");
    expect(doc).toContain("PORT");
    expect(doc).toContain("/health");
    expect(doc).toContain("/ready");
    expect(doc).toContain("THE_REAL_API_SERVICE_URL");
    expect(doc).toContain("Railway `404 Application not found`");
  });
});
