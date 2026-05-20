import type { LLMMessage } from "../../llm/types.js";

export function extractJsonObject(content: string): string | undefined {
  const trimmed = content.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");

  if (first === -1 || last === -1 || last <= first) {
    return undefined;
  }

  return trimmed.slice(first, last + 1);
}

export function buildJsonRepairMessages(input: {
  invalidOutput: string;
  validationError: string;
}): LLMMessage[] {
  return [
    {
      role: "system",
      content: [
        "You repair invalid JSON for ArchGuard.",
        "Return only valid JSON. Do not add markdown or explanation.",
        "The JSON must match ArchitectureAnalysisResult exactly."
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "Validation error:",
        input.validationError,
        "",
        "Invalid output:",
        input.invalidOutput
      ].join("\n")
    }
  ];
}

