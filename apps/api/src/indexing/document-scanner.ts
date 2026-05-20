import path from "node:path";
import type { ScannedSourceFile } from "./file-scanner.js";

const adrDirectories = new Set([
  "docs/adr",
  "docs/adrs",
  "adr",
  "adrs",
  "architecture",
  "docs/architecture"
]);

export type ArchitectureDocumentCandidate = {
  filePath: string;
  documentType: "ADR" | "README" | "DESIGN_DOC" | "OTHER";
  content: string;
};

export function detectArchitectureDocuments(files: ScannedSourceFile[]): ArchitectureDocumentCandidate[] {
  return files
    .filter((file) => isMarkdown(file.relativePath))
    .map((file) => ({
      filePath: file.relativePath,
      documentType: classifyDocument(file.relativePath),
      content: file.content
    }))
    .filter((document) => document.documentType !== "OTHER" || isArchitectureAdjacent(document.filePath));
}

export function isAdrPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const directory = path.posix.dirname(normalized);
  return Array.from(adrDirectories).some((adrDirectory) => directory === adrDirectory || directory.startsWith(`${adrDirectory}/`));
}

function classifyDocument(filePath: string): ArchitectureDocumentCandidate["documentType"] {
  const normalized = normalizePath(filePath);
  const basename = path.posix.basename(normalized).toLowerCase();

  if (isAdrPath(normalized)) {
    return "ADR";
  }

  if (basename === "readme.md") {
    return "README";
  }

  if (normalized.includes("design") || normalized.includes("architecture")) {
    return "DESIGN_DOC";
  }

  return "OTHER";
}

function isArchitectureAdjacent(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return normalized.includes("architecture") || normalized.includes("design");
}

function isMarkdown(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".md";
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/").replace(/^\.?\//, "");
}
