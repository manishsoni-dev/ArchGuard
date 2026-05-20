import { describe, expect, it } from "vitest";
import { chunkByLanguage } from "../src/indexing/language-chunker.js";

describe("chunkByLanguage", () => {
  it("chunks TypeScript exported functions and classes", () => {
    const chunks = chunkByLanguage({
      filePath: "src/service.ts",
      content: "export function one() {}\n\nexport class Two {}\n"
    });

    expect(chunks.map((chunk) => chunk.symbolName)).toEqual(["one", "Two"]);
  });

  it("chunks Python def and class declarations", () => {
    const chunks = chunkByLanguage({
      filePath: "service.py",
      content: "def one():\n    pass\n\nclass Two:\n    pass\n"
    });

    expect(chunks.map((chunk) => chunk.symbolName)).toEqual(["one", "Two"]);
  });

  it("chunks Markdown by headings", () => {
    const chunks = chunkByLanguage({
      filePath: "docs/readme.md",
      content: "# Intro\nText\n\n## Details\nMore"
    });

    expect(chunks.map((chunk) => chunk.symbolName)).toEqual(["Intro", "Details"]);
  });

  it("falls back to line windows", () => {
    const chunks = chunkByLanguage({
      filePath: "notes.txt",
      content: "a\nb\nc",
      linesPerChunk: 2
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[1]?.startLine).toBe(3);
  });
});
