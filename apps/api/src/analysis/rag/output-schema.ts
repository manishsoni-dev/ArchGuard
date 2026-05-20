import { z } from "zod";
import type { ArchitectureAnalysisResult } from "../types.js";

export const ragArchitectureFindingSchema = z.object({
  title: z.string().min(1).max(120),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  filePath: z.string().min(1).optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  evidence: z.array(z.string().min(1).max(220)).min(1).max(5),
  recommendation: z.string().min(8).max(300)
});

export const ragArchitectureAnalysisResultSchema = z
  .object({
    verdict: z.enum(["FIT", "DRIFT_RISK", "INSUFFICIENT_EVIDENCE"]),
    confidence: z.number().min(0).max(1),
    summary: z.string().min(1).max(800),
    findings: z.array(ragArchitectureFindingSchema).max(10),
    retrievedContextSummary: z.string().min(1).max(800)
  })
  .superRefine((result, context) => {
    if (result.verdict === "DRIFT_RISK" && result.findings.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["findings"],
        message: "DRIFT_RISK must include at least one finding"
      });
    }

    if (result.verdict === "INSUFFICIENT_EVIDENCE" && !/insufficient|missing|not enough|unable/i.test(result.summary)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "INSUFFICIENT_EVIDENCE must explain what evidence is missing"
      });
    }
  });

export function parseRagAnalysisJson(content: string): ArchitectureAnalysisResult {
  const parsed = JSON.parse(content) as unknown;
  return ragArchitectureAnalysisResultSchema.parse(parsed);
}

