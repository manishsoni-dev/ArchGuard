import { Worker, UnrecoverableError } from "bullmq";
import { ZodError } from "zod";
import { loadEnv } from "../env.js";
import { prisma } from "../db/prisma.js";
import { logger } from "../logger.js";
import { createArchitectureAnalyzer } from "../analysis/analyzer-service.js";
import { RepositoryIndexer } from "../indexing/repository-indexer.js";
import { HybridRetriever } from "../retrieval/hybrid-retriever.js";
import { VectorRetriever } from "../retrieval/vector-retriever.js";
import { createEmbeddingService, embeddingConfigFromEnv } from "../embeddings/embedding-service.js";
import { analysisQueueName, parseAnalysisJobPayload } from "./analysis-job.js";
import { createRedisConnection } from "./queue.js";
import {
  AnalysisJobProcessor,
  PrismaAnalysisRunStore,
  createGitHubAnalysisService
} from "./processor.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  const embeddings = createEmbeddingService(embeddingConfigFromEnv(env));
  const redisPing = await withTimeout(connection.ping(), 2_000).catch(() => "ERROR");

  const worker = new Worker(
    analysisQueueName,
    async (job) => {
      try {
        const payload = parseAnalysisJobPayload(job.data);
        logger.info(
          {
            jobId: job.id,
            repositoryFullName: `${payload.owner}/${payload.repo}`,
            pullRequestNumber: payload.pullRequestNumber,
            headSha: payload.headSha,
            tenantId: payload.tenantId,
            installationId: payload.installationId,
            githubDeliveryId: payload.webhookEventId
          },
          "ArchGuard analysis worker received job"
        );
        const jobProcessor = new AnalysisJobProcessor({
          store: new PrismaAnalysisRunStore(prisma),
          github: createGitHubAnalysisService(
            {
              appId: env.GITHUB_APP_ID,
              privateKey: env.GITHUB_PRIVATE_KEY
            },
            payload.installationId
          ),
        analyzer: createArchitectureAnalyzer(env, logger),
        retriever: new HybridRetriever(
          prisma,
          new VectorRetriever(prisma, embeddings),
          logger
        ),
        indexer: new RepositoryIndexer(prisma, embeddings, logger),
        logger,
        retrieval: {
          topK: env.RETRIEVAL_TOP_K,
          maxContextChars: env.RETRIEVAL_MAX_CONTEXT_CHARS
        }
      });

        await jobProcessor.process(payload, {
          jobId: String(job.id),
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts ?? 1
        });
      } catch (error) {
        if (error instanceof ZodError) {
          throw new UnrecoverableError("Invalid analysis job payload");
        }
        throw error;
      }
    },
    { connection }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "ArchGuard analysis job completed");
  });

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, err: error }, "ArchGuard analysis job failed");
  });

  logger.info(
    {
      queueName: analysisQueueName,
      redisStatus: connection.status,
      redisPing,
      nodeEnv: env.NODE_ENV,
      githubEnvPresent: {
        appId: Boolean(env.GITHUB_APP_ID),
        privateKey: Boolean(env.GITHUB_PRIVATE_KEY),
        webhookSecret: Boolean(env.GITHUB_WEBHOOK_SECRET),
        clientId: Boolean(env.GITHUB_CLIENT_ID),
        clientSecret: Boolean(env.GITHUB_CLIENT_SECRET)
      }
    },
    "ArchGuard analysis worker started"
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("Operation timed out")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error) => {
    logger.error({ err: error }, "ArchGuard worker failed to start");
    process.exit(1);
  });
}
