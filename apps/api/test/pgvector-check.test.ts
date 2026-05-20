import { describe, expect, it } from "vitest";
import { buildPgvectorSimilaritySmokeSql, checkPgvector } from "../src/db/pgvector-check.js";

describe("pgvector check", () => {
  it("builds safe smoke SQL with vector casts", () => {
    const sql = buildPgvectorSimilaritySmokeSql(3);

    expect(sql).toBe("SELECT '[0,0,0]'::vector <=> '[0,0,0]'::vector AS distance");
  });

  it("handles missing extension gracefully", async () => {
    const prisma = {
      $queryRaw: async () => {
        throw new Error("missing extension");
      },
      $queryRawUnsafe: async () => {
        throw new Error("missing extension");
      }
    };

    await expect(checkPgvector(prisma as never, 3)).resolves.toEqual({
      extension: "error",
      column: "error",
      similarityQuery: "error"
    });
  });
});
