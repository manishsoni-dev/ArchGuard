import type { Octokit } from "@octokit/rest";

export type PullRequestIdentity = {
  owner: string;
  repo: string;
  pullNumber: number;
};

export type PullRequestMetadata = {
  id: bigint;
  number: number;
  title: string;
  state: string;
  headSha: string;
  baseSha: string;
  diffUrl?: string;
  openedByLogin?: string;
};

export type PullRequestChangedFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

export async function fetchPullRequestMetadata(
  octokit: Octokit,
  identity: PullRequestIdentity
): Promise<PullRequestMetadata> {
  const response = await octokit.pulls.get({
    owner: identity.owner,
    repo: identity.repo,
    pull_number: identity.pullNumber
  });

  return {
    id: BigInt(response.data.id),
    number: response.data.number,
    title: response.data.title,
    state: response.data.state,
    headSha: response.data.head.sha,
    baseSha: response.data.base.sha,
    diffUrl: response.data.diff_url,
    openedByLogin: response.data.user?.login
  };
}

export async function fetchPullRequestChangedFiles(
  octokit: Octokit,
  identity: PullRequestIdentity
): Promise<PullRequestChangedFile[]> {
  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner: identity.owner,
    repo: identity.repo,
    pull_number: identity.pullNumber,
    per_page: 100
  });

  return files.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch
  }));
}

export async function fetchPullRequestDiff(
  octokit: Octokit,
  identity: PullRequestIdentity
): Promise<string> {
  const response = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner: identity.owner,
    repo: identity.repo,
    pull_number: identity.pullNumber,
    headers: {
      accept: "application/vnd.github.v3.diff"
    }
  });

  return String(response.data);
}
