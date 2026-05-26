import { describe, expect, it, vi } from "vitest";
import { parseSmokeDeploymentArgs, smokeDeployment } from "../src/scripts/smoke-deployment.js";

describe("smoke deployment", () => {
  it("parses baseUrl argument", () => {
    expect(parseSmokeDeploymentArgs(["baseUrl=https://archguard.example.com"])).toEqual({
      baseUrl: "https://archguard.example.com"
    });
    expect(parseSmokeDeploymentArgs(["--baseUrl=https://archguard.example.com"])).toEqual({
      baseUrl: "https://archguard.example.com"
    });
  });

  it("checks health readiness and https shape", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response("{}", { status: 200 }));
    const report = await smokeDeployment(
      { baseUrl: "https://archguard.example.com" },
      { fetch: fetchMock as unknown as typeof fetch }
    );

    expect(report.status).toBe("ok");
    expect(report.checks).toEqual({
      health: "ok",
      ready: "ok",
      https: "ok",
      webhookUrl: "ok",
      version: "ok"
    });
    expect(fetchMock).toHaveBeenCalledWith("https://archguard.example.com/health");
    expect(fetchMock).toHaveBeenCalledWith("https://archguard.example.com/ready");
  });

  it("reports non-https deployment URL", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response("{}", { status: 200 }));
    const report = await smokeDeployment(
      { baseUrl: "http://archguard.example.com" },
      { fetch: fetchMock as unknown as typeof fetch }
    );

    expect(report.status).toBe("error");
    expect(report.checks.https).toBe("error");
  });
});
