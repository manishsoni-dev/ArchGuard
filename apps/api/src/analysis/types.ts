import { z } from "zod";

export type ArchitectureVerdict = "FIT" | "DRIFT_RISK" | "INSUFFICIENT_EVIDENCE";

export type Severity = "LOW" | "MEDIUM" | "HIGH";

export type ArchitectureFinding = {
  title: string;
  severity: Severity;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  evidence: string[];
  recommendation: string;
};

export type ArchitectureAnalysisResult = {
  verdict: ArchitectureVerdict;
  confidence: number;
  summary: string;
  findings: ArchitectureFinding[];
  retrievedContextSummary: string;
};

export const architectureVerdictSchema = z.enum(["FIT", "DRIFT_RISK", "INSUFFICIENT_EVIDENCE"]);
export const severitySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const architectureFindingSchema = z.object({
  title: z.string().min(1),
  severity: severitySchema,
  filePath: z.string().optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  evidence: z.array(z.string()),
  recommendation: z.string().min(1)
});

export const architectureAnalysisResultSchema = z.object({
  verdict: architectureVerdictSchema,
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1),
  findings: z.array(architectureFindingSchema),
  retrievedContextSummary: z.string().min(1)
});

export function parseArchitectureAnalysisResult(value: unknown): ArchitectureAnalysisResult {
  return architectureAnalysisResultSchema.parse(value);
}
