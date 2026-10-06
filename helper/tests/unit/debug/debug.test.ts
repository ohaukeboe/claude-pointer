import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { debugList, debugSend } from "../../../src/debug";
import { startFakeSession } from "../../support/fake-session";
import { tempDir } from "../../support/tmp";

let runtime: string;
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.XDG_RUNTIME_DIR;
  runtime = tempDir();
  process.env.XDG_RUNTIME_DIR = runtime;
});
afterEach(() => {
  process.env.XDG_RUNTIME_DIR = saved;
});

describe("debug commands", () => {
  it("list prints a message when nothing runs", async () => {
    const out: string[] = [];
    expect(await debugList((s) => out.push(s))).toBe(0);
    expect(out).toEqual(["No claude-pointer sessions running."]);
  });

  it("list and send reach a running session", async () => {
    const fake = await startFakeSession({
      dir: join(runtime, "claude-pointer"),
      id: "4-4",
      projectDir: "/p/x",
    });
    const out: string[] = [];
    await debugList((s) => out.push(s));
    expect(out[0]).toMatch(/^4-4\tx\t\/p\/x\t/);
    expect(await debugSend("say hello", undefined, (s) => out.push(s))).toBe(0);
    expect(fake.prompts[0]!.params.content).toContain("Comment: say hello");
    await fake.close();
  });

  it("send fails without sessions", async () => {
    expect(await debugSend("x", undefined, () => {})).toBe(1);
  });
});
