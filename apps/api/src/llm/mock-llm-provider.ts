import type { LLMProvider } from "./llm-provider.js";
import type { LLMGenerateInput, LLMGenerateResult } from "./types.js";

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";

  constructor(readonly model = "mock-architecture-analyzer") {}

  async generate(input: LLMGenerateInput): Promise<LLMGenerateResult> {
    const startedAt = Date.now();
    const prompt = input.messages.map((message) => message.content).join("\n").toLowerCase();

    return {
      content: JSON.stringify(mockResultForPrompt(prompt)),
      model: this.model,
      latencyMs: Date.now() - startedAt
    };
  }
}

function mockResultForPrompt(prompt: string): unknown {
  if (
    prompt.includes("no meaningful diff") ||
    prompt.includes("empty/no meaningful diff") ||
    prompt.includes("changed files: readme.md")
  ) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      confidence: 0.9,
      summary: "Insufficient evidence: the PR diff does not provide meaningful source changes for architecture analysis.",
      findings: [],
      retrievedContextSummary: "RAG mock reviewed retrieved context but found insufficient evidence."
    };
  }

  if (
    (prompt.includes("frontend") || prompt.includes("ui")) &&
    (prompt.includes("+import { db }") || prompt.includes("from \"../../backend/db/client\""))
  ) {
    return {
      verdict: "DRIFT_RISK",
      confidence: 0.88,
      summary: "The PR appears to introduce a frontend dependency on the database layer, conflicting with retrieved architecture context.",
      findings: [
        {
          title: "Frontend imports database layer directly",
          severity: "HIGH",
          filePath: "src/frontend/components/UserCard.tsx",
          evidence: ["Added import from ../../backend/db/client in frontend code."],
          recommendation: "Route database access through the existing API or backend service boundary."
        }
      ],
      retrievedContextSummary: "RAG mock used retrieved ADR/code context."
    };
  }

  if (
    prompt.includes("src/frontend/") &&
    prompt.includes("+import") &&
    prompt.includes("../../backend/services")
  ) {
    return {
      verdict: "DRIFT_RISK",
      confidence: 0.83,
      summary: "The PR appears to bypass the frontend API boundary by importing a backend service directly.",
      findings: [
        {
          title: "Frontend imports backend service directly",
          severity: "HIGH",
          filePath: "src/frontend/components/UserCard.tsx",
          evidence: ["Frontend component imports from ../../backend/services."],
          recommendation: "Call the frontend API helper or HTTP boundary instead of importing backend service code."
        }
      ],
      retrievedContextSummary: "RAG mock used retrieved ADR/code context."
    };
  }

  if (prompt.includes("src/backend/services") && prompt.includes("+import") && prompt.includes("../../frontend")) {
    return {
      verdict: "DRIFT_RISK",
      confidence: 0.84,
      summary: "The PR appears to introduce a backend dependency on frontend code, reversing the intended dependency direction.",
      findings: [
        {
          title: "Backend service imports frontend module",
          severity: "HIGH",
          filePath: "src/backend/services/user-service.ts",
          evidence: ["Backend service imports from src/frontend."],
          recommendation: "Keep frontend modules out of backend services and share contracts through an API or shared package."
        }
      ],
      retrievedContextSummary: "RAG mock used retrieved ADR/code context."
    };
  }

  return {
    verdict: "FIT",
    confidence: 0.78,
    summary: "The PR appears consistent with retrieved architecture context.",
    findings: [],
    retrievedContextSummary: "RAG mock used retrieved ADR/code context."
  };
}
