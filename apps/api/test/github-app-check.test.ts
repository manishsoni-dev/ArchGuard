import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkGitHubAppConfig } from "../src/github/github-app-check.js";

describe("GitHub App config checker", () => {
  it("rejects missing GITHUB_APP_ID", () => {
    const result = checkGitHubAppConfig(validConfig({ GITHUB_APP_ID: undefined }));

    expect(result.status).toBe("error");
    expect(result.errors).toContain("GITHUB_APP_ID is required.");
  });

  it("rejects missing GITHUB_WEBHOOK_SECRET", () => {
    const result = checkGitHubAppConfig(validConfig({ GITHUB_WEBHOOK_SECRET: undefined }));

    expect(result.status).toBe("error");
    expect(result.errors).toContain("GITHUB_WEBHOOK_SECRET is required.");
  });

  it("rejects malformed private key without exposing secret values", () => {
    const result = checkGitHubAppConfig(validConfig({ GITHUB_PRIVATE_KEY: "not-a-private-key-secret" }));

    expect(result.status).toBe("error");
    expect(result.errors.join("\n")).toContain("GITHUB_PRIVATE_KEY must include a PEM private key header");
    expect(result.errors.join("\n")).not.toContain("not-a-private-key-secret");
  });
});

function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    GITHUB_APP_ID: 123,
    GITHUB_PRIVATE_KEY: generatePrivateKey(),
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    ...overrides
  };
}

function generatePrivateKey(): string {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" }
  }).privateKey;
}
