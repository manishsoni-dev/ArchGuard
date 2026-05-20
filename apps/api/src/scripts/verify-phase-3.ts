import { fileURLToPath } from "node:url";
import { prisma } from "../db/prisma.js";
import { checkPgvector } from "../db/pgvector-check.js";
import { createFixtureRepository } from "./create-fixture-repo.js";
import { seedFixtureRepository } from "./seed-fixture-repository.js";
import { indexFixtureRepository, type FixtureIndexReport } from "./index-fixture-repo.js";
import { verifyFixtureRetrieval, type RetrievalReport } from "./verify-retrieval.js";
import { analyzeFixtureDiff } from "./analyze-fixture-diff.js";
import type { ArchitectureVerdict } from "../analysis/types.js";

export type Phase3AnalyzerChecks = {
  cleanChange?: ArchitectureVerdict;
  frontendDbViolation?: ArchitectureVerdict;
  emptyChange?: ArchitectureVerdict;
};

export type Phase3VerificationReport = {
  title: "ARCHGUARD PHASE 3 VERIFICATION";
  database: "ok" | "error";
  pgvectorExtension: "ok" | "error";
  fixtureRepo: "ok" | "error";
  architectureDocuments: number;
  adrChunks: number;
  codeChunks: number;
  embeddingsEmbedded: number;
  retrievalChecks: "passed" | "failed";
  analyzerChecks: Phase3AnalyzerChecks;
  overall: "PASSED" | "FAILED";
};

export async function verifyPhase3(): Promise<Phase3VerificationReport> {
  let fixtureRepo: "ok" | "error" = "ok";
  let indexReport: FixtureIndexReport = emptyIndexReport();
  let retrievalReports: RetrievalReport[] = [];
  const analyzerChecks: Phase3AnalyzerChecks = {};

  try {
    await createFixtureRepository();
    await seedFixtureRepository();
    indexReport = await indexFixtureRepository();
    retrievalReports = await verifyFixtureRetrieval();
    analyzerChecks.cleanChange = (
      await analyzeFixtureDiff({
        diffPath: "fixtures/pr-diffs/clean-frontend-change.diff",
        expectedVerdict: "FIT"
      })
    ).result.verdict;
    analyzerChecks.frontendDbViolation = (
      await analyzeFixtureDiff({
        diffPath: "fixtures/pr-diffs/frontend-db-violation.diff",
        expectedVerdict: "DRIFT_RISK"
      })
    ).result.verdict;
    analyzerChecks.emptyChange = (
      await analyzeFixtureDiff({
        diffPath: "fixtures/pr-diffs/empty-change.diff",
        expectedVerdict: "INSUFFICIENT_EVIDENCE"
      })
    ).result.verdict;
  } catch {
    fixtureRepo = "error";
  }

  const pgvector = await checkPgvector(prisma).catch(() => ({
    extension: "error" as const,
    column: "error" as const,
    similarityQuery: "error" as const
  }));
  const report = buildPhase3VerificationReport({
    database: pgvector.column === "ok" ? "ok" : "error",
    pgvectorExtension: pgvector.extension === "ok" && pgvector.similarityQuery === "ok" ? "ok" : "error",
    fixtureRepo,
    indexReport,
    retrievalReports,
    analyzerChecks
  });

  return report;
}

export function buildPhase3VerificationReport(input: {
  database: "ok" | "error";
  pgvectorExtension: "ok" | "error";
  fixtureRepo: "ok" | "error";
  indexReport: FixtureIndexReport;
  retrievalReports: RetrievalReport[];
  analyzerChecks: Phase3AnalyzerChecks;
}): Phase3VerificationReport {
  const retrievalPassed = input.retrievalReports.length > 0 && input.retrievalReports.every((report) => report.expectations.passed);
  const analyzerPassed =
    input.analyzerChecks.cleanChange === "FIT" &&
    input.analyzerChecks.frontendDbViolation === "DRIFT_RISK" &&
    input.analyzerChecks.emptyChange === "INSUFFICIENT_EVIDENCE";
  const overallPassed =
    input.database === "ok" &&
    input.pgvectorExtension === "ok" &&
    input.fixtureRepo === "ok" &&
    input.indexReport.architectureDocumentCount >= 2 &&
    input.indexReport.adrChunkCount > 0 &&
    input.indexReport.codeChunkCount > 0 &&
    input.indexReport.embeddingCounts.embedded > 0 &&
    retrievalPassed &&
    analyzerPassed;

  return {
    title: "ARCHGUARD PHASE 3 VERIFICATION",
    database: input.database,
    pgvectorExtension: input.pgvectorExtension,
    fixtureRepo: input.fixtureRepo,
    architectureDocuments: input.indexReport.architectureDocumentCount,
    adrChunks: input.indexReport.adrChunkCount,
    codeChunks: input.indexReport.codeChunkCount,
    embeddingsEmbedded: input.indexReport.embeddingCounts.embedded,
    retrievalChecks: retrievalPassed ? "passed" : "failed",
    analyzerChecks: input.analyzerChecks,
    overall: overallPassed ? "PASSED" : "FAILED"
  };
}

function emptyIndexReport(): FixtureIndexReport {
  return {
    indexedFileCount: 0,
    codeChunkCount: 0,
    adrChunkCount: 0,
    embeddingCounts: {
      pending: 0,
      embedded: 0,
      failed: 0
    },
    architectureDocumentCount: 0
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void verifyPhase3()
    .then((report) => {
      console.log(formatPhase3Report(report));
      if (report.overall !== "PASSED") {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

function formatPhase3Report(report: Phase3VerificationReport): string {
  return [
    report.title,
    "",
    `Database: ${report.database}`,
    `pgvector extension: ${report.pgvectorExtension}`,
    `Fixture repo: ${report.fixtureRepo}`,
    `Architecture documents: ${report.architectureDocuments}`,
    `ADR chunks: ${report.adrChunks}`,
    `Code chunks: ${report.codeChunks}`,
    `Embeddings embedded: ${report.embeddingsEmbedded}`,
    `Retrieval checks: ${report.retrievalChecks}`,
    "Analyzer checks:",
    `- clean change: ${report.analyzerChecks.cleanChange ?? "not run"}`,
    `- frontend db violation: ${report.analyzerChecks.frontendDbViolation ?? "not run"}`,
    `- empty change: ${report.analyzerChecks.emptyChange ?? "not run"}`,
    "",
    `Overall: ${report.overall}`
  ].join("\n");
}
