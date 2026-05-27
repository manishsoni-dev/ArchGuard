import { fileURLToPath } from "node:url";

export type RailwayCutoverChecklist = {
  status: "manual_action_required";
  steps: Array<{
    id: string;
    title: string;
    mustSee?: string[];
    commands?: string[];
  }>;
};

export function buildRailwayCutoverChecklist(): RailwayCutoverChecklist {
  return {
    status: "manual_action_required",
    steps: [
      {
        id: "select-api-service",
        title: "Select the API service in Railway",
        mustSee: ["Dockerfile.api", "public domain", "API startup logs"]
      },
      {
        id: "verify-api-logs",
        title: "Confirm API startup logs",
        mustSee: ["Starting ArchGuard API server", "host: 0.0.0.0", "service: archguard-api"]
      },
      {
        id: "attach-domain",
        title: "Attach or generate a public domain on the API service"
      },
      {
        id: "test-domain",
        title: "Test the API service domain",
        commands: [
          "pnpm railway:domain-check -- baseUrl=https://ACTUAL-API-DOMAIN",
          "pnpm smoke:deployment -- baseUrl=https://ACTUAL-API-DOMAIN"
        ]
      },
      {
        id: "only-then-update-github",
        title: "Only after /health /ready /version return 200, update GitHub App webhook"
      }
    ]
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(buildRailwayCutoverChecklist(), null, 2));
}
