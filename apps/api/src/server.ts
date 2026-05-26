import Fastify from "fastify";
import { loadEnv, type Env } from "./env.js";
import { prisma } from "./db/prisma.js";
import { registerGitHubWebhookRoute } from "./routes/github-webhook.js";
import { registerHealthRoutes, type ReadinessDependencies } from "./routes/health.js";
import type { AnalysisEnqueuer } from "./jobs/enqueue-analysis.js";
import { BullMQAnalysisEnqueuer } from "./jobs/enqueue-analysis.js";
import { createAnalysisQueue, createRedisConnection } from "./jobs/queue.js";
import { logger } from "./logger.js";
import { PrismaWebhookEventStore, type WebhookEventStore } from "./db/webhook-events.js";

export type ServerEnv = Pick<
  Env,
  | "DATABASE_URL"
  | "REDIS_URL"
  | "GITHUB_APP_ID"
  | "GITHUB_PRIVATE_KEY"
  | "GITHUB_WEBHOOK_SECRET"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
  | "DEV_WEBHOOK_TOKEN"
  | "APP_VERSION"
  | "GIT_SHA"
  | "NODE_ENV"
>;

export type BuildServerOptions = {
  env: ServerEnv;
  eventStore: WebhookEventStore;
  enqueuer: AnalysisEnqueuer;
  readiness: ReadinessDependencies;
};

export async function buildServer(options: BuildServerOptions) {
  const fastify = Fastify({
    logger: true
  });

  fastify.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    const requestWithRawBody = request as typeof request & { rawBody?: string };
    requestWithRawBody.rawBody = rawBody;

    try {
      done(null, JSON.parse(rawBody));
    } catch (error) {
      done(error as Error);
    }
  });

  await registerGitHubWebhookRoute(fastify, {
    webhookSecret: options.env.GITHUB_WEBHOOK_SECRET,
    devWebhookToken: options.env.DEV_WEBHOOK_TOKEN,
    nodeEnv: options.env.NODE_ENV,
    eventStore: options.eventStore,
    enqueuer: options.enqueuer,
    logger
  });

  await registerHealthRoutes(fastify, {
    env: options.env,
    readiness: options.readiness
  });

  return fastify;
}

export async function startServer(): Promise<void> {
  const env = loadEnv();
  const queue = createAnalysisQueue(env.REDIS_URL);
  const readinessRedis = createRedisConnection(env.REDIS_URL);
  const eventStore = new PrismaWebhookEventStore(prisma);
  const enqueuer = new BullMQAnalysisEnqueuer(queue);

  const server = await buildServer({
    env,
    eventStore,
    enqueuer,
    readiness: {
      checkDatabase: async () => {
        await prisma.$queryRaw`SELECT 1`;
      },
      checkRedis: async () => {
        await withTimeout(readinessRedis.ping(), 2_000, "Redis readiness check timed out");
      }
    }
  });

  try {
    await server.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (error) {
    throw friendlyListenError(error, env.PORT);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
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
  void startServer().catch((error) => {
    if (error instanceof FriendlyStartupError) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}

export class FriendlyStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FriendlyStartupError";
  }
}

export function friendlyListenError(error: unknown, port: number): Error {
  if (isAddrInUseError(error)) {
    return new FriendlyStartupError(
      `Port ${port} is already in use. Stop the existing server or run: pnpm kill:port -- ${port} --yes`
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

function isAddrInUseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EADDRINUSE"
  );
}
