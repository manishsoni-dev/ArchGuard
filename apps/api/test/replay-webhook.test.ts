import { describe, expect, it } from "vitest";
import { parseReplayWebhookArgs } from "../src/scripts/replay-webhook.js";

describe("replay webhook script", () => {
  it("validates required file argument", () => {
    expect(() => parseReplayWebhookArgs([])).toThrow(
      "Usage: pnpm replay:webhook -- ./sample-payloads/pull-request-opened.json"
    );
  });
});
