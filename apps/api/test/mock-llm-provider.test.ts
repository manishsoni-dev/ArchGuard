import { describe, expect, it } from "vitest";
import { MockLLMProvider } from "../src/llm/mock-llm-provider.js";

describe("MockLLMProvider", () => {
  it("does not flag explanatory context as drift when the PR diff does not add the import", async () => {
    const provider = new MockLLMProvider();
    const result = await provider.generate({
      messages: [
        {
          role: "user",
          content: [
            "Retrieved architecture/code context:",
            "src/frontend/components/UserCard.tsx imports directly from ../../backend/db/client in a prior proof PR.",
            "",
            "Pull request diff:",
            "```diff",
            "diff --git a/README.md b/README.md",
            "+++ b/README.md",
            "@@ -1,1 +1,2 @@",
            "+Document that PR #1 produced DRIFT_RISK for a frontend database import violation.",
            "```"
          ].join("\n")
        }
      ],
      maxOutputTokens: 1200,
      timeoutMs: 30000
    });

    expect(JSON.parse(result.content)).toMatchObject({ verdict: "FIT" });
  });

  it("still flags a frontend database import added in the PR diff", async () => {
    const provider = new MockLLMProvider();
    const result = await provider.generate({
      messages: [
        {
          role: "user",
          content: [
            "Retrieved architecture/code context:",
            "Frontend must not import db.",
            "",
            "Pull request diff:",
            "```diff",
            "diff --git a/src/frontend/components/UserCard.tsx b/src/frontend/components/UserCard.tsx",
            "+++ b/src/frontend/components/UserCard.tsx",
            "@@ -0,0 +1,2 @@",
            "+import { db } from \"../../backend/db/client\";",
            "```"
          ].join("\n")
        }
      ],
      maxOutputTokens: 1200,
      timeoutMs: 30000
    });

    expect(JSON.parse(result.content)).toMatchObject({ verdict: "DRIFT_RISK" });
  });
});
