import type { ChunkType } from "../indexing/language-chunker.js";

export type RetrievalQuery = {
  tenantId: string;
  repositoryId: string;
  queryText: string;
  changedFiles?: string[];
  limit?: number;
  chunkTypes?: ChunkType[];
  maxContextChars?: number;
};

export type RetrievedContext = {
  chunkId: string;
  filePath: string;
  chunkType: ChunkType;
  startLine?: number;
  endLine?: number;
  symbolName?: string;
  content: string;
  score: number;
  rankingReasons?: RetrievalRankingReason[];
};

export interface ContextRetriever {
  retrieve(input: RetrievalQuery): Promise<RetrievedContext[]>;
}

export type RetrievalRankingReason =
  | "vector"
  | "adr-keyword"
  | "path-keyword"
  | "changed-file"
  | "fallback-keyword";
