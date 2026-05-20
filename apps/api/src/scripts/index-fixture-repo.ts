import { fileURLToPath } from "node:url";
import { prisma } from "../db/prisma.js";
import { logger } from "../logger.js";
import { loadEnv } from "../env.js";
import { RepositoryIndexer } from "../indexing/repository-indexer.js";
import { createEmbeddingService, embeddingConfigFromEnv } from "../embeddings/embedding-service.js";
import { seedFixtureRepository } from "./seed-fixture-repository.js";

export type FixtureIndexReport = {
  indexedFileCount: number;
  codeChunkCount: number;
  adrChunkCount: number;
  embeddingCounts: {
    pending: number;
    embedded: number;
    failed: number;
  };
  architectureDocumentCount: number;
};

export async function indexFixtureRepository(): Promise<FixtureIndexReport> {
  const env = loadEnv();
  const seed = await seedFixtureRepository();
  const indexer = new RepositoryIndexer(prisma, createEmbeddingService(embeddingConfigFromEnv(env)), logger);

  await indexer.indexRepository({
    tenantId: seed.tenantId,
    repositoryId: seed.repositoryId,
    cloneUrl: seed.localPath,
    fullName: seed.fullName,
    localPath: seed.localPath
  });

  return fixtureIndexReport(seed.tenantId, seed.repositoryId);
}

export async function fixtureIndexReport(tenantId: string, repositoryId: string): Promise<FixtureIndexReport> {
  const [indexedFileCount, codeChunkCount, adrChunkCount, architectureDocumentCount, pending, embedded, failed] =
    await Promise.all([
      prisma.indexedFile.count({ where: { tenantId, repositoryId } }),
      prisma.codeChunk.count({ where: { tenantId, repositoryId, chunkType: { not: "ADR" } } }),
      prisma.codeChunk.count({ where: { tenantId, repositoryId, chunkType: "ADR" } }),
      prisma.architectureDocument.count({ where: { tenantId, repositoryId } }),
      prisma.codeChunk.count({ where: { tenantId, repositoryId, embeddingStatus: "PENDING" } }),
      prisma.codeChunk.count({ where: { tenantId, repositoryId, embeddingStatus: "EMBEDDED" } }),
      prisma.codeChunk.count({ where: { tenantId, repositoryId, embeddingStatus: "FAILED" } })
    ]);

  return {
    indexedFileCount,
    codeChunkCount,
    adrChunkCount,
    embeddingCounts: {
      pending,
      embedded,
      failed
    },
    architectureDocumentCount
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void indexFixtureRepository()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
