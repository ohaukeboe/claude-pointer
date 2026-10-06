// FR-017 / FR-018: local only, same user only, no TCP listener.
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createListener } from "../../src/registry/listener";
import { tempDir } from "../support/tmp";

const session = { id: "1-2", projectDir: "/p", projectName: "p", startedAt: "t" };

function tcpListeners(): Set<string> {
  const out = new Set<string>();
  for (const f of ["/proc/self/net/tcp", "/proc/self/net/tcp6"]) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n").slice(1)) {
        const c = line.trim().split(/\s+/);
        if (c[3] === "0A" && c[9]) out.add(c[9]);
      }
    } catch {
      // not Linux
    }
  }
  return out;
}

describe("security", () => {
  it.each([0o755, 0o750, 0o705])("refuses a socket dir with mode %o", async (mode) => {
    const dir = join(tempDir(), "cp");
    mkdirSync(dir);
    chmodSync(dir, mode);
    await expect(createListener({ dir, session, onDeliver: vi.fn() })).rejects.toThrow(
      /group\/world/,
    );
  });

  it("opens no TCP listener (Unix socket only)", async () => {
    const before = tcpListeners();
    const l = await createListener({ dir: join(tempDir(), "cp"), session, onDeliver: vi.fn() });
    const after = tcpListeners();
    const ownInodes = [...after].filter((i) => !before.has(i));
    expect(ownInodes).toEqual([]);
    await l.close();
  });
});
