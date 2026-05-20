import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadEnv } from "../env.js";
import { createInstallationOctokit } from "../github/app-auth.js";

const inspectArgsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pr: z.coerce.number().int().positive()
});

export type InspectPrArgs = z.infer<typeof inspectArgsSchema>;

export type InspectPrSummary = {
  repository: string;
  pullRequestNumber: number;
  title: string;
  author?: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  changedFiles: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
  totals: {
    additions: number;
    deletions: number;
    files: number;
  };
  hasEnoughInformationForArchGuard: boolean;
};

export type InspectPrClient = {
  getPullRequest(input: InspectPrArgs): Promise<{
    title: string;
    author?: string;
    baseBranch: string;
    headBranch: string;
    headSha: string;
  }>;
  listChangedFiles(input: InspectPrArgs): Promise<InspectPrSummary["changedFiles"]>;
};

export function parseInspectPrArgs(args: string[]): InspectPrArgs {
  const values = Object.fromEntries(
    args
      .filter((arg) => arg !== "--")
      .map((arg) => {
        const [key, ...rest] = arg.split("=");
        return [key, rest.join("=")];
      })
  );
  return inspectArgsSchema.parse(values);
}

export async function inspectPullRequest(args: InspectPrArgs, client: InspectPrClient): Promise<InspectPrSummary> {
  const [metadata, changedFiles] = await Promise.all([
    client.getPullRequest(args),
    client.listChangedFiles(args)
  ]);
  return formatPullRequestSummary(args, metadata, changedFiles);
}

export function formatPullRequestSummary(
  args: InspectPrArgs,
  metadata: Awaited<ReturnType<InspectPrClient["getPullRequest"]>>,
  changedFiles: InspectPrSummary["changedFiles"]
): InspectPrSummary {
  const totals = changedFiles.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
      files: sum.files + 1
    }),
    { additions: 0, deletions: 0, files: 0 }
  );
  const meaningfulSourcePattern = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|go|rs|py|rb|java|kt|cs|php|swift|md)$/i;

  return {
    repository: `${args.owner}/${args.repo}`,
    pullRequestNumber: args.pr,
    title: metadata.title,
    author: metadata.author,
    baseBranch: metadata.baseBranch,
    headBranch: metadata.headBranch,
    headSha: metadata.headSha,
    changedFiles,
    totals,
    hasEnoughInformationForArchGuard: Boolean(metadata.headSha && changedFiles.some((file) => meaningfulSourcePattern.test(file.filename)))
  };
}

export function createOctokitInspectPrClient(installationId: number): InspectPrClient {
  const env = loadEnv();
  const octokit = createInstallationOctokit(
    { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_PRIVATE_KEY },
    installationId
  );

  return {
    async getPullRequest(input) {
      const response = await octokit.pulls.get({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pr
      });
      return {
        title: response.data.title,
        author: response.data.user?.login,
        baseBranch: response.data.base.ref,
        headBranch: response.data.head.ref,
        headSha: response.data.head.sha
      };
    },
    async listChangedFiles(input) {
      const files = await octokit.paginate(octokit.pulls.listFiles, {
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pr,
        per_page: 100
      });
      return files.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes
      }));
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void (async () => {
    const args = parseInspectPrArgs(process.argv.slice(2));
    const env = loadEnv();
    const installationId = env.TEST_GITHUB_INSTALLATION_ID;

    if (!installationId) {
      throw new Error("TEST_GITHUB_INSTALLATION_ID is required for pnpm inspect:pr");
    }

    const summary = await inspectPullRequest(args, createOctokitInspectPrClient(installationId));
    console.log(JSON.stringify(summary, null, 2));
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

