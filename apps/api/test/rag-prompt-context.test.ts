import { describe, expect, it } from "vitest";
import { compressRetrievedContext } from "../src/analysis/rag/context-compressor.js";
import { buildRagPrompt } from "../src/analysis/rag/prompt-builder.js";

describe("RAG prompt and context compression", () => {
  it("prioritizes ADR and changed-file chunks", () => {
    const compressed = compressRetrievedContext({
      context: [
        context("code-1", "src/backend/db/client.ts", "CODE", 0.9),
        context("adr-1", "docs/adr/0002-frontend-must-not-import-db.md", "ADR", 0.2),
        context("changed-1", "src/frontend/components/UserCard.tsx", "CODE", 0.1)
      ],
      changedFiles: ["src/frontend/components/UserCard.tsx"],
      diff: "+import { db } from '../../backend/db/client';",
      maxContextChars: 20_000
    });

    expect(compressed.records[0]?.filePath).toBe("docs/adr/0002-frontend-must-not-import-db.md");
    expect(compressed.records.map((record) => record.filePath)).toContain("src/frontend/components/UserCard.tsx");
  });

  it("respects RAG_MAX_CONTEXT_CHARS and truncates safely", () => {
    const compressed = compressRetrievedContext({
      context: [
        context("adr-1", "docs/adr/0002.md", "ADR", 1, "x".repeat(5_000)),
        context("code-1", "src/service.ts", "CODE", 1, "y".repeat(5_000))
      ],
      changedFiles: [],
      diff: "+import { db } from './db';",
      maxContextChars: 1_800
    });

    expect(compressed.formatted.length).toBeLessThan(1_900);
    expect(compressed.formatted).toContain("[truncated]");
  });

  it("builds architecture-specific prompts with ADR and changed files", () => {
    const compressed = compressRetrievedContext({
      context: [
        context("adr-1", "docs/adr/0002-frontend-must-not-import-db.md", "ADR", 1),
        context("changed-1", "src/frontend/components/UserCard.tsx", "CODE", 1)
      ],
      changedFiles: ["src/frontend/components/UserCard.tsx"],
      diff: "+import { db } from '../../backend/db/client';",
      maxContextChars: 20_000
    });
    const prompt = buildRagPrompt({
      promptVersion: "archguard-rag-v1",
      context: compressed,
      analysisInput: {
        repositoryFullName: "local/layered-app",
        pullRequestNumber: 1,
        diff: "+import { db } from '../../backend/db/client';",
        changedFiles: ["src/frontend/components/UserCard.tsx"],
        retrievedContext: compressed.records
      }
    });

    expect(prompt.system).toContain("not a generic code reviewer");
    expect(prompt.system).toContain("If retrieved context is insufficient");
    expect(prompt.user).toContain("docs/adr/0002-frontend-must-not-import-db.md");
    expect(prompt.user).toContain("Changed files: src/frontend/components/UserCard.tsx");
  });
});

function context(
  chunkId: string,
  filePath: string,
  chunkType: "ADR" | "CODE",
  score: number,
  content = `${filePath} content`
) {
  return {
    chunkId,
    filePath,
    chunkType,
    score,
    content,
    startLine: 1,
    endLine: 10
  };
}

