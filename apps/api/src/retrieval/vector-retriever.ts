import type { PrismaClient } from "@prisma/client";
import type { EmbeddingService } from "../embeddings/embedding-service.js";
import type { ChunkType } from "../indexing/language-chunker.js";
import type { ContextRetriever, RetrievedContext, RetrievalQuery } from "./types.js";

type VectorRow = {
  chunkId: string;
  filePath: string;
  chunkType: ChunkType;
  startLine: number | null;
  endLine: number | null;
  symbolName: string | null;
  content: string;
  score: number;
};

export class VectorRetriever implements ContextRetriever {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly embeddings: EmbeddingService
  ) {}

  async retrieve(input: RetrievalQuery): Promise<RetrievedContext[]> {
    const embedding = await this.embeddings.embed(input.queryText);
    const rows = await this.prisma.$queryRaw<VectorRow[]>`
      SELECT
        "id" AS "chunkId",
        "filePath",
        "chunkType",
        "startLine",
        "endLine",
        "symbolName",
        "content",
        1 - ("embeddingVector" <=> ${vectorLiteral(embedding.embedding)}::vector) AS "score"
      FROM "CodeChunk"
      WHERE
        "tenantId" = ${input.tenantId}
        AND "repositoryId" = ${input.repositoryId}
        AND "embeddingStatus" = 'EMBEDDED'::"EmbeddingStatus"
        AND "embeddingVector" IS NOT NULL
        AND (${input.chunkTypes?.length ? input.chunkTypes : null}::"ChunkType"[] IS NULL OR "chunkType" = ANY(${input.chunkTypes?.length ? input.chunkTypes : null}::"ChunkType"[]))
      ORDER BY "embeddingVector" <=> ${vectorLiteral(embedding.embedding)}::vector
      LIMIT ${input.limit ?? 12}
    `;

    return rows.map(toRetrievedContext);
  }
}

export function buildVectorSearchSqlPreview(input: {
  includeChunkTypes: boolean;
}): string {
  return [
    'SELECT "id" AS "chunkId", "filePath", "chunkType", "content"',
    'FROM "CodeChunk"',
    'WHERE "tenantId" = $tenantId AND "repositoryId" = $repositoryId',
    'AND "embeddingStatus" = \'EMBEDDED\'::"EmbeddingStatus"',
    'AND "embeddingVector" IS NOT NULL',
    input.includeChunkTypes ? 'AND "chunkType" = ANY($chunkTypes::"ChunkType"[])' : "",
    'ORDER BY "embeddingVector" <=> $queryEmbedding::vector',
    "LIMIT $limit"
  ]
    .filter(Boolean)
    .join("\n");
}

function toRetrievedContext(row: VectorRow): RetrievedContext {
  return {
    chunkId: row.chunkId,
    filePath: row.filePath,
    chunkType: row.chunkType,
    startLine: row.startLine ?? undefined,
    endLine: row.endLine ?? undefined,
    symbolName: row.symbolName ?? undefined,
    content: row.content,
    score: Number(row.score),
    rankingReasons: ["vector"]
  };
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.map((value) => Number(value).toFixed(6)).join(",")}]`;
}
