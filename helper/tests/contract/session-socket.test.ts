// Contract: specs/001-element-comment-picker/contracts/session-socket.md (real `channel` binary).
import { existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { sessionIdFor } from "../../src/registry/index";
import { request } from "../../src/registry/socket-client";
import { makeBatch } from "../../../shared/fixtures";
import { spawnCli } from "../support/cli";
import { tempDir } from "../support/tmp";

const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
});

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function startChannelProcess() {
  const runtime = tempDir();
  const project = tempDir("proj-");
  const child = spawnCli(["channel"], { XDG_RUNTIME_DIR: runtime }, project);
  children.push(child);
  let stdout = "";
  child.stdout!.on("data", (d) => (stdout += d.toString()));
  const dir = join(runtime, "claude-pointer");
  const id = sessionIdFor(process.pid);
  const sock = join(dir, `${id}.sock`);
  await waitFor(() => existsSync(sock));
  return { child, dir, sock, id, project, stdout: () => stdout };
}

describe("session socket (channel process)", () => {
  it("creates <sessionId>.sock mode 0600 in a 0700 dir, id from parent pid", async () => {
    const { dir, sock } = await startChannelProcess();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(sock).mode & 0o777).toBe(0o600);
  });

  it("answers info with the Session", async () => {
    const { sock, id, project } = await startChannelProcess();
    const res = await request(sock, { v: 1, type: "info" });
    expect(res).toMatchObject({
      v: 1,
      ok: true,
      session: { id, projectDir: project, projectName: project.split("/").pop() },
    });
    expect(Date.parse((res as { session: { startedAt: string } }).session.startedAt)).not.toBeNaN();
  });

  it("validates deliver again and emits the MCP notification on stdout", async () => {
    const { sock, id, stdout } = await startChannelProcess();
    const bad = await request(sock, {
      v: 1,
      type: "deliver",
      batch: makeBatch({ sessionId: id, comments: [] }),
    });
    expect(bad).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    const batch = makeBatch({ sessionId: id });
    const res = await request(sock, { v: 1, type: "deliver", batch });
    expect(res).toMatchObject({ v: 1, ok: true, batchId: batch.id });
    await waitFor(() => stdout().includes("notifications/claude/channel"));
  });

  it("unlinks the socket on SIGTERM", async () => {
    const { child, dir } = await startChannelProcess();
    child.kill("SIGTERM");
    await new Promise((r) => child.on("exit", r));
    expect(readdirSync(dir)).toEqual([]);
  });

  it("unlinks the socket when stdin closes", async () => {
    const { child, dir } = await startChannelProcess();
    child.stdin!.end();
    await new Promise((r) => child.on("exit", r));
    expect(readdirSync(dir)).toEqual([]);
  });
});
