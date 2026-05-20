import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AnalyzerRunOutput, ArchitectureAnalyzer } from "../analysis/analyzer.js";
import { analyzeWithMetadata } from "../analysis/analyzer.js";
import { createArchitectureAnalyzer } from "../analysis/analyzer-service.js";
import { estimateRagTokens, type TokenCostConfig, type TokenEstimate } from "../analysis/rag/token-estimator.js";
import type { ArchitectureVerdict } from "../analysis/types.js";
import { prisma } from "../db/prisma.js";
import type { Env } from "../env.js";
import { loadEnv } from "../env.js";
import { createEmbeddingService, embeddingConfigFromEnv } from "../embeddings/embedding-service.js";
import { logger } from "../logger.js";
import { HybridRetriever } from "../retrieval/hybrid-retriever.js";
import { VectorRetriever } from "../retrieval/vector-retriever.js";
import type { ContextRetriever, RetrievedContext } from "../retrieval/types.js";
import { createFixtureRepository } from "./create-fixture-repo.js";
import { extractChangedFiles } from "./fixture/diff-fixtures.js";
import { workspaceRoot } from "./fixture/constants.js";
import { indexFixtureRepository } from "./index-fixture-repo.js";
import { seedFixtureRepository } from "./seed-fixture-repository.js";

const architectureVerdictSchema = z.enum(["FIT", "DRIFT_RISK", "INSUFFICIENT_EVIDENCE"]);

const evalCaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  expectedVerdict: architectureVerdictSchema,
  changedFiles: z.array(z.string()).optional(),
  diff: z.string().min(1),
  golden: z.string().min(1).optional()
});

const evalCasesSchema = z.array(evalCaseSchema).min(1);

const goldenSchema = z.object({
  expectedVerdict: architectureVerdictSchema,
  mustMentionFiles: z.array(z.string()).default([]),
  mustHaveFindingSeverity: z.enum(["LOW", "MEDIUM", "HIGH"]).optional()
});

export type RagEvalCase = z.infer<typeof evalCaseSchema>;
export type RagGoldenFixture = z.infer<typeof goldenSchema>;

export type GoldenValidationResult = {
  passed: boolean;
  failures: string[];
};

export type ConfidenceBucketSummary = {
  total: number;
  passed: number;
};

export type RagEvalCaseReport = {
  name: string;
  description: string;
  expectedVerdict: ArchitectureVerdict;
  actualVerdict: ArchitectureVerdict;
  passed: boolean;
  confidence: number;
  latencyMs: number;
  fallbackUsed: boolean;
  topEvidenceFiles: string[];
  tokenEstimate: TokenEstimate;
  golden?: GoldenValidationResult;
};

export type RagEvalReport = {
  runId: string;
  timestamp: string;
  analyzerProvider: string;
  llmProvider: string;
  modelName?: string;
  promptVersion?: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  averageLatencyMs: number;
  confidenceBuckets: Record<"0.0-0.5" | "0.5-0.8" | "0.8-1.0", ConfidenceBucketSummary>;
  cases: RagEvalCaseReport[];
  passed: boolean;
  reportPath?: string;
};

export async function loadRagEvalCases(filePath = "fixtures/evals/architecture-drift-cases.json"): Promise<RagEvalCase[]> {
  const content = await readFile(path.resolve(workspaceRoot(), filePath), "utf8");
  return evalCasesSchema.parse(JSON.parse(content));
}

export async function loadGoldenFixture(name: string): Promise<RagGoldenFixture> {
  const content = await readFile(path.resolve(workspaceRoot(), "fixtures/evals/golden", `${name}.json`), "utf8");
  return goldenSchema.parse(JSON.parse(content));
}

export function compareVerdict(expectedVerdict: ArchitectureVerdict, actualVerdict: ArchitectureVerdict): boolean {
  return expectedVerdict === actualVerdict;
}

export function validateGolden(input: {
  golden: RagGoldenFixture;
  actualVerdict: ArchitectureVerdict;
  evidenceFiles: string[];
  severities: string[];
}): GoldenValidationResult {
  const failures: string[] = [];

  if (input.actualVerdict !== input.golden.expectedVerdict) {
    failures.push(`expected verdict ${input.golden.expectedVerdict} but got ${input.actualVerdict}`);
  }

  for (const filePath of input.golden.mustMentionFiles) {
    if (!input.evidenceFiles.includes(filePath)) {
      failures.push(`expected evidence to mention ${filePath}`);
    }
  }

  if (input.golden.mustHaveFindingSeverity && !input.severities.includes(input.golden.mustHaveFindingSeverity)) {
    failures.push(`expected finding severity ${input.golden.mustHaveFindingSeverity}`);
  }

  return {
    passed: failures.length === 0,
    failures
  };
}

