import { readFile } from "node:fs/promises";
import path from "node:path";
import { workspaceRoot } from "./constants.js";

export type ParsedDiffFixture = {
  filePath: string;
  diffText: string;
  changedFiles: string[];
};

export async function readDiffFixture(filePath: string): Promise<ParsedDiffFixture> {
  const absolutePath = path.resolve(workspaceRoot(), filePath);
  const diffText = await readFile(absolutePath, "utf8");
  return {
    filePath: absolutePath,
    diffText,
    changedFiles: extractChangedFiles(diffText)
  };
}

export function extractChangedFiles(diffText: string): string[] {
  return Array.from(
    new Set(
      diffText
        .split("\n")
        .flatMap((line) => {
          const match = line.match(/^\+\+\+ b\/(.+)$/);
          return match?.[1] && match[1] !== "/dev/null" ? [match[1]] : [];
        })
    )
  );
}
