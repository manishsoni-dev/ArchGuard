import { describe, expect, it } from "vitest";
import { githubIdentityCheck } from "../src/scripts/github-identity-check.js";

const staleOwner = ["Maniss", "hhhhhh"].join("");

describe("GitHub identity check", () => {
  it("reports stale owner references in tracked text files", async () => {
    const report = await githubIdentityCheck({
      listFiles: async () => ["README.md", ".env.production", "apps/api/.archguard/state.json"],
      readFile: async (file) =>
        file === "README.md" ? `old https://github.com/${staleOwner}/ArchGuard\nowner ${staleOwner}\n` : staleOwner
    });

    expect(report.status).toBe("error");
    expect(report.findings).toEqual([
      {
        file: "README.md",
        line: 1,
        match: `github.com/${staleOwner}`
      },
      {
        file: "README.md",
        line: 2,
        match: staleOwner
      }
    ]);
  });

  it("passes when tracked text files use the canonical owner", async () => {
    const report = await githubIdentityCheck({
      listFiles: async () => ["README.md"],
      readFile: async () => "https://github.com/manishsoni-dev/ArchGuard"
    });

    expect(report.status).toBe("ok");
    expect(report.findings).toEqual([]);
  });
});
