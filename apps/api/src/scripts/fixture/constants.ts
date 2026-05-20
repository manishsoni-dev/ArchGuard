import path from "node:path";

export const fixtureTenantName = "Local Fixture Tenant";
export const fixtureInstallationId = 424242;
export const fixtureRepositoryGithubId = 424242001n;
export const fixtureRepositoryFullName = "local/layered-app";
export const fixtureRepositoryOwner = "local";
export const fixtureRepositoryName = "layered-app";

export function fixtureRepositoryPath(cwd = process.cwd()): string {
  return path.resolve(workspaceRoot(cwd), ".tmp/fixture-repos/layered-app");
}

export function workspaceRoot(cwd = process.cwd()): string {
  return path.basename(cwd) === "api" && path.basename(path.dirname(cwd)) === "apps"
    ? path.resolve(cwd, "../..")
    : cwd;
}
