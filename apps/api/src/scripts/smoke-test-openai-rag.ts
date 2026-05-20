import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Env } from "../env.js";
import { loadEnv } from "../env.js";
import {
  evaluateRag,
  loadRagEvalCases,
  type RagEvalCase,
  type RagEvalReport
} from "./evaluate-rag.js";

const smokeEnvSchema = z.object({
  ANALYZER_PROVIDER: z.literal("rag"),
  LLM_PROVIDER: z.literal("openai"),
  OPENAI_API_KEY: z.string().min(1)
});

export function validateOpenAIRagSmokeEnv(env: Env): void {
  smokeEnvSchema.parse({
    ANALYZER_PROVIDER: env.ANALYZER_PROVIDER,
    LLM_PROVIDER: env.LLM_PROVIDER,
    OPENAI_API_KEY: env.OPENAI_API_KEY
  });
}

export async function smokeTestOpenAIRag(options: {
  env?: Env;
  cases?: RagEvalCase[];
  failOnFallback?: boolean;
  runEvaluation?: () => Promise<RagEvalReport>;
} = {}): Promise<RagEvalReport> {
  const env = options.env ?? loadEnv();
  validateOpenAIRagSmokeEnv(env);
  const cases = options.cases ?? (await defaultSmokeCases());
  const report = options.runEvaluation
    ? await options.runEvaluation()
    : await evaluateRag({
        cases,
        env,
        writeReport: env.RAG_WRITE_EVAL_REPORT,
        writeTraces: env.DEBUG_RAG_PROMPTS,
        validateGoldenFixtures: env.RAG_VALIDATE_GOLDEN
      });
  const failOnFallback = options.failOnFallback ?? env.SMOKE_FAIL_ON_FALLBACK;

  if (failOnFallback && report.cases.some((testCase) => testCase.fallbackUsed)) {
    const cases = report.cases.map((testCase) =>
      testCase.fallbackUsed ? { ...testCase, passed: false } : testCase
    );
    const passedCases = cases.filter((testCase) => testCase.passed).length;
    return {
      ...report,
      cases,
      passed: false,
      passedCases,
      failedCases: cases.length - passedCases
    };
  }

  return report;
}

async function defaultSmokeCases(): Promise<RagEvalCase[]> {
  const cases = await loadRagEvalCases();
  return cases.filter((testCase) =>
    ["frontend importing db", "clean frontend display change"].includes(testCase.name)
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void smokeTestOpenAIRag()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.passed) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
