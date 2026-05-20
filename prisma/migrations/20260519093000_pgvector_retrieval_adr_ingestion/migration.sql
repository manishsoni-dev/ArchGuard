-- Enable pgvector for semantic retrieval.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "ChunkType" AS ENUM ('CODE', 'TEST', 'CONFIG', 'DOC', 'ADR');

-- CreateEnum
CREATE TYPE "EmbeddingStatus" AS ENUM ('PENDING', 'EMBEDDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ArchitectureDocumentType" AS ENUM ('ADR', 'README', 'DESIGN_DOC', 'OTHER');

-- AlterTable: IndexedFile
ALTER TABLE "IndexedFile" RENAME COLUMN "path" TO "filePath";
ALTER TABLE "IndexedFile" RENAME COLUMN "indexedAt" TO "lastIndexedAt";
ALTER TABLE "IndexedFile" ADD COLUMN "fileType" TEXT NOT NULL DEFAULT 'CODE';

-- Rename old unique index to match the new Prisma field names.
ALTER INDEX "IndexedFile_repositoryId_path_key" RENAME TO "IndexedFile_repositoryId_filePath_key";

-- AlterTable: CodeChunk
ALTER TABLE "CodeChunk" ADD COLUMN "chunkType" "ChunkType" NOT NULL DEFAULT 'CODE';
ALTER TABLE "CodeChunk" ADD COLUMN "filePath" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CodeChunk" ADD COLUMN "symbolName" TEXT;
ALTER TABLE "CodeChunk" ADD COLUMN "embeddingStatus" "EmbeddingStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "CodeChunk" ADD COLUMN "embeddingModel" TEXT;
ALTER TABLE "CodeChunk" ADD COLUMN "embeddingVector" vector(1536);
ALTER TABLE "CodeChunk" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "CodeChunk"
SET "filePath" = "IndexedFile"."filePath"
FROM "IndexedFile"
WHERE "CodeChunk"."indexedFileId" = "IndexedFile"."id";

UPDATE "CodeChunk"
SET "embeddingStatus" = CASE
  WHEN "embedding" IS NULL THEN 'PENDING'::"EmbeddingStatus"
  ELSE 'EMBEDDED'::"EmbeddingStatus"
END;

ALTER TABLE "CodeChunk" ALTER COLUMN "startLine" DROP NOT NULL;
ALTER TABLE "CodeChunk" ALTER COLUMN "endLine" DROP NOT NULL;

-- CreateTable: ArchitectureDocument
CREATE TABLE "ArchitectureDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "documentType" "ArchitectureDocumentType" NOT NULL,
    "title" TEXT,
    "filePath" TEXT NOT NULL,
    "status" TEXT,
    "contentHash" TEXT NOT NULL,
    "lastIndexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchitectureDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodeChunk_repositoryId_chunkType_idx" ON "CodeChunk"("repositoryId", "chunkType");

-- CreateIndex
CREATE INDEX "CodeChunk_repositoryId_filePath_idx" ON "CodeChunk"("repositoryId", "filePath");

-- CreateIndex
CREATE INDEX "CodeChunk_embeddingStatus_idx" ON "CodeChunk"("embeddingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ArchitectureDocument_repositoryId_filePath_key" ON "ArchitectureDocument"("repositoryId", "filePath");

-- CreateIndex
CREATE INDEX "ArchitectureDocument_tenantId_idx" ON "ArchitectureDocument"("tenantId");

-- CreateIndex
CREATE INDEX "ArchitectureDocument_repositoryId_idx" ON "ArchitectureDocument"("repositoryId");

-- CreateIndex
CREATE INDEX "ArchitectureDocument_repositoryId_documentType_idx" ON "ArchitectureDocument"("repositoryId", "documentType");

-- CreateIndex for vector search. Kept broad for MVP; tune lists/probes with production data.
CREATE INDEX "CodeChunk_embeddingVector_ivfflat_idx"
ON "CodeChunk"
USING ivfflat ("embeddingVector" vector_cosine_ops)
WITH (lists = 100);

-- AddForeignKey
ALTER TABLE "ArchitectureDocument" ADD CONSTRAINT "ArchitectureDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchitectureDocument" ADD CONSTRAINT "ArchitectureDocument_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
