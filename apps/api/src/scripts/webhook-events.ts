import { fileURLToPath } from "node:url";
import { prisma } from "../db/prisma.js";

export async function listRecentWebhookEvents(limit = 10) {
  return prisma.webhookEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take: limit,
    select: {
      id: true,
      githubDeliveryId: true,
      eventName: true,
      action: true,
      repositoryFullName: true,
      pullRequestNumber: true,
      status: true,
      receivedAt: true,
      processedAt: true
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void listRecentWebhookEvents()
    .then((events) => {
      console.log(JSON.stringify({ events }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
