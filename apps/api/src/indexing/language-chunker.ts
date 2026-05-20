import path from "node:path";
import { isAdrPath } from "./document-scanner.js";

export type ChunkType = "CODE" | "TEST" | "CONFIG" | "DOC" | "ADR";

export type LanguageChunk = {
  ordinal: number;
  chunkType: ChunkType;
  filePath: string;
  symbolName?: string;
  startLine?: number;
  endLine?: number;
  content: string;
};

type SymbolMatch = {
  lineIndex: number;
  symbolName: string;
};

export function chunkByLanguage(input: {
  filePath: string;
  content: string;
  linesPerChunk?: number;
}): LanguageChunk[] {
  const extension = path.extname(input.filePath).toLowerCase();
  const chunkType = inferChunkType(input.filePath);

  if (extension === ".md") {
    return markdownChunks(input.filePath, input.content, chunkType);
  }

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    return symbolChunks(input.filePath, input.content, chunkType, findTypeScriptSymbols(input.content), input.linesPerChunk);
  }

  if (extension === ".py") {
    return symbolChunks(input.filePath, input.content, chunkType, findPythonSymbols(input.content), input.linesPerChunk);
  }

  return lineWindowChunks(input.filePath, input.content, chunkType, input.linesPerChunk);
}

export function inferChunkType(filePath: string): ChunkType {
  const normalized = filePath.toLowerCase();

  if (isAdrPath(filePath)) {
    return "ADR";
  }

  if (normalized.endsWith(".md")) {
    return "DOC";
  }

  if (/(^|\/)(__tests__|test|tests|spec)\//.test(normalized) || /\.(test|spec)\.[a-z]+$/.test(normalized)) {
    return "TEST";
  }

  if (/\.(json|ya?ml|toml|ini|env|config\.[jt]s)$/.test(normalized)) {
    return "CONFIG";
  }

  return "CODE";
}

function symbolChunks(
  filePath: string,
  content: string,
  chunkType: ChunkType,
  matches: SymbolMatch[],
  linesPerChunk = 80
): LanguageChunk[] {
  if (matches.length === 0) {
    return lineWindowChunks(filePath, content, chunkType, linesPerChunk);
  }

  const lines = content.split("\n");
  return matches.map((match, index) => {
    const next = matches[index + 1];
    const endIndex = next ? next.lineIndex - 1 : lines.length - 1;
    return {
      ordinal: index,
      chunkType,
      filePath,
      symbolName: match.symbolName,
      startLine: match.lineIndex + 1,
      endLine: endIndex + 1,
      content: lines.slice(match.lineIndex, endIndex + 1).join("\n").trim()
    };
  }).filter((chunk) => chunk.content.length > 0);
}

function findTypeScriptSymbols(content: string): SymbolMatch[] {
  return content
    .split("\n")
    .flatMap((line, lineIndex) => {
      const match = line.match(/^\s*export\s+(?:async\s+)?(?:function|class|interface|type|const)\s+([A-Za-z0-9_$]+)/);
      return match?.[1] ? [{ lineIndex, symbolName: match[1] }] : [];
    });
}

function findPythonSymbols(content: string): SymbolMatch[] {
  return content
    .split("\n")
    .flatMap((line, lineIndex) => {
      const match = line.match(/^\s*(?:async\s+def|def|class)\s+([A-Za-z0-9_]+)/);
      return match?.[1] ? [{ lineIndex, symbolName: match[1] }] : [];
    });
}

function markdownChunks(filePath: string, content: string, chunkType: ChunkType): LanguageChunk[] {
  const lines = content.split("\n");
  const headings = lines.flatMap((line, lineIndex) => {
    const match = line.match(/^(#{1,4})\s+(.+)$/);
    return match?.[2] ? [{ lineIndex, symbolName: match[2].trim() }] : [];
  });

  if (headings.length === 0) {
    return lineWindowChunks(filePath, content, chunkType, 80);
  }

  return symbolChunks(filePath, content, chunkType, headings, 80);
}

function lineWindowChunks(filePath: string, content: string, chunkType: ChunkType, linesPerChunk = 80): LanguageChunk[] {
  const lines = content.split("\n");
  const chunks: LanguageChunk[] = [];

  for (let index = 0; index < lines.length; index += linesPerChunk) {
    const chunkLines = lines.slice(index, index + linesPerChunk);
    const chunkContent = chunkLines.join("\n").trim();

    if (!chunkContent) {
      continue;
    }

    chunks.push({
      ordinal: chunks.length,
      chunkType,
      filePath,
      startLine: index + 1,
      endLine: index + chunkLines.length,
      content: chunkContent
    });
  }

  return chunks;
}
