import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export type GitHubAppConfig = {
  appId: number;
  privateKey: string;
};

export function createInstallationOctokit(
  config: GitHubAppConfig,
  installationId: number
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.appId,
      privateKey: config.privateKey,
      installationId
    }
  });
}

export async function getInstallationAccessToken(
  config: GitHubAppConfig,
  installationId: number
): Promise<string> {
  const auth = createAppAuth({
    appId: config.appId,
    privateKey: config.privateKey,
    installationId
  });
  const installationAuthentication = await auth({ type: "installation" });
  return installationAuthentication.token;
}