export function buildRagEvalReport(input: {
  runId?: string;
  timestamp?: string;
  analyzerProvider: string;
  llmProvider: string;
  modelName?: string;
  promptVersion?: string;
  cases: RagEvalCaseReport[];
}): RagEvalReport {
  const passedCases = input.cases.filter((testCase) => testCase.passed).length;
  const totalLatency = input.cases.reduce((sum, testCase) => sum + testCase.latencyMs, 0);

  return {
    runId: input.runId ?? randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    analyzerProvider: input.analyzerProvider,
    llmProvider: input.llmProvider,
    modelName: input.modelName,
    promptVersion: input.promptVersion,
    totalCases: input.cases.length,
    passedCases,
    failedCases: input.cases.length - passedCases,
    averageLatencyMs: input.cases.length ? Math.round(totalLatency / input.cases.length) : 0,
    confidenceBuckets: confidenceBuckets(input.cases),
    cases: input.cases,
    passed: passedCases === input.cases.length
  };
}

export function shouldWriteRagTraces(env: Pick<Env, "DEBUG_RAG_PROMPTS">, override?: boolean): boolean {
  return override ?? env.DEBUG_RAG_PROMPTS;
}

export async function evaluateRag(options: {
  cases?: RagEvalCase[];
  analyzer?: ArchitectureAnalyzer;
  retriever?: ContextRetriever;
  skipIndex?: boolean;
  seed?: {
    tenantId: string;
    repositoryId: string;
    fullName: string;
  };
  skipFixtureSetup?: boolean;
  writeReport?: boolean;
  writeTraces?: boolean;
  validateGoldenFixtures?: boolean;
  reportRoot?: string;
  env?: Env;
} = {}): Promise<RagEvalReport> {
  const env = options.env ?? loadEnv();
  const runId = randomUUID();
  const timestamp = new Date().toISOString();
  if (!options.skipFixtureSetup && !options.seed) {
    await createFixtureRepository();
  }
  const seed = options.seed ?? (await seedFixtureRepository());

  if (!options.skipIndex && !options.seed) {
    await indexFixtureRepository();
  }

  const retriever =
    options.retriever ??
    new HybridRetriever(
      prisma,
      new VectorRetriever(prisma, createEmbeddingService(embeddingConfigFromEnv(env))),
      logger
    );
  const analyzer = options.analyzer ?? createArchitectureAnalyzer(env, logger);
  const cases = options.cases ?? (await loadRagEvalCases());
  const reports: RagEvalCaseReport[] = [];
  const reportRoot = options.reportRoot ?? path.resolve(workspaceRoot(), ".reports");
  const writeTraces = shouldWriteRagTraces(env, options.writeTraces);

  for (const testCase of cases) {
    const startedAt = Date.now();
    const changedFiles = testCase.changedFiles ?? extractChangedFiles(testCase.diff);
    const retrievedContext = await retriever.retrieve({
      tenantId: seed.tenantId,
      repositoryId: seed.repositoryId,
      queryText: testCase.diff,
      changedFiles,
      limit: env.RETRIEVAL_TOP_K,
      maxContextChars: env.RETRIEVAL_MAX_CONTEXT_CHARS
    });
    const analysis = await analyzeWithMetadata(analyzer, {
      repositoryFullName: seed.fullName,
      pullRequestNumber: 1,
      diff: testCase.diff,
      changedFiles,
      retrievedContext
    });
    const latencyMs = analysis.metadata.analysisLatencyMs ?? Date.now() - startedAt;
    const evidenceFiles = evidenceFilePaths(analysis, retrievedContext);
    const topEvidenceFiles = evidenceFiles.slice(0, 5);
    const tokenEstimate = estimateTokens(analysis, testCase.diff, retrievedContext, env);
    const shouldValidateGolden = options.validateGoldenFixtures ?? env.RAG_VALIDATE_GOLDEN;
    const golden = shouldValidateGolden
      ? await validateCaseGolden(testCase, analysis, evidenceFiles)
      : undefined;
    const passed = compareVerdict(testCase.expectedVerdict, analysis.result.verdict) && (golden?.passed ?? true);

    reports.push({
      name: testCase.name,
      description: testCase.description,
      expectedVerdict: testCase.expectedVerdict,
      actualVerdict: analysis.result.verdict,
      passed,
      confidence: analysis.result.confidence,
      latencyMs,
      fallbackUsed: analysis.metadata.fallbackUsed ?? false,
      topEvidenceFiles,
      tokenEstimate,
      golden
    });

    if (writeTraces) {
      await writeTraceFiles({
        reportRoot,
        runId,
        caseName: testCase.name,
        analysis,
        retrievedContext
      });
    }
  }

  const report = buildRagEvalReport({
    runId,
    timestamp,
    analyzerProvider: analyzer.providerName ?? "mock",
    llmProvider: env.LLM_PROVIDER,
    modelName: reports.find(Boolean) ? analyzer.modelName ?? env.LLM_MODEL : env.LLM_MODEL,
    promptVersion: analyzer.promptVersion ?? env.RAG_PROMPT_VERSION,
    cases: reports
  });

  if (options.writeReport ?? env.RAG_WRITE_EVAL_REPORT) {
    report.reportPath = await writeEvalReport(report, reportRoot);
  }

  return report;
}

