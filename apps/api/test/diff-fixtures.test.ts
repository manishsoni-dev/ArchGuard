import { describe, expect, it } from "vitest";
import { extractChangedFiles } from "../src/scripts/fixture/diff-fixtures.js";

describe("extractChangedFiles", () => {
  it("extracts changed files from unified diff", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "+export const a = 1;"
    ].join("\n");

    expect(extractChangedFiles(diff)).toEqual(["src/a.ts"]);
  });
});
