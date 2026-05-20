import { describe, expect, it } from "vitest";
import { planIndexingChanges } from "../src/indexing/repository-indexer.js";
import type { ScannedSourceFile } from "../src/indexing/file-scanner.js";
import { createHash } from "node:crypto";

describe("planIndexingChanges", () => {
  it("skips unchanged files, rebuilds changed files, and removes deleted files", () => {
    const unchanged = source("src/unchanged.ts", "same");
    const changed = source("src/changed.ts", "new");

    const plan = planIndexingChanges(
      [
        { filePath: "src/unchanged.ts", contentHash: hash("same") },
        { filePath: "src/changed.ts", contentHash: hash("old") },
        { filePath: "src/deleted.ts", contentHash: hash("deleted") }
      ],
      [unchanged, changed]
    );

    expect(plan.unchanged).toEqual(["src/unchanged.ts"]);
    expect(plan.changed.map((file) => file.relativePath)).toEqual(["src/changed.ts"]);
    expect(plan.deleted).toEqual(["src/deleted.ts"]);
  });
});

function source(relativePath: string, content: string): ScannedSourceFile {
  return {
    relativePath,
    content,
    sizeBytes: content.length,
    language: "ts"
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
