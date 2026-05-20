import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "../db/prisma.js";
import { createFixtureRepository } from "./create-fixture-repo.js";
import {
  fixtureInstallationId,
  fixtureRepositoryFullName,
  fixtureRepositoryGithubId,
  fixtureRepositoryName,
  fixtureRepositoryOwner,
  fixtureRepositoryPath,
  fixtureTenantName
} from "./fixture/constants.js";

export type FixtureRepositorySeed = {
  tenantId: string;
  repositoryId: string;
  fullName: string;
  localPath: string;
};

export async function seedFixtureRepository(): Promise<FixtureRepositorySeed> {
  const localPath = fixtureRepositoryPath();

  if (!existsSync(localPath)) {
    await createFixtureRepository(localPath);
  }

  const tenant = await prisma.tenant.upsert({
    where: { githubInstallationId: fixtureInstallationId },
    create: {
      name: fixtureTenantName,
      githubInstallationId: fixtureInstallationId
    },
    update: {
      name: fixtureTenantName
    }
  });

  const repository = await prisma.repository.upsert({
    where: { githubRepositoryId: fixtureRepositoryGithubId },
    create: {
      tenantId: tenant.id,
      githubRepositoryId: fixtureRepositoryGithubId,
      owner: fixtureRepositoryOwner,
      name: fixtureRepositoryName,
      fullName: fixtureRepositoryFullName,
      cloneUrl: localPath,
      defaultBranch: "main"
    },
    update: {
      tenantId: tenant.id,
      owner: fixtureRepositoryOwner,
      name: fixtureRepositoryName,
      fullName: fixtureRepositoryFullName,
      cloneUrl: localPath,
      defaultBranch: "main"
    }
  });

  return {
    tenantId: tenant.id,
    repositoryId: repository.id,
    fullName: repository.fullName,
    localPath
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void seedFixtureRepository()
    .then((seed) => {
      console.log(JSON.stringify(seed, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
