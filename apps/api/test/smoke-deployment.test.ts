import { describe, expect, it, vi } from "vitest";
import { CliArgumentError } from "../src/scripts/cli-args.js";
import { parseSmokeDeploymentArgs, smokeDeployment } from "../src/scripts/smoke-deployment.js";

describe("smoke deployment", () => {
  it("parses baseUrl argument", () => {
    expect(parseSmokeDeploymentArgs(["baseUrl=https://archguard.test.app"])).toEqual({
      baseUrl: "https://archguard.test.app"
    });
    expect(parseSmokeDeploymentArgs(["--baseUrl=https://archguard.test.app"])).toEqual({
      baseUrl: "https://archguard.test.app"
    });
  });

  it("returns friendly placeholder error for baseUrl", () => {
    try {
      parseSmokeDeploymentArgs(["baseUrl=THE_REAL_API_URL"]);
      throw new Error("expected parse to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CliArgumentError);
      const report = (error as CliArgumentError).report;
      expect(report.problems).toEqual([
        {
          field: "baseUrl",
          message: "baseUrl must be a real https:// URL, not placeholder text."
        }
      ]);
      expect(JSON.stringify(report)).not.toContain("ZodError");
    }
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
    expect(report.details.health).toMatchObject({
      url: "https://archguard.example.com/health",
      statusCode: 200,
      errorMessage: null
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

  it("reports status code and body preview safely", async () => {
    const html = "<html><body>Application failed to respond on Railway</body></html>";
    const fetchMock = vi.fn(async (_url: string) => new Response(html, { status: 502 }));
    const report = await smokeDeployment(
      { baseUrl: "https://archguard.example.com" },
      { fetch: fetchMock as unknown as typeof fetch }
    );

    expect(report.status).toBe("error");
    expect(report.checks.health).toBe("error");
    expect(report.details.health).toMatchObject({
      statusCode: 502,
      bodyPreview: html,
      looksLikeRailwayError: true,
      looksLikeHtml: true
    });
  });
});
