import { describe, expect, it } from "vitest";
import { parseAnalysisJobPayload } from "../src/jobs/analysis-job.js";

describe("analysis job payload", () => {
  it("passes Zod validation for a valid payload", () => {
    expect(parseAnalysisJobPayload(validPayload())).toEqual(validPayload());
  });

  it("fails Zod validation for an invalid payload", () => {
    expect(() =>
      parseAnalysisJobPayload({
        ...validPayload(),
        installationId: "not-a-number"
      })
    ).toThrow();
  });
});

function validPayload() {
  return {
    tenantId: "tenant-1",
    repositoryId: "repo-1",
    owner: "acme",
    repo: "widgets",
    installationId: 1001,
    pullRequestNumber: 42,
    headSha: "abc123",
    webhookEventId: "webhook-1"
  };
}
