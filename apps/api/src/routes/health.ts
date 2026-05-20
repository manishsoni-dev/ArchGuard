import { createPrivateKey } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Env } from "../env.js";

type CheckStatus = "ok" | "error";
type OverallStatus = "ok" | "degraded" | "error";

export type ReadinessDependencies = {
  checkDatabase: () => Promise<void>;
  checkRedis: () => Promise<void>;
};

export type RegisterHealthRoutesOptions = {
  env: Pick<
    Env,
    | "DATABASE_URL"
    | "REDIS_URL"
    | "GITHUB_APP_ID"
    | "GITHUB_PRIVATE_KEY"
    | "GITHUB_WEBHOOK_SECRET"
    | "GITHUB_CLIENT_ID"
    | "GITHUB_CLIENT_SECRET"
    | "NODE_ENV"
  >;
  readiness: ReadinessDependencies;
};

export async function registerHealthRoutes(
  fastify: FastifyInstance,
  options: RegisterHealthRoutesOptions
): Promise<void> {
  fastify.get("/health", async () => ({
    status: "ok",
    service: "archguard-api"
  }));

  fastify.get("/ready", async (_request, reply) => {
    const checks = {
      database: await toCheckStatus(options.readiness.checkDatabase),
      redis: await toCheckStatus(options.readiness.checkRedis),
      env: requiredEnvPresent(options.env) ? "ok" : "error",
      githubApp: githubPrivateKeyLooksParseable(options.env.GITHUB_PRIVATE_KEY) ? "ok" : "error"
    } satisfies Record<string, CheckStatus>;

    const status = readinessStatus(checks);
    const statusCode = status === "ok" ? 200 : 503;

    return reply.code(statusCode).send({
      status,
      checks
    });
  });
}

async function toCheckStatus(check: () => Promise<void>): Promise<CheckStatus> {
  try {
    await check();
    return "ok";
  } catch {
    return "error";
  }
}

function requiredEnvPresent(env: RegisterHealthRoutesOptions["env"]): boolean {
  return [
    env.DATABASE_URL,
    env.REDIS_URL,
    String(env.GITHUB_APP_ID),
    env.GITHUB_PRIVATE_KEY,
    env.GITHUB_WEBHOOK_SECRET,
    env.GITHUB_CLIENT_ID,
    env.GITHUB_CLIENT_SECRET,
    env.NODE_ENV
  ].every((value) => value.trim().length > 0);
}

function githubPrivateKeyLooksParseable(privateKey: string): boolean {
  try {
    createPrivateKey(privateKey);
    return true;
  } catch {
    return false;
  }
}

function readinessStatus(checks: Record<string, CheckStatus>): OverallStatus {
  const values = Object.values(checks);

  if (values.every((value) => value === "ok")) {
    return "ok";
  }

  if (checks.env === "error" || checks.githubApp === "error") {
    return "error";
  }

  return "degraded";
}
