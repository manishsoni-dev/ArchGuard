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
