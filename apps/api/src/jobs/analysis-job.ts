import { z } from "zod";

export const analysisQueueName = "archguard-analysis";

export const analysisJobPayloadSchema = z.object({
  tenantId: z.string().min(1),
  repositoryId: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  installationId: z.number().int().positive(),
  pullRequestNumber: z.number().int().positive(),
  headSha: z.string().min(1),
  webhookEventId: z.string().min(1)
});

export type AnalysisJobPayload = z.infer<typeof analysisJobPayloadSchema>;

export function parseAnalysisJobPayload(value: unknown): AnalysisJobPayload {
  return analysisJobPayloadSchema.parse(value);
}

export function analysisJobId(payload: AnalysisJobPayload): string {
  return `${payload.repositoryId}:${payload.pullRequestNumber}:${payload.headSha}`;
}
