import type { PrismaClient } from "@prisma/client";
import type { ContextRetriever, RetrievedContext } from "./types.js";

export interface Retriever extends ContextRetriever {
  retrieve(input: {
    tenantId: string;
    repositoryId: string;
    query?: string;
    queryText?: string;
    changedFiles?: string[];
    limit?: number;
    maxContextChars?: number;
  }): Promise<RetrievedContext[]>;
}

export class PostgresKeywordRetriever implements Retriever {
  constructor(private readonly prisma: PrismaClient) {}

  async retrieve(input: {
    tenantId: string;
    repositoryId: string;
    query?: string;
    queryText?: string;
    changedFiles?: string[];
    limit?: number;
    maxContextChars?: number;
  }): Promise<RetrievedContext[]> {
    const terms = tokenize(input.queryText ?? input.query ?? "");

    if (terms.length === 0) {
      return [];
    }

    const chunks = await this.prisma.codeChunk.findMany({
      where: {
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        OR: terms.slice(0, 8).map((term) => ({
          content: { contains: term, mode: "insensitive" }
        }))
      },
      take: input.limit ?? 8,
      orderBy: {
        updatedAt: "desc"
      }
    });

    return chunks.map((chunk) => ({
      chunkId: chunk.id,
      filePath: chunk.filePath,
      chunkType: chunk.chunkType,
      startLine: chunk.startLine ?? undefined,
      endLine: chunk.endLine ?? undefined,
      symbolName: chunk.symbolName ?? undefined,
      content: chunk.content,
      score: 0.5
    }));
  }
}

function tokenize(query: string): string[] {
  return Array.from(new Set(query.toLowerCase().match(/[a-z0-9_/-]{4,}/g) ?? []));
}
