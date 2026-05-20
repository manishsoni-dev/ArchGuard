import { fileURLToPath } from "node:url";
import { prisma } from "../db/prisma.js";
import { logger } from "../logger.js";
import { loadEnv } from "../env.js";
import { createEmbeddingService, embeddingConfigFromEnv } from "../embeddings/embedding-service.js";
import { HybridRetriever } from "../retrieval/hybrid-retriever.js";
import { VectorRetriever } from "../retrieval/vector-retriever.js";
import type { ContextRetriever, RetrievedContext } from "../retrieval/types.js";
import { seedFixtureRepository } from "./seed-fixture-repository.js";

export type RetrievalExpectation = {
  expectedFiles: string[];
  expectedAnyFiles?: string[];
  actualFiles: string[];
  passed: boolean;
};

export type RetrievalReport = {
  query: string;
  topResults: Array<{
    filePath: string;
    chunkType: string;
    score: number;
    rankingReasons: string[];
    preview: string;
  }>;
  expectations: RetrievalExpectation;
};

const fixtureQueries = [
  {
    query: "frontend must not import database layer",
    expectedFiles: ["docs/adr/0002-frontend-must-not-import-db.md", "src/frontend/components/UserCard.tsx"],
    changedFiles: ["src/frontend/components/UserCard.tsx"]
  },
  {
    query: "UserCard frontend component user display",
    expectedFiles: ["src/frontend/components/UserCard.tsx"],
    changedFiles: ["src/frontend/components/UserCard.tsx"]
  },
  {
    query: "database access user repository",
    expectedFiles: [],
    expectedAnyFiles: ["src/backend/db/user-repository.ts", "src/backend/db/client.ts"]
  }
];

export async function verifyFixtureRetrieval(retriever?: ContextRetriever): Promise<RetrievalReport[]> {
  const env = loadEnv();
  const seed = await seedFixtureRepository();
  const contextRetriever =
    retriever ??
    new HybridRetriever(
      prisma,
      new VectorRetriever(prisma, createEmbeddingService(embeddingConfigFromEnv(env))),
      logger
    );

  const reports: RetrievalReport[] = [];

  for (const fixtureQuery of fixtureQueries) {
    const results = await contextRetriever.retrieve({
      tenantId: seed.tenantId,
      repositoryId: seed.repositoryId,
      queryText: fixtureQuery.query,
      changedFiles: fixtureQuery.changedFiles,
      limit: env.RETRIEVAL_TOP_K,
      maxContextChars: env.RETRIEVAL_MAX_CONTEXT_CHARS
    });

    reports.push(
      buildRetrievalReport(
        fixtureQuery.query,
        results,
        fixtureQuery.expectedFiles,
        fixtureQuery.expectedAnyFiles
      )
    );
  }

  return reports;
}

export function buildRetrievalReport(
  query: string,
  results: RetrievedContext[],
  expectedFiles: string[],
  expectedAnyFiles: string[] = []
): RetrievalReport {
  const topResults = results.slice(0, 8).map((result) => ({
    filePath: result.filePath,
    chunkType: result.chunkType,
    score: Number(result.score.toFixed(4)),
    rankingReasons: result.rankingReasons ?? [],
    preview: preview(result.content)
  }));
  const actualFiles = Array.from(new Set(topResults.map((result) => result.filePath)));
  const allRequiredMatched = expectedFiles.every((file) => actualFiles.includes(file));
  const anyRequiredMatched = expectedAnyFiles.length === 0 || expectedAnyFiles.some((file) => actualFiles.includes(file));

  return {
    query,
    topResults,
    expectations: {
      expectedFiles,
      expectedAnyFiles,
      actualFiles,
      passed: allRequiredMatched && anyRequiredMatched
    }
  };
}

function preview(content: string): string {
  return content.replace(/\s+/g, " ").slice(0, 160);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void verifyFixtureRetrieval()
    .then((reports) => {
      console.log(JSON.stringify(reports, null, 2));
      if (!reports.every((report) => report.expectations.passed)) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
