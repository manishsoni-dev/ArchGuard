import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { analysisQueueName, type AnalysisJobPayload } from "./analysis-job.js";

export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null
  });
}

export function createAnalysisQueue(redisUrl: string): Queue<AnalysisJobPayload> {
  return new Queue<AnalysisJobPayload>(analysisQueueName, {
    connection: createRedisConnection(redisUrl)
  });
}
