import { describe, expect, it, vi } from "vitest";
import { buildVectorSearchSqlPreview } from "../src/retrieval/vector-retriever.js";
import { HybridRetriever, scorePathMatch, tokenizeFilePath } from "../src/retrieval/hybrid-retriever.js";
import { logger } from "../src/logger.js";

describe("retrieval", () => {
  it("builds vector search SQL preview with scoped filters", () => {
    const sql = buildVectorSearchSqlPreview({ includeChunkTypes: true });

    expect(sql).toContain('"tenantId" = $tenantId');
    expect(sql).toContain('"repositoryId" = $repositoryId');
    expect(sql).toContain('"embeddingVector" <=> $queryEmbedding::vector');
  });

  it("hybrid retriever includes changed-file and ADR context", async () => {
    const prisma = fakePrisma();
    const vectorRetriever = {
      retrieve: vi.fn(async () => [
        chunk("vector-1", "src/service.ts", "CODE", 0.8)
      ])
    };
    const retriever = new HybridRetriever(prisma, vectorRetriever, logger);

    const results = await retriever.retrieve({
      tenantId: "tenant-1",
      repositoryId: "repo-1",
      queryText: "frontend db boundary",
      changedFiles: ["frontend/App.tsx"],
      limit: 10
    });

    expect(results.map((result) => result.chunkId)).toEqual(["changed-1", "adr-1", "vector-1", "keyword-1"]);
  });

  it("falls back to keyword retrieval when vector retrieval fails", async () => {
    const prisma = fakePrisma();
    const retriever = new HybridRetriever(
      prisma,
      { retrieve: vi.fn(async () => { throw new Error("no vector"); }) },
      logger
    );

    const results = await retriever.retrieve({
      tenantId: "tenant-1",
      repositoryId: "repo-1",
      queryText: "service",
      limit: 10
    });

    expect(results.some((result) => result.chunkId === "keyword-1")).toBe(true);
  });

  it("tokenizes file paths across separators and camel case", () => {
    expect(tokenizeFilePath("src/backend/db/user-repository.ts")).toEqual(
      expect.arrayContaining(["src", "backend", "db", "user", "repository", "ts"])
    );
    expect(tokenizeFilePath("src/backend/db/user_repository.ts")).toEqual(expect.arrayContaining(["user", "repository"]));
    expect(tokenizeFilePath("src/backend/db/userRepository.ts")).toEqual(expect.arrayContaining(["user", "repository"]));
    expect(scorePathMatch("user repository", "src/backend/db/user-repository.ts")).toBeGreaterThan(0.8);
  });

  it("prioritizes backend db code for database repository queries", async () => {
    const prisma = fakePrisma({
      adrChunks: [dbChunk("adr-1", "docs/adr/0002-frontend-must-not-import-db.md", "ADR")],
      keywordChunks: [
        dbChunk("adr-2", "docs/adr/0001-layered-architecture.md", "ADR"),
        dbChunk("repo-1", "src/backend/db/user-repository.ts", "CODE"),
        dbChunk("client-1", "src/backend/db/client.ts", "CODE")
      ]
    });
    const retriever = new HybridRetriever(prisma, { retrieve: vi.fn(async () => []) }, logger);

    const results = await retriever.retrieve({
      tenantId: "tenant-1",
      repositoryId: "repo-1",
      queryText: "database access user repository",
      limit: 5
    });

    expect(results[0]?.filePath).toBe("src/backend/db/user-repository.ts");
    expect(results[0]?.rankingReasons).toContain("path-keyword");
  });

  it("does not let ADR chunks crowd out code-intent lookup results", async () => {
    const prisma = fakePrisma({
      adrChunks: [
        dbChunk("adr-1", "docs/adr/0002-frontend-must-not-import-db.md", "ADR"),
        dbChunk("adr-2", "docs/adr/0001-layered-architecture.md", "ADR"),
        dbChunk("adr-3", "docs/adr/0003-service-boundaries.md", "ADR")
      ],
      keywordChunks: [
        dbChunk("repo-1", "src/backend/db/user-repository.ts", "CODE"),
        dbChunk("client-1", "src/backend/db/client.ts", "CODE")
      ]
    });
    const retriever = new HybridRetriever(prisma, { retrieve: vi.fn(async () => []) }, logger);

    const results = await retriever.retrieve({
      tenantId: "tenant-1",
      repositoryId: "repo-1",
      queryText: "database access user repository",
      limit: 3
    });

    expect(results.map((result) => result.filePath)).toEqual(
      expect.arrayContaining(["src/backend/db/user-repository.ts", "src/backend/db/client.ts"])
    );
  });

  it("still prioritizes ADRs for architecture policy queries", async () => {
    const prisma = fakePrisma({
      adrChunks: [dbChunk("adr-2", "docs/adr/0002-frontend-must-not-import-db.md", "ADR")],
      keywordChunks: [dbChunk("card-1", "src/frontend/components/UserCard.tsx", "CODE")]
    });
    const retriever = new HybridRetriever(prisma, { retrieve: vi.fn(async () => []) }, logger);

    const results = await retriever.retrieve({
      tenantId: "tenant-1",
      repositoryId: "repo-1",
      queryText: "frontend must not import database layer",
      limit: 5
    });

    expect(results[0]?.filePath).toBe("docs/adr/0002-frontend-must-not-import-db.md");
    expect(results[0]?.rankingReasons).toContain("adr-keyword");
  });

  it("prioritizes frontend component files for component queries", async () => {
    const prisma = fakePrisma({
      keywordChunks: [
        dbChunk("card-1", "src/frontend/components/UserCard.tsx", "CODE"),
        dbChunk("readme-1", "README.md", "DOC")
      ]
    });
    const retriever = new HybridRetriever(prisma, { retrieve: vi.fn(async () => []) }, logger);

    const results = await retriever.retrieve({
      tenantId: "tenant-1",
      repositoryId: "repo-1",
      queryText: "UserCard frontend component user display",
      limit: 5
    });

    expect(results[0]?.filePath).toBe("src/frontend/components/UserCard.tsx");
  });
});

function fakePrisma(options: {
  changedChunks?: ReturnType<typeof dbChunk>[];
  adrChunks?: ReturnType<typeof dbChunk>[];
  keywordChunks?: ReturnType<typeof dbChunk>[];
} = {}) {
  return {
    codeChunk: {
      findMany: vi.fn(async (args: { where: { filePath?: { in: string[] }; chunkType?: string; OR?: unknown } }) => {
        if (args.where.filePath) {
          return options.changedChunks ?? [dbChunk("changed-1", "frontend/App.tsx", "CODE")];
        }
        if (args.where.chunkType === "ADR") {
          return options.adrChunks ?? [dbChunk("adr-1", "docs/adr/0002.md", "ADR")];
        }
        if (args.where.OR) {
          return options.keywordChunks ?? [dbChunk("keyword-1", "src/service.ts", "CODE")];
        }
        return [];
      })
    }
  } as never;
}

function dbChunk(id: string, filePath: string, chunkType: string) {
  return {
    id,
    filePath,
    chunkType,
    startLine: 1,
    endLine: 2,
    symbolName: null,
    content: `${filePath} content`
  };
}

function chunk(chunkId: string, filePath: string, chunkType: "CODE" | "ADR", score: number) {
  return {
    chunkId,
    filePath,
    chunkType,
    content: `${filePath} content`,
    score,
    rankingReasons: ["vector" as const]
  };
}
