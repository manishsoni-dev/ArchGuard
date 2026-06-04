import { describe, expect, it, vi } from "vitest";
import { CliArgumentError } from "../src/scripts/cli-args.js";
import { demoCheck, parseDemoCheckArgs } from "../src/scripts/demo-check.js";

describe("demo check", () => {
  it("parses api and optional web URLs", () => {
    expect(parseDemoCheckArgs(["apiUrl=https://api.example.app"])).toEqual({
      apiUrl: "https://api.example.app"
    });
    expect(parseDemoCheckArgs(["--apiUrl=https://api.example.app", "--webUrl=https://web.example.app"])).toEqual({
      apiUrl: "https://api.example.app",
      webUrl: "https://web.example.app"
    });
  });

  it("returns friendly placeholder errors", () => {
    try {
      parseDemoCheckArgs(["apiUrl=https://YOUR-REPLIT-API-URL"]);
      throw new Error("expected parse to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CliArgumentError);
      const report = (error as CliArgumentError).report;
      expect(report.problems).toEqual([
        {
          field: "apiUrl",
          message: "apiUrl must be a real https:// URL, not placeholder text."
        }
      ]);
      expect(JSON.stringify(report)).not.toContain("ZodError");
    }
  });

  it("checks the live demo API endpoints with mocked fetch", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response("{}", { status: 200 }));
    const report = await demoCheck(
      { apiUrl: "https://api.example.app", webUrl: "https://web.example.app" },
      { fetch: fetchMock as unknown as typeof fetch }
    );

    expect(report.status).toBe("ok");
    expect(report.checks).toEqual({
      apiHealth: "ok",
      apiReady: "ok",
      apiVersion: "ok",
      demoStatus: "ok",
      demoProof: "ok",
      web: "ok"
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.app/health");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.app/ready");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.app/version");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.app/demo/status");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.app/demo/proof");
    expect(fetchMock).toHaveBeenCalledWith("https://web.example.app");
  });

  it("keeps web optional without failing the API check", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response("{}", { status: 200 }));
    const report = await demoCheck({ apiUrl: "https://api.example.app" }, { fetch: fetchMock as unknown as typeof fetch });

    expect(report.status).toBe("ok");
    expect(report.checks.web).toBe("not_checked");
  });

  it("reports API errors and web warnings separately", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response("{}", { status: url.endsWith("/ready") ? 503 : 200 }));
    const report = await demoCheck(
      { apiUrl: "https://api.example.app", webUrl: "https://web.example.app" },
      { fetch: fetchMock as unknown as typeof fetch }
    );

    expect(report.status).toBe("error");
    expect(report.checks.apiReady).toBe("error");
    expect(report.nextSteps).toContain("Inspect https://api.example.app/ready for database, Redis, or env readiness errors.");
  });
});
