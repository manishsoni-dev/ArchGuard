import { describe, expect, it } from "vitest";
import { detectArchitectureDocuments, isAdrPath } from "../src/indexing/document-scanner.js";
import type { ScannedSourceFile } from "../src/indexing/file-scanner.js";

describe("document scanner", () => {
  it("detects ADR paths and ignores non-Markdown files", () => {
    const docs = detectArchitectureDocuments([
      file("docs/adr/0001-test.md"),
      file("docs/adr/diagram.png"),
      file("docs/architecture/overview.md"),
      file("src/index.ts")
    ]);

    expect(isAdrPath("docs/adrs/0002-boundary.md")).toBe(true);
    expect(docs.map((doc) => [doc.filePath, doc.documentType])).toEqual([
      ["docs/adr/0001-test.md", "ADR"],
      ["docs/architecture/overview.md", "ADR"]
    ]);
  });
});

function file(relativePath: string): ScannedSourceFile {
  return {
    relativePath,
    content: "# Doc",
    sizeBytes: 5,
    language: relativePath.split(".").pop()
  };
}
