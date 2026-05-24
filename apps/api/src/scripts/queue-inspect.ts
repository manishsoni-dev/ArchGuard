import { fileURLToPath } from "node:url";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { loadEnv } from "../env.js";
import { analysisQueueName } from "../jobs/analysis-job.js";

export async function inspectQueue() {
  const env = loadEnv();
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(analysisQueueName, { connection });

  try {
    const [counts, waiting, active, failed, completed] = await Promise.all([
      queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
      queue.getJobs(["waiting"], 0, 5),
      queue.getJobs(["active"], 0, 5),
      queue.getJobs(["failed"], 0, 5),
      queue.getJobs(["completed"], 0, 5)
    ]);

    return {
      queueName: analysisQueueName,
      counts,
      jobs: {
        waiting: waiting.map(formatJob),
        active: active.map(formatJob),
        failed: failed.map(formatJob),
        completed: completed.map(formatJob)
      }
    };
  } finally {
    await queue.close();
    connection.disconnect();
  }
}

function formatJob(job: Awaited<ReturnType<Queue["getJobs"]>>[number]) {
  return {
    id: job.id,
    name: job.name,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    data: job.data
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void inspectQueue()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
