import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PrismaClient } from "@prisma/client";
import { scanSourceFiles, type ScannedSourceFile } from "./file-scanner.js";
import { chunkByLanguage, inferChunkType } from "./language-chunker.js";
import { detectArchitectureDocuments } from "./document-scanner.js";
import { parseAdrMarkdown } from "./adr-parser.js";
import type { EmbeddingService } from "../embeddings/embedding-service.js";
import type { AppLogger } from "../logger.js";

const execFileAsync = promisify(execFile);

export type IndexRepositoryInput = {
  tenantId: string;
  repositoryId: string;
  cloneUrl: string;
  fullName: string;
  authToken?: string;
  localPath?: string;
};

export type ExistingIndexedFile = {
  filePath: string;
  contentHash: string;
};

export type IndexingPlan = {
  unchanged: string[];
  changed: ScannedSourceFile[];
  deleted: string[];
};

export class RepositoryIndexer {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly embeddings: EmbeddingService,
    private readonly logger: AppLogger,
    private readonly cacheDir = path.join(process.cwd(), ".archguard", "repos")
  ) {}

  async indexRepository(input: IndexRepositoryInput): Promise<void> {
    const localPath = input.localPath ?? path.join(this.cacheDir, sanitizeRepositoryName(input.fullName));

    if (!input.localPath) {
      await mkdir(this.cacheDir, { recursive: true });
      await cloneOrPullRepository(input.cloneUrl, localPath, input.authToken);
    }

    const files = await scanSourceFiles(localPath);
    const existing = await this.prisma.indexedFile.findMany({
      where: {
        tenantId: input.tenantId,
        repositoryId: input.repositoryId
      },
      select: {
        filePath: true,
        contentHash: true
      }
    });
    const plan = planIndexingChanges(existing, files);

    await this.deleteStaleFiles(input, plan.deleted);

    for (const file of plan.changed) {
      await this.rebuildFile(input, file);
    }

    await this.indexArchitectureDocuments(input, files);
    await this.embedPendingChunks(input);

    this.logger.info(
      {
        tenantId: input.tenantId,
        repositoryFullName: input.fullName,
        repositoryId: input.repositoryId,
        changedFiles: plan.changed.length,
        unchangedFiles: plan.unchanged.length,
        deletedFiles: plan.deleted.length
      },
      "Repository indexing completed"
    );
  }

  private async rebuildFile(input: IndexRepositoryInput, file: ScannedSourceFile): Promise<void> {
    const contentHash = hash(file.content);
    const indexedFile = await this.prisma.indexedFile.upsert({
      where: {
        repositoryId_filePath: {
          repositoryId: input.repositoryId,
          filePath: file.relativePath
        }
      },
      create: {
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        filePath: file.relativePath,
        fileType: inferChunkType(file.relativePath),
        contentHash,
        language: file.language,
        sizeBytes: file.sizeBytes
      },
      update: {
        fileType: inferChunkType(file.relativePath),
        contentHash,
        language: file.language,
        sizeBytes: file.sizeBytes,
        lastIndexedAt: new Date()
      }
    });

    await this.prisma.codeChunk.deleteMany({
      where: {
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        indexedFileId: indexedFile.id
      }
    });

    const chunks = chunkByLanguage({
      filePath: file.relativePath,
      content: file.content
    });

    for (const chunk of chunks) {
      await this.prisma.codeChunk.create({
        data: {
          tenantId: input.tenantId,
          repositoryId: input.repositoryId,
          indexedFileId: indexedFile.id,
          ordinal: chunk.ordinal,
          chunkType: chunk.chunkType,
          filePath: chunk.filePath,
          symbolName: chunk.symbolName,
          content: chunk.content,
          contentHash: hash(chunk.content),
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          embeddingStatus: "PENDING"
        }
      });
    }
  }

  private async indexArchitectureDocuments(input: IndexRepositoryInput, files: ScannedSourceFile[]): Promise<void> {
    const documents = detectArchitectureDocuments(files);

    for (const document of documents) {
      const parsed = document.documentType === "ADR" ? parseAdrMarkdown(document.content) : undefined;
      await this.prisma.architectureDocument.upsert({
        where: {
          repositoryId_filePath: {
            repositoryId: input.repositoryId,
            filePath: document.filePath
          }
        },
        create: {
          tenantId: input.tenantId,
          repositoryId: input.repositoryId,
          documentType: document.documentType,
          title: parsed?.title,
          status: parsed?.status,
          filePath: document.filePath,
          contentHash: hash(document.content)
        },
        update: {
          documentType: document.documentType,
          title: parsed?.title,
          status: parsed?.status,
          contentHash: hash(document.content),
          lastIndexedAt: new Date()
        }
      });
    }
  }

  private async deleteStaleFiles(input: IndexRepositoryInput, deletedFilePaths: string[]): Promise<void> {
    if (deletedFilePaths.length === 0) {
      return;
    }

    await this.prisma.indexedFile.deleteMany({
      where: {
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        filePath: { in: deletedFilePaths }
      }
    });

    await this.prisma.architectureDocument.deleteMany({
      where: {
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        filePath: { in: deletedFilePaths }
      }
    });
  }

  private async embedPendingChunks(input: IndexRepositoryInput): Promise<void> {
    const pendingChunks = await this.prisma.codeChunk.findMany({
      where: {
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        embeddingStatus: "PENDING"
      },
      select: {
        id: true,
        content: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    for (let index = 0; index < pendingChunks.length; index += this.embeddings.batchSize) {
      const batch = pendingChunks.slice(index, index + this.embeddings.batchSize);

      try {
        const embeddings = await this.embeddings.embedBatch(batch.map((chunk) => ({ id: chunk.id, text: chunk.content })));

        for (const [batchIndex, chunk] of batch.entries()) {
          const embedding = embeddings[batchIndex];
          if (!embedding) {
            await this.markEmbeddingFailed(chunk.id, "Missing embedding result");
            continue;
          }

          await this.storeEmbedding(chunk.id, embedding.embedding, embedding.model);
        }
      } catch (error) {
        this.logger.error(
          {
            tenantId: input.tenantId,
            repositoryId: input.repositoryId,
            err: error
          },
          "Embedding batch failed during repository indexing"
        );

        for (const chunk of batch) {
          await this.markEmbeddingFailed(chunk.id, error instanceof Error ? error.message : "Embedding failed");
        }
      }
    }
  }

  private async storeEmbedding(chunkId: string, embedding: number[], model: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "CodeChunk"
      SET
        "embedding" = ${JSON.stringify(embedding)}::jsonb,
        "embeddingVector" = ${vectorLiteral(embedding)}::vector,
        "embeddingStatus" = 'EMBEDDED'::"EmbeddingStatus",
        "embeddingModel" = ${model},
        "updatedAt" = NOW()
      WHERE "id" = ${chunkId}
    `;
  }

  private async markEmbeddingFailed(chunkId: string, reason: string): Promise<void> {
    await this.prisma.codeChunk.update({
      where: { id: chunkId },
      data: {
        embeddingStatus: "FAILED",
        embeddingModel: this.embeddings.provider.model,
        embedding: { error: reason }
      }
    });
  }
}

export function planIndexingChanges(existingFiles: ExistingIndexedFile[], scannedFiles: ScannedSourceFile[]): IndexingPlan {
  const existingByPath = new Map(existingFiles.map((file) => [file.filePath, file.contentHash]));
  const scannedByPath = new Set(scannedFiles.map((file) => file.relativePath));

  return {
    unchanged: scannedFiles
      .filter((file) => existingByPath.get(file.relativePath) === hash(file.content))
      .map((file) => file.relativePath),
    changed: scannedFiles.filter((file) => existingByPath.get(file.relativePath) !== hash(file.content)),
    deleted: existingFiles.filter((file) => !scannedByPath.has(file.filePath)).map((file) => file.filePath)
  };
}

async function cloneOrPullRepository(cloneUrl: string, localPath: string, authToken?: string): Promise<void> {
  const cloneUrlWithAuth = authToken ? addTokenToGitHubUrl(cloneUrl, authToken) : cloneUrl;

  try {
    await execFileAsync("git", ["-C", localPath, "pull", "--ff-only"], { timeout: 120_000 });
  } catch {
    await execFileAsync("git", ["clone", "--depth", "1", cloneUrlWithAuth, localPath], { timeout: 240_000 });
  }
}

function addTokenToGitHubUrl(cloneUrl: string, token: string): string {
  const url = new URL(cloneUrl);
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}

function sanitizeRepositoryName(fullName: string): string {
  return fullName.replace(/[^a-z0-9_.-]/gi, "__");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.map((value) => Number(value).toFixed(6)).join(",")}]`;
}
