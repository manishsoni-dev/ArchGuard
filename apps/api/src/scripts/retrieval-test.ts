import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadEnv } from "../env.js";
import { prisma } from "../db/prisma.js";
import { logger } from "../logger.js";
import { createEmbeddingService, embeddingConfigFromEnv } from "../embeddings/embedding-service.js";
import { VectorRetriever } from "../retrieval/vector-retriever.js";
import { HybridRetriever } from "../retrieval/hybrid-retriever.js";

const argsSchema = z.object({
  tenantId: z.string().min(1),
  repositoryId: z.string().min(1),
  query: z.string().min(1)
});

export async function testRetrievalFromCli(args = process.argv.slice(2)): Promise<void> {
  const parsed = argsSchema.parse(Object.fromEntries(args.map((arg) => arg.split("=", 2))));
  const env = loadEnv();
  const embeddings = createEmbeddingService(embeddingConfigFromEnv(env));
  const retriever = new HybridRetriever(prisma, new VectorRetriever(prisma, embeddings), logger);
  const context = await retriever.retrieve({
    tenantId: parsed.tenantId,
    repositoryId: parsed.repositoryId,
    queryText: parsed.query,
    limit: env.RETRIEVAL_TOP_K,
    maxContextChars: env.RETRIEVAL_MAX_CONTEXT_CHARS
  });

  console.log(JSON.stringify(context.map(({ content: _content, ...item }) => item), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void testRetrievalFromCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
