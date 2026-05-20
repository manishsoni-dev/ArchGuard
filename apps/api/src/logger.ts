import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "GITHUB_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
      "GITHUB_CLIENT_SECRET",
      "*.token",
      "*.privateKey",
      "*.rawBody",
      "*.diff"
    ],
    censor: "[redacted]"
  }
});

export type AppLogger = typeof logger;
