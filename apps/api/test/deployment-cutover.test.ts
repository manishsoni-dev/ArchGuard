import { describe, expect, it } from "vitest";
import { buildDeploymentChecklist } from "../src/scripts/deployment-checklist.js";
import { buildGitHubAppCutoverPlan } from "../src/scripts/github-app-cutover-plan.js";

describe("deployment checklist and cutover plan", () => {
  it("reports required deployment files present", () => {
    const report = buildDeploymentChecklist("../../");

    expect(report.checks).toMatchObject({
      envProductionExample: "ok",
      dockerfiles: "ok",
      dockerignore: "ok",
      deploymentDocs: "ok",
      productionEnvValidation: "ok",
      databaseMigrationCommandDocumented: "ok",
      workerDocumented: "ok",
      webhookUpdateDocumented: "ok"
    });
  });

  it("rejects localhost cutover URL", () => {
    const report = buildGitHubAppCutoverPlan({ url: "https://localhost:3000" });

    expect(report.status).toBe("error");
    expect(report.problems.map((problem) => problem.message).join(" ")).toContain("localhost");
  });

  it("rejects ngrok unless explicitly allowed", () => {
    expect(buildGitHubAppCutoverPlan({ url: "https://demo.ngrok-free.dev" }).status).toBe("error");
    expect(buildGitHubAppCutoverPlan({ url: "https://demo.ngrok-free.dev", allowNgrok: true }).status).toBe("ok");
  });

  it("builds correct GitHub App webhook URL", () => {
    const report = buildGitHubAppCutoverPlan({ url: "https://archguard.example.app/" });

    expect(report.status).toBe("ok");
    expect(report.publicWebhookUrl).toBe("https://archguard.example.app");
    expect(report.githubAppWebhookUrl).toBe("https://archguard.example.app/webhooks/github");
  });
});
