import { fileURLToPath } from "node:url";
import { prisma } from "../db/prisma.js";

export async function listRecentAnalysisRuns(limit = 10) {
  return prisma.analysisRun.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      verdict: true,
      confidence: true,
      headSha: true,
      githubCheckRunId: true,
      analyzerProvider: true,
      modelName: true,
      fallbackUsed: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      repository: {
        select: {
          fullName: true
        }
      },
      pullRequest: {
        select: {
          number: true,
          title: true
        }
      },
      findings: {
        select: {
          title: true,
          severity: true,
          filePath: true
        }
      }
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void listRecentAnalysisRuns()
    .then((analysisRuns) => {
      console.log(JSON.stringify({ analysisRuns }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
