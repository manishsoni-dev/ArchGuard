import path from "node:path";
import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

for (const candidate of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../../.env")]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate });
    break;
  }
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_PRIVATE_KEY: z.string().min(1).transform((value) => value.replace(/\\n/g, "\n")),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  DEV_WEBHOOK_TOKEN: z.string().default(""),
  EMBEDDING_PROVIDER: z.enum(["fake", "openai"]).default("fake"),
  OPENAI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().default(64),
  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(12),
  RETRIEVAL_MAX_CONTEXT_CHARS: z.coerce.number().int().positive().default(20_000),
  LLM_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1_200),
  ANALYZER_PROVIDER: z.enum(["mock", "rag"]).default("mock"),
  RAG_FALLBACK_TO_MOCK: z.coerce.boolean().default(true),
  RAG_PROMPT_VERSION: z.string().default("archguard-rag-v1"),
  RAG_MAX_CONTEXT_CHARS: z.coerce.number().int().positive().default(20_000),
  DEBUG_RAG_PROMPTS: z.coerce.boolean().default(false),
  RAG_WRITE_EVAL_REPORT: z.coerce.boolean().default(false),
  RAG_VALIDATE_GOLDEN: z.coerce.boolean().default(false),
  SMOKE_FAIL_ON_FALLBACK: z.coerce.boolean().default(true),
  LLM_INPUT_COST_PER_1M_TOKENS: z.coerce.number().nonnegative().optional(),
  LLM_OUTPUT_COST_PER_1M_TOKENS: z.coerce.number().nonnegative().optional(),
  PUBLIC_WEBHOOK_URL: z.string().url().optional(),
  DEMO_REPO_URL: optionalUrl(),
  DEMO_DRIFT_PR_URL: optionalUrl(),
  DEMO_FIT_PR_URL: optionalUrl(),
  DEMO_ALLOWED_ORIGIN: emptyStringToUndefined(z.string().min(1).default("*")),
  TEST_GITHUB_OWNER: z.string().optional(),
  TEST_GITHUB_REPO: z.string().optional(),
  TEST_GITHUB_PR_NUMBER: z.coerce.number().int().positive().optional(),
  TEST_GITHUB_INSTALLATION_ID: z.coerce.number().int().positive().optional(),
  APP_VERSION: z.string().default("0.1.0"),
  GIT_SHA: z.string().default("unknown"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

function emptyStringToUndefined<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T, z.output<T>, unknown> {
  return z.preprocess((value) => {
    if (typeof value === "string" && value.trim().length === 0) {
      return undefined;
    }

    return value;
  }, schema);
}

function optionalUrl() {
  return emptyStringToUndefined(z.string().url().optional());
}
