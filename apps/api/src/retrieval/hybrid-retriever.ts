import type { PrismaClient } from "@prisma/client";
import type { AppLogger } from "../logger.js";
import type { ChunkType } from "../indexing/language-chunker.js";
import type { ContextRetriever, RetrievedContext, RetrievalQuery, RetrievalRankingReason } from "./types.js";

type QueryIntent = {
  terms: string[];
  isArchitecturePolicy: boolean;
  isCodeIntent: boolean;
};

export class HybridRetriever implements ContextRetriever {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly vectorRetriever: ContextRetriever,
    private readonly logger: AppLogger
  ) {}

  async retrieve(input: RetrievalQuery): Promise<RetrievedContext[]> {
    const limit = input.limit ?? 12;
    const maxContextChars = input.maxContextChars ?? 20_000;
    const intent = classifyQuery(input.queryText);
    const results: RetrievedContext[] = [];

    results.push(...(await this.retrieveChangedFileContext(input)));
    results.push(...(await this.retrieveAdrContext(input, intent, Math.max(2, Math.ceil(limit / 4)))));

    try {
      results.push(...(await this.vectorRetriever.retrieve({ ...input, limit })));
    } catch (error) {
      this.logger.error(
        { tenantId: input.tenantId, repositoryId: input.repositoryId, err: error },
        "Vector retrieval failed; falling back to keyword retrieval"
      );
    }

    results.push(...(await this.keywordFallback(input, intent)));

    return capContext(rankAndDedupe(results, intent), limit, maxContextChars);
  }

  private async retrieveChangedFileContext(input: RetrievalQuery): Promise<RetrievedContext[]> {
    if (!input.changedFiles?.length) {
      return [];
    }

    const chunks = await this.prisma.codeChunk.findMany({
      where: {
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        filePath: { in: input.changedFiles }
      },
      take: input.limit ?? 12,
      orderBy: [{ chunkType: "asc" }, { ordinal: "asc" }]
    });

    return chunks.map((chunk) => toRetrievedContext(chunk, 1.4, ["changed-file"]));
  }

  private async retrieveAdrContext(input: RetrievalQuery, intent: QueryIntent, limit: number): Promise<RetrievedContext[]> {
    const take = intent.isArchitecturePolicy ? Math.max(limit, 4) : Math.min(limit, 2);
    const chunks = await this.prisma.codeChunk.findMany({
      where: {
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        chunkType: "ADR"
      },
      take,
      orderBy: {
        updatedAt: "desc"
      }
    });

    return chunks.map((chunk) => toRetrievedContext(chunk, intent.isArchitecturePolicy ? 1.05 : 0.45, ["adr-keyword"]));
  }

  private async keywordFallback(input: RetrievalQuery, intent: QueryIntent): Promise<RetrievedContext[]> {
    const terms = intent.terms;

    if (terms.length === 0) {
      return [];
    }

    const termFilters = terms.slice(0, 10).flatMap((term) => [
      { content: { contains: term, mode: "insensitive" as const } },
      { filePath: { contains: term, mode: "insensitive" as const } },
      { symbolName: { contains: term, mode: "insensitive" as const } }
    ]);
    const chunks = await this.prisma.codeChunk.findMany({
      where: {
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        OR: termFilters
      },
      take: Math.max(input.limit ?? 12, 24),
      orderBy: {
        updatedAt: "desc"
      }
    });

    return chunks.map((chunk) => {
      const pathScore = scorePathMatch(input.queryText, chunk.filePath);
      const symbolScore = chunk.symbolName ? scoreTextTerms(intent.terms, chunk.symbolName) : 0;
      const reasons: RetrievalRankingReason[] = pathScore > 0 || symbolScore > 0 ? ["path-keyword"] : ["fallback-keyword"];
      return toRetrievedContext(chunk, 0.5 + pathScore + symbolScore * 0.15, reasons);
    });
  }
}

function toRetrievedContext(chunk: {
  id: string;
  filePath: string;
  chunkType: string;
  startLine: number | null;
  endLine: number | null;
  symbolName: string | null;
  content: string;
}, score: number, rankingReasons: RetrievalRankingReason[] = []): RetrievedContext {
  return {
    chunkId: chunk.id,
    filePath: chunk.filePath,
    chunkType: chunk.chunkType as ChunkType,
    startLine: chunk.startLine ?? undefined,
    endLine: chunk.endLine ?? undefined,
    symbolName: chunk.symbolName ?? undefined,
    content: chunk.content,
    score,
    rankingReasons
  };
}

