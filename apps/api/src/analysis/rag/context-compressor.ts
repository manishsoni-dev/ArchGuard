import type { AnalyzePullRequestInput, RetrievedContextRecord } from "../analyzer.js";
import { formatEvidenceBlock } from "./evidence-formatter.js";

export type CompressedContext = {
  records: RetrievedContextRecord[];
  formatted: string;
  summary: string;
};

export function compressRetrievedContext(input: {
  context: RetrievedContextRecord[];
  changedFiles: string[];
  diff: string;
  maxContextChars: number;
}): CompressedContext {
  const ordered = orderContext(input.context, input.changedFiles, input.diff);
  const records: RetrievedContextRecord[] = [];
  const blocks: string[] = [];
  let chars = 0;

  for (const record of ordered) {
    const block = formatEvidenceBlock(record);
    if (chars + block.length > input.maxContextChars && records.length > 0) {
      break;
    }

    records.push(record);
    blocks.push(block);
    chars += block.length;

    if (chars >= input.maxContextChars) {
      break;
    }
  }

  return {
    records,
    formatted: blocks.join("\n\n"),
    summary: summarizeCompressedContext(records)
  };
}

export function summarizeCompressedContext(context: Pick<RetrievedContextRecord, "filePath" | "chunkType">[]): string {
  const adrCount = context.filter((record) => record.chunkType === "ADR").length;
  const codeCount = context.filter((record) => record.chunkType === "CODE" || record.chunkType === "TEST").length;
  const topFilePaths = Array.from(new Set(context.map((record) => record.filePath))).slice(0, 6);

  return [
    `Retrieved ${context.length} chunk${context.length === 1 ? "" : "s"}`,
    `${adrCount} ADR`,
    `${codeCount} code/test`,
    `top files: ${topFilePaths.length ? topFilePaths.join(", ") : "none"}`
  ].join("; ");
}

function orderContext(
  context: RetrievedContextRecord[],
  changedFiles: string[],
  diff: string
): RetrievedContextRecord[] {
  const changedFileSet = new Set(changedFiles);
  const policyChange = isArchitecturePolicyDiff(diff);

  return [...context].sort((left, right) => {
    const leftScore = contextPriority(left, changedFileSet, policyChange);
    const rightScore = contextPriority(right, changedFileSet, policyChange);
    return rightScore - leftScore;
  });
}

function contextPriority(record: RetrievedContextRecord, changedFiles: Set<string>, policyChange: boolean): number {
  let score = record.score ?? 0;

  if (record.chunkType === "ADR") {
    score += policyChange ? 4 : 2;
  }

  if (changedFiles.has(record.filePath)) {
    score += 3;
  }

  if (record.chunkType === "CODE" || record.chunkType === "TEST") {
    score += 1;
  }

  return score;
}

function isArchitecturePolicyDiff(diff: AnalyzePullRequestInput["diff"]): boolean {
  return /import|boundary|layer|architecture|service|repository|db|database/i.test(diff);
}

