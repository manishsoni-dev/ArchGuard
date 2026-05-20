import { fileURLToPath } from "node:url";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { logger } from "../logger.js";
import { loadEnv } from "../env.js";
import { createArchitectureAnalyzer } from "../analysis/analyzer-service.js";
import type { ArchitectureAnalyzer } from "../analysis/analyzer.js";
import type { ArchitectureAnalysisResult, ArchitectureVerdict } from "../analysis/types.js";
import { createEmbeddingService, embeddingConfigFromEnv } from "../embeddings/embedding-service.js";
import { HybridRetriever } from "../retrieval/hybrid-retriever.js";
import { VectorRetriever } from "../retrieval/vector-retriever.js";
import type { ContextRetriever } from "../retrieval/types.js";
import { readDiffFixture } from "./fixture/diff-fixtures.js";
import { seedFixtureRepository } from "./seed-fixture-repository.js";

const argsSchema = z.object({
  diffPath: z.string().min(1)
});

export type AnalyzeFixtureDiffOptions = {
  diffPath: string;
  expectedVerdict?: ArchitectureVerdict;
  analyzer?: ArchitectureAnalyzer;
  retriever?: ContextRetriever;
  seed?: {
    tenantId: string;
    repositoryId: string;
    fullName: string;
  };
};

export type AnalyzeFixtureDiffOutput = {
  result: ArchitectureAnalysisResult;
  matchedExpectedVerdict?: boolean;
};

export function parseAnalyzeFixtureDiffArgs(args: string[]): { diffPath: string } {
  const diffPath = args.filter((arg) => arg !== "--")[0];
  return argsSchema.parse({ diffPath });
}

export async function analyzeFixtureDiff(options: AnalyzeFixtureDiffOptions): Promise<AnalyzeFixtureDiffOutput> {
  const seed = options.seed ?? (await seedFixtureRepository());
  const env = loadEnv();
  const diff = await readDiffFixture(options.diffPath);
  const retriever = options.retriever ?? createDefaultRetriever();
  const analyzer = options.analyzer ?? createArchitectureAnalyzer(env, logger);
  const retrievedContext = await retriever.retrieve({
    tenantId: seed.tenantId,
    repositoryId: seed.repositoryId,
    queryText: diff.diffText,
    changedFiles: diff.changedFiles,
    limit: options.retriever ? 12 : env.RETRIEVAL_TOP_K,
    maxContextChars: options.retriever ? 20_000 : env.RETRIEVAL_MAX_CONTEXT_CHARS
  });

  const result = await analyzer.analyze({
    repositoryFullName: seed.fullName,
    pullRequestNumber: 1,
    diff: diff.diffText,
    changedFiles: diff.changedFiles,
    retrievedContext
  });

  return {
    result,
    matchedExpectedVerdict: options.expectedVerdict ? result.verdict === options.expectedVerdict : undefined
  };
}

function createDefaultRetriever(): ContextRetriever {
  const env = loadEnv();
  return new HybridRetriever(
    prisma,
    new VectorRetriever(prisma, createEmbeddingService(embeddingConfigFromEnv(env))),
    logger
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void (async () => {
    const { diffPath } = parseAnalyzeFixtureDiffArgs(process.argv.slice(2));
    const expectedVerdict = process.env.EXPECT_VERDICT as ArchitectureVerdict | undefined;
    const output = await analyzeFixtureDiff({ diffPath, expectedVerdict });
    console.log(JSON.stringify(output.result, null, 2));

    if (expectedVerdict && !output.matchedExpectedVerdict) {
      process.exit(1);
    }
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