function rankAndDedupe(results: RetrievedContext[], intent: QueryIntent): RetrievedContext[] {
  const byChunkId = new Map<string, RetrievedContext>();

  for (const result of results) {
    const boosted = {
      ...result,
      score: rankScore(result, intent)
    };
    const existing = byChunkId.get(result.chunkId);

    if (!existing) {
      byChunkId.set(result.chunkId, boosted);
      continue;
    }

    byChunkId.set(result.chunkId, {
      ...existing,
      score: Math.max(existing.score, boosted.score),
      rankingReasons: mergeReasons(existing.rankingReasons, boosted.rankingReasons)
    });
  }

  return Array.from(byChunkId.values()).sort((left, right) => right.score - left.score);
}

function capContext(results: RetrievedContext[], limit: number, maxContextChars: number): RetrievedContext[] {
  const capped: RetrievedContext[] = [];
  let chars = 0;

  for (const result of results) {
    if (capped.length >= limit || chars + result.content.length > maxContextChars) {
      break;
    }
    capped.push(result);
    chars += result.content.length;
  }

  return capped;
}

function rankScore(result: RetrievedContext, intent: QueryIntent): number {
  let score = result.score;
  score += scorePathMatch(intent.terms.join(" "), result.filePath);
  score += scoreTextTerms(intent.terms, result.symbolName ?? "") * 0.15;

  if (intent.isCodeIntent && result.chunkType !== "ADR" && result.chunkType !== "DOC") {
    score += 0.35;
  }

  if (intent.isCodeIntent && result.chunkType === "ADR" && !intent.isArchitecturePolicy) {
    score -= 0.35;
  }

  if (intent.isArchitecturePolicy && result.chunkType === "ADR") {
    score += 1.3;
  }

  if (containsAny(intent.terms, ["repository"]) && containsAny(intent.terms, ["database", "db"])) {
    score += pathStartsWithAny(result.filePath, ["src/backend/db", "backend/db", "db"]) ? 1.6 : 0;
  }

  if (containsAny(intent.terms, ["service"])) {
    score += pathStartsWithAny(result.filePath, ["src/backend/services", "backend/services", "services"]) ? 1.1 : 0;
  }

  if (containsAny(intent.terms, ["frontend", "component", "ui"])) {
    score += pathStartsWithAny(result.filePath, ["src/frontend", "frontend", "ui"]) ? 1.1 : 0;
  }

  return score;
}

export function classifyQuery(query: string): QueryIntent {
  const terms = tokenizeQuery(query);
  const lower = query.toLowerCase();
  const isArchitecturePolicy =
    containsAny(terms, ["architecture", "boundary", "boundaries", "layer", "layers", "violation", "adr"]) ||
    lower.includes("must not") ||
    lower.includes("not import");
  const isCodeIntent = containsAny(terms, [
    "repository",
    "service",
    "client",
    "db",
    "database",
    "access",
    "function",
    "class",
    "component",
    "frontend",
    "ui"
  ]);

  return { terms, isArchitecturePolicy, isCodeIntent };
}

export function tokenizeQuery(query: string): string[] {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const expanded = terms.flatMap((term) => (term === "database" ? [term, "db"] : [term]));
  return Array.from(new Set(expanded));
}

export function tokenizeFilePath(filePath: string): string[] {
  const withCamelBoundaries = filePath.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const normalized = withCamelBoundaries.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return Array.from(new Set(normalized.split(/\s+/).filter((token) => token.length >= 2)));
}

export function scorePathMatch(query: string, filePath: string): number {
  const terms = tokenizeQuery(query);
  const pathTokens = tokenizeFilePath(filePath);
  const matchedTerms = terms.filter((term) => pathTokens.includes(term));
  const directMatches = terms.filter((term) => filePath.toLowerCase().includes(term));

  if (terms.length === 0) {
    return 0;
  }

  return matchedTerms.length * 0.45 + directMatches.length * 0.2;
}

function scoreTextTerms(terms: string[], text: string): number {
  const normalized = text.toLowerCase();
  return terms.filter((term) => normalized.includes(term)).length;
}

function containsAny(terms: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => terms.includes(candidate));
}

function pathStartsWithAny(filePath: string, prefixes: string[]): boolean {
  const normalized = filePath.toLowerCase();
  return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function mergeReasons(
  left: RetrievalRankingReason[] = [],
  right: RetrievalRankingReason[] = []
): RetrievalRankingReason[] {
  return Array.from(new Set([...left, ...right]));
}
