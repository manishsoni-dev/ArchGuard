import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFixtureRepository } from "../src/scripts/create-fixture-repo.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
  tempDir = undefined;
});

describe("createFixtureRepository", () => {
  it("creates ADR files and layered source files", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "archguard-fixture-"));
    await createFixtureRepository(tempDir);

    await expect(readFile(path.join(tempDir, "docs/adr/0002-frontend-must-not-import-db.md"), "utf8")).resolves.toContain(
      "Frontend/ui files must not import db directly"
    );
    await expect(readFile(path.join(tempDir, "src/frontend/components/UserCard.tsx"), "utf8")).resolves.toContain(
      "export function UserCard"
    );
    await expect(readFile(path.join(tempDir, "src/backend/db/user-repository.ts"), "utf8")).resolves.toContain(
      "findUserById"
    );
  });
});