async function validateCaseGolden(
  testCase: RagEvalCase,
  analysis: AnalyzerRunOutput,
  evidenceFiles: string[]
): Promise<GoldenValidationResult | undefined> {
  if (!testCase.golden) {
    return undefined;
  }

  const golden = await loadGoldenFixture(testCase.golden);
  return validateGolden({
    golden,
    actualVerdict: analysis.result.verdict,
    evidenceFiles,
    severities: analysis.result.findings.map((finding) => finding.severity)
  });
}

function evidenceFilePaths(analysis: AnalyzerRunOutput, retrievedContext: RetrievedContext[]): string[] {
  return Array.from(
    new Set([
      ...analysis.result.findings.flatMap((finding) => (finding.filePath ? [finding.filePath] : [])),
      ...(analysis.trace?.retrievedContext ?? retrievedContext).map((chunk) => chunk.filePath)
    ])
  );
}

function estimateTokens(
  analysis: AnalyzerRunOutput,
  diff: string,
  retrievedContext: RetrievedContext[],
  env: Env
): TokenEstimate {
  const promptChars = analysis.trace?.prompt
    ? analysis.trace.prompt.system.length + analysis.trace.prompt.user.length
    : diff.length + retrievedContext.reduce((sum, chunk) => sum + chunk.content.length, 0);
  const outputChars = analysis.trace?.rawLlmOutput?.length ?? JSON.stringify(analysis.result).length;

  return estimateRagTokens({
    inputChars: promptChars,
    outputChars,
    costConfig: costConfigFromEnv(env)
  });
}

function costConfigFromEnv(env: Env): TokenCostConfig {
  return {
    inputCostPer1MTokens: env.LLM_INPUT_COST_PER_1M_TOKENS,
    outputCostPer1MTokens: env.LLM_OUTPUT_COST_PER_1M_TOKENS
  };
}

export async function writeEvalReport(report: RagEvalReport, reportRoot: string): Promise<string> {
  const directory = path.join(reportRoot, "rag-evals");
  await mkdir(directory, { recursive: true });
  const reportPath = path.join(directory, `rag-eval-${timestampForFile(report.timestamp)}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

export async function writeTraceFiles(input: {
  reportRoot: string;
  runId: string;
  caseName: string;
  analysis: AnalyzerRunOutput;
  retrievedContext: RetrievedContext[];
}): Promise<void> {
  const directory = path.join(input.reportRoot, "rag-traces", input.runId, slugify(input.caseName));
  await mkdir(directory, { recursive: true });
  const prompt = input.analysis.trace?.prompt;

  if (prompt) {
    await writeFile(path.join(directory, "prompt.txt"), redactSecrets(`${prompt.system}\n\n${prompt.user}`), "utf8");
  }

  if (input.analysis.trace?.rawLlmOutput) {
    const extension = input.analysis.trace.rawLlmOutput.trim().startsWith("{") ? "json" : "txt";
    await writeFile(
      path.join(directory, `raw-llm-output.${extension}`),
      redactSecrets(input.analysis.trace.rawLlmOutput),
      "utf8"
    );
  }

  await writeFile(
    path.join(directory, "parsed-result.json"),
    `${JSON.stringify(input.analysis.result, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(directory, "retrieved-context.json"),
    `${JSON.stringify(input.analysis.trace?.retrievedContext ?? input.retrievedContext, null, 2)}\n`,
    "utf8"
  );
}

function confidenceBuckets(cases: RagEvalCaseReport[]): RagEvalReport["confidenceBuckets"] {
  const buckets: RagEvalReport["confidenceBuckets"] = {
    "0.0-0.5": { total: 0, passed: 0 },
    "0.5-0.8": { total: 0, passed: 0 },
    "0.8-1.0": { total: 0, passed: 0 }
  };

  for (const testCase of cases) {
    const key = testCase.confidence < 0.5 ? "0.0-0.5" : testCase.confidence < 0.8 ? "0.5-0.8" : "0.8-1.0";
    buckets[key].total += 1;
    buckets[key].passed += testCase.passed ? 1 : 0;
  }

  return buckets;
}

function timestampForFile(timestamp: string): string {
  return timestamp.replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function redactSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-openai-key]")
    .replace(/OPENAI_API_KEY\s*=\s*\S+/g, "OPENAI_API_KEY=[redacted]");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void evaluateRag()
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
