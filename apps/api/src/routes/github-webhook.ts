import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { verifyGithubWebhookSignature } from "../github/verify-signature.js";
import type { AnalysisEnqueuer } from "../jobs/enqueue-analysis.js";
import type { AppLogger } from "../logger.js";
import type { WebhookEventStore } from "../db/webhook-events.js";
import { handleGitHubWebhook } from "./github-webhook-handler.js";

const requiredHeadersSchema = z.object({
  "x-github-event": z.string().min(1),
  "x-github-delivery": z.string().min(1),
  "x-hub-signature-256": z.string().min(1)
});

export type RegisterGitHubWebhookRouteOptions = {
  webhookSecret: string;
  devWebhookToken?: string;
  nodeEnv: string;
  eventStore: WebhookEventStore;
  enqueuer: AnalysisEnqueuer;
  logger: AppLogger;
};

export async function registerGitHubWebhookRoute(
  fastify: FastifyInstance,
  options: RegisterGitHubWebhookRouteOptions
): Promise<void> {
  fastify.post("/webhooks/github", async (request, reply) => {
    const rawBody = getRawBody(request);
    const headers = parseRequiredHeaders(request);

    if (!headers.success) {
      return reply.code(400).send({ error: "missing_required_github_headers" });
    }

    const isValidSignature = verifyGithubWebhookSignature({
      rawBody,
      signatureHeader: headers.data["x-hub-signature-256"],
      secret: options.webhookSecret
    });

    if (!isValidSignature) {
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const result = await handleGitHubWebhook(
      {
        githubDeliveryId: headers.data["x-github-delivery"],
        eventName: headers.data["x-github-event"],
        payload: request.body
      },
      options
    );

    return reply.code(result.statusCode).send(result.body);
  });

  if (options.nodeEnv !== "production") {
    fastify.post("/dev/github-webhook-debug", async (request, reply) => {
      const devTokenHeader = headerValue(request.headers["x-archguard-dev-token"]);

      if (!options.devWebhookToken || devTokenHeader !== options.devWebhookToken) {
        return reply.code(401).send({ error: "invalid_dev_webhook_token" });
      }

      const eventName = headerValue(request.headers["x-github-event"]) ?? "pull_request";
      const githubDeliveryId =
        headerValue(request.headers["x-github-delivery"]) ?? `dev-${Date.now()}-${randomUUID()}`;

      const result = await handleGitHubWebhook(
        {
          githubDeliveryId,
          eventName,
          payload: request.body
        },
        options
      );

      return reply.code(result.statusCode).send(result.body);
    });
  }
}

function parseRequiredHeaders(request: FastifyRequest) {
  return requiredHeadersSchema.safeParse({
    "x-github-event": headerValue(request.headers["x-github-event"]),
    "x-github-delivery": headerValue(request.headers["x-github-delivery"]),
    "x-hub-signature-256": headerValue(request.headers["x-hub-signature-256"])
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getRawBody(request: FastifyRequest): string | Buffer {
  const requestWithRawBody = request as FastifyRequest & { rawBody?: string | Buffer };

  if (requestWithRawBody.rawBody) {
    return requestWithRawBody.rawBody;
  }

  if (typeof request.body === "string" || Buffer.isBuffer(request.body)) {
    return request.body;
  }

  return JSON.stringify(request.body ?? {});
}
