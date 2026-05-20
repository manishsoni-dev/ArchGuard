import { describe, expect, it } from "vitest";
import { signGithubWebhookBody, verifyGithubWebhookSignature } from "../src/github/verify-signature.js";

describe("verifyGithubWebhookSignature", () => {
  it("passes for a valid GitHub webhook signature", () => {
    const rawBody = JSON.stringify({ zen: "Architecture is a shape, not a vibe." });
    const secret = "local-test-secret";
    const signatureHeader = signGithubWebhookBody(rawBody, secret);

    expect(
      verifyGithubWebhookSignature({
        rawBody,
        signatureHeader,
        secret
      })
    ).toBe(true);
  });

  it("fails for an invalid GitHub webhook signature", () => {
    const rawBody = JSON.stringify({ zen: "Architecture is a shape, not a vibe." });

    expect(
      verifyGithubWebhookSignature({
        rawBody,
        signatureHeader: "sha256=bad",
        secret: "local-test-secret"
      })
    ).toBe(false);
  });
});
