import { z } from "zod";

export type CliArgumentProblem = {
  field: string;
  message: string;
};

export type CliArgumentErrorReport = {
  status: "error";
  message: "Invalid command arguments.";
  problems: CliArgumentProblem[];
  examples: string[];
};

export class CliArgumentError extends Error {
  constructor(public readonly report: CliArgumentErrorReport) {
    super(report.message);
    this.name = "CliArgumentError";
  }
}

export function assertNoPlaceholderArgs(
  values: Record<string, string | boolean | undefined>,
  examples: string[]
): void {
  const problems: CliArgumentProblem[] = [];

  for (const [field, rawValue] of Object.entries(values)) {
    if (typeof rawValue !== "string") continue;
    const placeholder = placeholderProblem(field, rawValue);
    if (placeholder) problems.push(placeholder);
  }

  if (problems.length) {
    throw new CliArgumentError({
      status: "error",
      message: "Invalid command arguments.",
      problems,
      examples
    });
  }
}

export function parseOrFriendlyError<T>(schema: z.ZodType<T>, values: unknown, examples: string[]): T {
  const result = schema.safeParse(values);
  if (result.success) return result.data;

  throw new CliArgumentError({
    status: "error",
    message: "Invalid command arguments.",
    problems: result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "arguments",
      message: friendlyIssueMessage(issue)
    })),
    examples
  });
}

export function printCliArgumentError(error: unknown): boolean {
  if (!(error instanceof CliArgumentError)) return false;
  console.log(JSON.stringify(error.report, null, 2));
  process.exitCode = 1;
  return true;
}

function placeholderProblem(field: string, value: string): CliArgumentProblem | null {
  if (field === "pr" && /^PR_NUMBER$/i.test(value.trim())) {
    return {
      field,
      message: "pr must be a numeric pull request number, e.g. pr=6."
    };
  }

  if (isPlaceholderUrl(value)) {
    return {
      field,
      message: `${field} must be a real https:// URL, not placeholder text.`
    };
  }

  return null;
}

function isPlaceholderUrl(value: string): boolean {
  return (
    /\bTHE_REAL_API_SERVICE_URL\b/i.test(value) ||
    /\bTHE_REAL_API_URL\b/i.test(value) ||
    /YOUR-STABLE-DOMAIN/i.test(value) ||
    /YOUR-DEPLOYED-DOMAIN/i.test(value) ||
    /ACTUAL-API-DOMAIN/i.test(value) ||
    /your-real-hosted-url/i.test(value) ||
    /example\.com/i.test(value)
  );
}

function friendlyIssueMessage(issue: z.ZodIssue): string {
  const field = issue.path.join(".");
  if (field === "pr") return "pr must be a numeric pull request number, e.g. pr=6.";
  if ((field === "baseUrl" || field === "url") && issue.code === "invalid_string") {
    return `${field} must be a real https:// URL, not placeholder text.`;
  }
  if ((field === "baseUrl" || field === "url") && issue.code === "invalid_type") {
    return `${field} is required and must be a real https:// URL.`;
  }
  return issue.message;
}
