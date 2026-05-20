import type { RetrievedContextRecord } from "../analyzer.js";

export function formatEvidenceBlock(record: RetrievedContextRecord, maxContentChars = 1_500): string {
  const kind = record.chunkType ?? "CODE";
  const location = lineRange(record);
  const preview = truncate(record.content.replace(/\s+$/g, ""), maxContentChars);
  const symbol = record.symbolName ? `\nSymbol: ${record.symbolName}` : "";

  return [
    `[${kind}] ${record.filePath}${location}`,
    `${symbol ? symbol : ""}`,
    "Relevant excerpt:",
    preview || "(empty)"
  ]
    .filter(Boolean)
    .join("\n");
}

function lineRange(record: RetrievedContextRecord): string {
  if (!record.startLine) {
    return "";
  }

  return `:${record.startLine}${record.endLine ? `-${record.endLine}` : ""}`;
}

function truncate(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, Math.max(0, maxChars - 24))}\n... [truncated]`;
}

