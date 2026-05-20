import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "../../prisma/migrations/20260519093000_pgvector_retrieval_adr_ingestion/migration.sql"),
  "utf8"
);

describe("pgvector migration", () => {
  it("enables vector extension", () => {
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS vector");
  });

  it("adds vector column to CodeChunk", () => {
    expect(migration).toContain('"embeddingVector" vector(1536)');
  });
});
