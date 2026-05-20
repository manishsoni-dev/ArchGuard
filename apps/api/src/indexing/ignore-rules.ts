import path from "node:path";

const ignoredSegments = new Set([".git", "node_modules", "dist", "build", "coverage"]);
const ignoredFileNames = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "go.sum"
]);

export function shouldIgnorePath(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join("/");
  const segments = normalized.split("/");
  const fileName = segments.at(-1);

  if (segments.some((segment) => ignoredSegments.has(segment))) {
    return true;
  }

  return fileName ? ignoredFileNames.has(fileName) : false;
}
