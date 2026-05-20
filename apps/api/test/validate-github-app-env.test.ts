import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toEscapedEnvPrivateKey, validateGitHubAppEnv } from "../src/github/github-app-env-validation.js";

describe("validate-github-app-env", () => {
  it("rejects placeholder appId", async () => {
    const result = validateGitHubAppEnv(await validEnv({ GITHUB_APP_ID: "123456" }));

    expect(result.status).toBe("error");
    expect(result.checks.appId).toBe("error");
  });

  it("rejects placeholder private key", async () => {
    const result = validateGitHubAppEnv(
      await validEnv({
        GITHUB_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\\nPASTE_REAL_KEY_LINES_HERE\\n-----END RSA PRIVATE KEY-----"
      })
    );

    expect(result.status).toBe("error");
    expect(result.checks.privateKey).toBe("error");
    expect(result.problems.map((problem) => problem.message).join("\n")).toContain("placeholder");
  });

  it("rejects private key containing KEY=", async () => {
    const result = validateGitHubAppEnv(await validEnv({ GITHUB_PRIVATE_KEY: "KEY=/path/to/key.pem" }));

    expect(result.status).toBe("error");
    expect(result.checks.privateKey).toBe("error");
  });

  it("rejects public webhook placeholder", async () => {
    const result = validateGitHubAppEnv(
      await validEnv({ PUBLIC_WEBHOOK_URL: "https://your_real-ngrok-url.ngrok-free.app" })
    );

    expect(result.status).toBe("error");
    expect(result.checks.publicWebhookUrl).toBe("error");
  });

  it("accepts valid env fixture", async () => {
    const result = validateGitHubAppEnv(await validEnv());

    expect(result.status).toBe("ok");
    expect(result.problems).toEqual([]);
  });

  it("never includes secret values in output", async () => {
    const result = validateGitHubAppEnv(await validEnv({ GITHUB_WEBHOOK_SECRET: "PASTE_secret-value" }));
    const output = JSON.stringify(result);

    expect(output).not.toContain("PASTE_secret-value");
    expect(output).not.toContain("client-secret");
    expect(output).not.toContain("BEGIN RSA PRIVATE KEY");
  });
});

async function validEnv(overrides: Record<string, string> = {}) {
  const pem = await readFile(path.resolve("test/fixtures/test-private-key.pem"), "utf8");
  return {
    GITHUB_APP_ID: "654321",
    GITHUB_PRIVATE_KEY: toEscapedEnvPrivateKey(pem),
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    PUBLIC_WEBHOOK_URL: "https://abc.ngrok-free.app",
    TEST_GITHUB_OWNER: "mmanishsoni70",
    TEST_GITHUB_REPO: "archguard-test",
    ...overrides
  };
}
