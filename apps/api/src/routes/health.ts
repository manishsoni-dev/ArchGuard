import type { FastifyInstance } from "fastify";
import type { Env } from "../env.js";
import { githubAppDiagnostics } from "../github/github-app-env-validation.js";

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
    | "APP_VERSION"
    | "GIT_SHA"
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

  fastify.get("/version", async () => ({
    service: "archguard-api",
    version: options.env.APP_VERSION,
    commit: options.env.GIT_SHA,
    environment: options.env.NODE_ENV
  }));

  fastify.get("/ready", async (_request, reply) => {
    const checks = {
      database: await toCheckStatus(options.readiness.checkDatabase),
      redis: await toCheckStatus(options.readiness.checkRedis),
      env: requiredEnvPresent(options.env) ? "ok" : "error",
      githubApp: githubAppReady(options.env) ? "ok" : "error"
    } satisfies Record<string, CheckStatus>;

    const status = readinessStatus(checks);
    const statusCode = status === "ok" ? 200 : 503;

    const body: {
      status: OverallStatus;
      checks: typeof checks;
      githubAppDiagnostics?: ReturnType<typeof githubAppDiagnostics>;
    } = {
      status,
      checks
    };

    if (options.env.NODE_ENV !== "production") {
      body.githubAppDiagnostics = githubAppDiagnostics(options.env);
    }

    return reply.code(statusCode).send(body);
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
  const requiredValues = {
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    GITHUB_APP_ID: String(env.GITHUB_APP_ID),
    GITHUB_PRIVATE_KEY: env.GITHUB_PRIVATE_KEY,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    NODE_ENV: env.NODE_ENV
  };

  return Object.values(requiredValues).every((value) => value.trim().length > 0);
}

function githubAppReady(env: RegisterHealthRoutesOptions["env"]): boolean {
  return Object.values(githubAppDiagnostics(env)).every((value) => value === "ok");
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
