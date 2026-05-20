import type { Queue } from "bullmq";
import { analysisJobId, type AnalysisJobPayload } from "./analysis-job.js";

export interface AnalysisEnqueuer {
  enqueue(payload: AnalysisJobPayload): Promise<{ jobId: string }>;
}

export class BullMQAnalysisEnqueuer implements AnalysisEnqueuer {
  constructor(private readonly queue: Queue<AnalysisJobPayload>) {}

  async enqueue(payload: AnalysisJobPayload): Promise<{ jobId: string }> {
    const job = await this.queue.add("analyze-pr", payload, {
      jobId: analysisJobId(payload),
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2_000
      },
      removeOnComplete: {
        count: 100
      },
      removeOnFail: {
        count: 100
      }
    });

    return { jobId: String(job.id) };
  }
}
