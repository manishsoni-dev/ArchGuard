import type { PrismaClient } from "@prisma/client";

export type PgvectorCheckResult = {
  extension: "ok" | "error";
  column: "ok" | "error";
  similarityQuery: "ok" | "error";
};

export async function checkPgvector(prisma: PrismaClient, dimensions = 1536): Promise<PgvectorCheckResult> {
  return {
    extension: await checkExtension(prisma),
    column: await checkColumn(prisma),
    similarityQuery: await checkSimilarityQuery(prisma, dimensions)
  };
}

export function buildPgvectorSimilaritySmokeSql(dimensions = 1536): string {
  const zeroVector = `[${Array.from({ length: dimensions }, () => "0").join(",")}]`;
  return `SELECT ${quoteLiteral(zeroVector)}::vector <=> ${quoteLiteral(zeroVector)}::vector AS distance`;
}

async function checkExtension(prisma: PrismaClient): Promise<"ok" | "error"> {
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS "exists"
    `;
    return rows[0]?.exists ? "ok" : "error";
  } catch {
    return "error";
  }
}

async function checkColumn(prisma: PrismaClient): Promise<"ok" | "error"> {
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'CodeChunk' AND column_name = 'embeddingVector'
      ) AS "exists"
    `;
    return rows[0]?.exists ? "ok" : "error";
  } catch {
    return "error";
  }
}

async function checkSimilarityQuery(prisma: PrismaClient, dimensions: number): Promise<"ok" | "error"> {
  try {
    await prisma.$queryRawUnsafe(buildPgvectorSimilaritySmokeSql(dimensions));
    return "ok";
  } catch {
    return "error";
  }
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
