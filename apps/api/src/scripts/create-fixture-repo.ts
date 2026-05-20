import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { fixtureRepositoryPath } from "./fixture/constants.js";

const execFileAsync = promisify(execFile);

export type FixtureFile = {
  filePath: string;
  content: string;
};

export async function createFixtureRepository(rootDir = fixtureRepositoryPath()): Promise<string> {
  for (const file of fixtureFiles()) {
    const absolutePath = path.join(rootDir, file.filePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.content, "utf8");
  }

  if (!existsSync(path.join(rootDir, ".git"))) {
    await execFileAsync("git", ["init"], { cwd: rootDir }).catch(() => undefined);
  }

  return rootDir;
}

export function fixtureFiles(): FixtureFile[] {
  return [
    {
      filePath: "docs/adr/0001-layered-architecture.md",
      content: `# ADR 0001: Use layered architecture

## Status
Accepted

## Context
The application separates user interface, service, and database responsibilities.

## Decision
Frontend code lives under src/frontend and communicates through API helpers. Backend service logic lives under src/backend/services. Database access lives under src/backend/db.

## Consequences
Module boundaries remain easy to review and data access remains centralized.
`
    },
    {
      filePath: "docs/adr/0002-frontend-must-not-import-db.md",
      content: `# ADR 0002: Frontend must not import database layer

## Status
Accepted

## Context
Frontend/ui files must not import db directly. Frontend code should communicate through API/service boundaries.

## Decision
Files under frontend/ or ui/ must not import from db/ directly. Frontend must call an API/service boundary. Database access must remain inside backend/db or backend/services.

## Consequences
Database access remains centralized in backend services and backend repositories.
`
    },
    {
      filePath: "src/frontend/components/UserCard.tsx",
      content: `import type { UserSummary } from "../api/user-api";

export type UserCardProps = {
  user: UserSummary;
};

export function UserCard({ user }: UserCardProps) {
  return (
    <article>
      <h2>{user.name}</h2>
      <p>{user.email}</p>
    </article>
  );
}
`
    },
    {
      filePath: "src/frontend/api/user-api.ts",
      content: `export type UserSummary = {
  id: string;
  name: string;
  email: string;
};

export async function fetchUser(userId: string): Promise<UserSummary> {
  const response = await fetch(\`/api/users/\${userId}\`);
  return response.json() as Promise<UserSummary>;
}
`
    },
    {
      filePath: "src/backend/services/user-service.ts",
      content: `import { findUserById } from "../db/user-repository";

export async function getUserSummary(userId: string) {
  return findUserById(userId);
}
`
    },
    {
      filePath: "src/backend/db/client.ts",
      content: `export const db = {
  user: {
    findUnique: async (_input: { where: { id: string } }) => ({
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com"
    })
  }
};
`
    },
    {
      filePath: "src/backend/db/user-repository.ts",
      content: `import { db } from "./client";

export async function findUserById(userId: string) {
  return db.user.findUnique({ where: { id: userId } });
}
`
    },
    {
      filePath: "README.md",
      content: `# Layered App

Fixture repository for ArchGuard retrieval verification.
`
    },
    {
      filePath: "package.json",
      content: `{
  "name": "layered-app",
  "private": true,
  "type": "module"
}
`
    }
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void createFixtureRepository()
    .then((rootDir) => {
      console.log(JSON.stringify({ fixtureRepositoryPath: rootDir }, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
