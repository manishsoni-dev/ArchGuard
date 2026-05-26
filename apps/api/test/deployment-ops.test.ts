import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkMigrationStatus } from "../src/scripts/migration-status.js";
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
    expect(readme).toContain("deploy/processes.md");
  });
});
