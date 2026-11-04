// Contract: specs/002-no-channel-delivery/contracts/cli.md `wait --session <id>` (built CLI).
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WaitOutcome } from "../../../shared/types";
import { startFakeSession, type FakeSession } from "../support/fake-session";
import { spawnCli } from "../support/cli";
import { tempDir } from "../support/tmp";

let fakes: FakeSession[] = [];
afterEach(async () => {
  for (const f of fakes) await f.close();
  fakes = [];
});

function runWait(args: string[], runtime: string) {
  const child = spawnCli(["wait", ...args], { XDG_RUNTIME_DIR: runtime });
  let stdout = "";
  child.stdout!.on("data", (d) => (stdout += d.toString()));
  const exit = new Promise<number | null>((r) => child.on("exit", r));
  return { exit, stdout: () => stdout };
}

async function withFake() {
  const runtime = tempDir();
  const fake = await startFakeSession({
    dir: join(runtime, "claude-pointer"),
    id: "7-7",
    projectDir: "/p/w",
    mode: "no-channel",
  });
  fakes.push(fake);
  return { runtime, fake };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 250 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
}

describe("claude-pointer wait", () => {
  it("prints the comment count and exits 0", async () => {
    const { runtime, fake } = await withFake();
    const w = runWait(["--session", "7-7"], runtime);
    await until(() => fake.calls.includes("wait"));
    fake.answerWait({ outcome: "comments", waiting: 2 });
    expect(await w.exit).toBe(0);
    expect(w.stdout()).toBe("claude-pointer: comments (2 waiting)\n");
  });

  it.each<WaitOutcome>(["timeout", "expired", "stopped", "replaced"])(
    "prints one line for %s",
    async (outcome) => {
      const { runtime, fake } = await withFake();
      const w = runWait(["--session", "7-7"], runtime);
      await until(() => fake.calls.includes("wait"));
      fake.answerWait({ outcome, waiting: 0 });
      expect(await w.exit).toBe(0);
      expect(w.stdout()).toBe(`claude-pointer: ${outcome}\n`);
    },
  );

  it("reports session-gone with exit 1", async () => {
    const w = runWait(["--session", "9-9"], tempDir());
    expect(await w.exit).toBe(1);
    expect(w.stdout()).toBe("claude-pointer: session-gone\n");
  });

  it("rejects a missing or invalid id with exit 2", async () => {
    expect(await runWait(["--session", "../x"], tempDir()).exit).toBe(2);
    expect(await runWait([], tempDir()).exit).toBe(2);
  });
});
