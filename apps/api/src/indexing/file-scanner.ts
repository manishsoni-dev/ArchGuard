import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { shouldIgnorePath } from "./ignore-rules.js";

const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".cs",
  ".yml",
  ".yaml"
]);

export type ScannedSourceFile = {
  relativePath: string;
  content: string;
  sizeBytes: number;
  language?: string;
};

export async function scanSourceFiles(rootDir: string): Promise<ScannedSourceFile[]> {
  const files: ScannedSourceFile[] = [];
  await scanDirectory(rootDir, rootDir, files);
  return files;
}

async function scanDirectory(rootDir: string, currentDir: string, files: ScannedSourceFile[]): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath);

    if (shouldIgnorePath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await scanDirectory(rootDir, absolutePath, files);
      continue;
    }

    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) {
      continue;
    }

    const metadata = await stat(absolutePath);

    if (metadata.size > 512_000) {
      continue;
    }

    files.push({
      relativePath,
      content: await readFile(absolutePath, "utf8"),
      sizeBytes: metadata.size,
      language: inferLanguage(entry.name)
    });
  }
}

function inferLanguage(fileName: string): string | undefined {
  const extension = path.extname(fileName).replace(".", "");
  return extension || undefined;
}
