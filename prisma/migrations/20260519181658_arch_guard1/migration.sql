-- DropIndex
DROP INDEX "CodeChunk_embeddingVector_ivfflat_idx";

-- AlterTable
ALTER TABLE "CodeChunk" ALTER COLUMN "filePath" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "IndexedFile" ALTER COLUMN "fileType" DROP DEFAULT;
