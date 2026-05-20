export type CodeChunkRecord = {
  ordinal: number;
  content: string;
  startLine: number;
  endLine: number;
};

export function chunkFile(content: string, linesPerChunk = 80): CodeChunkRecord[] {
  const lines = content.split("\n");
  const chunks: CodeChunkRecord[] = [];

  for (let index = 0; index < lines.length; index += linesPerChunk) {
    const chunkLines = lines.slice(index, index + linesPerChunk);
    const content = chunkLines.join("\n").trim();

    if (!content) {
      continue;
    }

    chunks.push({
      ordinal: chunks.length,
      content,
      startLine: index + 1,
      endLine: index + chunkLines.length
    });
  }

  return chunks;
}
