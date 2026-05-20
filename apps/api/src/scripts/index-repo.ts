import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadEnv } from "../env.js";
import { prisma } from "../db/prisma.js";
import { logger } from "../logger.js";
import { RepositoryIndexer } from "../indexing/repository-indexer.js";
import { createEmbeddingService, embeddingConfigFromEnv } from "../embeddings/embedding-service.js";

const argsSchema = z.object({
  tenantId: z.string().min(1),
  repositoryId: z.string().min(1),
  cloneUrl: z.string().url(),
  fullName: z.string().min(1)
});

export async function indexRepositoryFromCli(args = process.argv.slice(2)): Promise<void> {
  const parsed = argsSchema.parse(Object.fromEntries(args.map((arg) => arg.split("=", 2))));
  const env = loadEnv();
  const indexer = new RepositoryIndexer(prisma, createEmbeddingService(embeddingConfigFromEnv(env)), logger);
  await indexer.indexRepository(parsed);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void indexRepositoryFromCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
