import { describe, expect, it, vi } from "vitest";
import { CliArgumentError } from "../src/scripts/cli-args.js";
import { checkRailwayDomain, parseRailwayDomainCheckArgs } from "../src/scripts/railway-domain-check.js";

describe("railway domain check", () => {
  it("parses baseUrl argument", () => {
    expect(parseRailwayDomainCheckArgs(["baseUrl=https://archguard-production.up.railway.app"])).toEqual({
      baseUrl: "https://archguard-production.up.railway.app"
    });
    expect(parseRailwayDomainCheckArgs(["--baseUrl=https://archguard-production.up.railway.app"])).toEqual({
      baseUrl: "https://archguard-production.up.railway.app"
    });
  });

  it("returns friendly placeholder error for baseUrl", () => {
    try {
      parseRailwayDomainCheckArgs(["baseUrl=THE_REAL_API_SERVICE_URL"]);
      throw new Error("expected parse to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CliArgumentError);
      const report = (error as CliArgumentError).report;
      expect(report).toMatchObject({
        status: "error",
        message: "Invalid command arguments.",
        problems: [{ field: "baseUrl", message: "baseUrl must be a real https:// URL, not placeholder text." }]
      });
      expect(JSON.stringify(report)).not.toContain("ZodError");
    }
  });

  it("detects Railway Application not found as domain not attached", async () => {
    const originalFetch = globalThis.fetch;
    const body = JSON.stringify({ status: "error", code: 404, message: "Application not found" });
    globalThis.fetch = vi.fn(async () => new Response(body, { status: 404 })) as unknown as typeof fetch;

    try {
      const report = await checkRailwayDomain({ baseUrl: "https://archguard-production.up.railway.app" });

      expect(report.status).toBe("error");
      expect(report.domainDiagnosis).toBe("domain_not_attached_to_api_service");
      expect(report.nextSteps).toContain("In Railway, open the API service, not the worker service.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("classifies reachable health with failed readiness as api reachable but not ready", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/ready")) return new Response(JSON.stringify({ status: "error" }), { status: 503 });
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const report = await checkRailwayDomain({ baseUrl: "https://archguard-production.up.railway.app" });

      expect(report.status).toBe("error");
      expect(report.domainDiagnosis).toBe("api_reachable_but_not_ready");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
