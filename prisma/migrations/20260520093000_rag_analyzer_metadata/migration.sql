-- Add RAG analyzer observability metadata to analysis runs.
ALTER TABLE "AnalysisRun" ADD COLUMN "analyzerProvider" TEXT;
ALTER TABLE "AnalysisRun" ADD COLUMN "promptVersion" TEXT;
ALTER TABLE "AnalysisRun" ADD COLUMN "modelName" TEXT;
ALTER TABLE "AnalysisRun" ADD COLUMN "analysisLatencyMs" INTEGER;
ALTER TABLE "AnalysisRun" ADD COLUMN "fallbackUsed" BOOLEAN NOT NULL DEFAULT false;

