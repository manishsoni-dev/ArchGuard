import { describe, expect, it } from "vitest";
import { FriendlyStartupError, friendlyListenError } from "../src/server.js";

describe("server startup errors", () => {
  it("EADDRINUSE produces friendly message", () => {
    const error = friendlyListenError(Object.assign(new Error("listen failed"), { code: "EADDRINUSE" }), 3000);

    expect(error).toBeInstanceOf(FriendlyStartupError);
    expect(error.message).toBe(
      "Port 3000 is already in use. Stop the existing server or run: pnpm kill:port -- 3000 --yes"
    );
    expect(error.stack).not.toContain("listen failed");
  });

  it("non-EADDRINUSE errors still surface correctly", () => {
    const original = Object.assign(new Error("boom"), { code: "EACCES" });
    const error = friendlyListenError(original, 3000);

    expect(error).toBe(original);
    expect(error.message).toBe("boom");
  });
});
