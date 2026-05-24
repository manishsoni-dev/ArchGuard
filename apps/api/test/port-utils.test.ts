import { describe, expect, it } from "vitest";
import { runCheckPort } from "../src/scripts/check-port.js";
import { runKillPort } from "../src/scripts/kill-port.js";

const lsofOutput = `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    12345 manish 22u  IPv4 0x123      0t0  TCP *:3000 (LISTEN)
`;

describe("port utilities", () => {
  it("check-port reports available port", async () => {
    const result = await runCheckPort(["3000"], {
      execFile: async () => ({ stdout: "" }),
      probePort: async () => true
    });

    expect(result).toEqual({
      port: 3000,
      available: true,
      processes: []
    });
  });

  it("check-port reports occupied port using mocked implementation", async () => {
    const result = await runCheckPort(["3000"], {
      execFile: async () => ({ stdout: lsofOutput }),
      probePort: async () => false
    });

    expect(result.available).toBe(false);
    expect(result.processes).toEqual([
      expect.objectContaining({
        command: "node",
        pid: 12345
      })
    ]);
  });

  it("kill-port lists process and asks confirmation", async () => {
    let asked = false;
    const result = await runKillPort(["3000"], {
      execFile: async () => ({ stdout: lsofOutput }),
      probePort: async () => false,
      confirm: async () => {
        asked = true;
        return false;
      },
      killProcess: () => {
        throw new Error("should not kill");
      }
    });

    expect(asked).toBe(true);
    expect(result.cancelled).toBe(true);
    expect(result.skipped[0]?.pid).toBe(12345);
  });

  it("kill-port --yes kills mocked process", async () => {
    const killed: number[] = [];
    const result = await runKillPort(["3000", "--yes"], {
      execFile: async () => ({ stdout: lsofOutput }),
      probePort: async () => false,
      killProcess: (pid) => killed.push(pid)
    });

    expect(killed).toEqual([12345]);
    expect(result.killed[0]?.pid).toBe(12345);
  });

  it("kill-port does not kill unrelated processes", async () => {
    const killed: number[] = [];
    const result = await runKillPort(["3000", "--yes"], {
      execFile: async () => ({
        stdout: `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
node ${process.pid} manish 22u IPv4 0x123 0t0 TCP *:3000 (LISTEN)
node 22222 manish 23u IPv4 0x456 0t0 TCP *:3000 (LISTEN)
`
      }),
      probePort: async () => false,
      killProcess: (pid) => killed.push(pid)
    });

    expect(killed).toEqual([22222]);
    expect(result.skipped[0]?.pid).toBe(process.pid);
  });
});
