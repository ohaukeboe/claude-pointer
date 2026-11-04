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

async function startChannelProcess(args: string[] = []) {
  const runtime = tempDir();
  const project = tempDir("proj-");
  const child = spawnCli(["channel", ...args], { XDG_RUNTIME_DIR: runtime }, project);
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

// Contract: specs/002-no-channel-delivery/contracts/session-socket.md
describe("session socket (channel --no-push process)", () => {
  it("reports mode no-channel and watch off in info", async () => {
    const { sock } = await startChannelProcess(["--no-push"]);
    expect(await request(sock, { v: 1, type: "info" })).toMatchObject({
      ok: true,
      session: { mode: "no-channel", watch: "off" },
    });
  });

  it("reports mode channel without --no-push", async () => {
    const { sock } = await startChannelProcess();
    expect(await request(sock, { v: 1, type: "info" })).toMatchObject({
      session: { mode: "channel", watch: "off" },
    });
  });

  it("answers deliver with status waiting and writes no channel notification", async () => {
    const { sock, id, stdout } = await startChannelProcess(["--no-push"]);
    const batch = makeBatch({ sessionId: id });
    const res = await request(sock, { v: 1, type: "deliver", batch });
    expect(res).toMatchObject({ v: 1, ok: true, batchId: batch.id, status: "waiting" });
    await new Promise((r) => setTimeout(r, 100));
    expect(stdout()).not.toContain("notifications/claude/channel");
  });

  it("answers status per batch", async () => {
    const { sock, id } = await startChannelProcess(["--no-push"]);
    await request(sock, { v: 1, type: "deliver", batch: makeBatch({ id: "a", sessionId: id }) });
    expect(await request(sock, { v: 1, type: "status", batchIds: ["a", "zz"] })).toEqual({
      v: 1,
      ok: true,
      statuses: [
        { batchId: "a", state: "waiting", at: null },
        { batchId: "zz", state: "unknown", at: null },
      ],
    });
  });

  it("refuses the 51st waiting batch with inbox-full", async () => {
    const { sock, id } = await startChannelProcess(["--no-push"]);
    for (let i = 0; i < 50; i++) {
      const res = await request(sock, {
        v: 1,
        type: "deliver",
        batch: makeBatch({ id: `b${i}`, sessionId: id }),
      });
      expect(res).toMatchObject({ ok: true });
    }
    expect(
      await request(sock, { v: 1, type: "deliver", batch: makeBatch({ id: "x", sessionId: id }) }),
    ).toMatchObject({ ok: false, error: { code: "inbox-full" } });
  });

  it("answers peek with unread count and distinct pages, changing nothing", async () => {
    const { sock, id } = await startChannelProcess(["--no-push"]);
    const pages = [
      "http://a/1",
      "http://a/2",
      "http://a/1",
      "http://a/3",
      "http://a/4",
      "http://a/5",
      "http://a/6",
    ];
    for (const [i, pageUrl] of pages.entries()) {
      await request(sock, {
        v: 1,
        type: "deliver",
        batch: makeBatch({ id: `p${i}`, sessionId: id, pageUrl }),
      });
    }
    expect(await request(sock, { v: 1, type: "peek" })).toEqual({
      v: 1,
      ok: true,
      waiting: 7,
      pages: ["http://a/1", "http://a/2", "http://a/3", "http://a/4", "http://a/5"],
    });
    expect(await request(sock, { v: 1, type: "status", batchIds: ["p0"] })).toMatchObject({
      statuses: [{ state: "waiting" }],
    });
  });

  it("does not count pushed batches in peek", async () => {
    const { sock, id } = await startChannelProcess();
    await request(sock, { v: 1, type: "deliver", batch: makeBatch({ sessionId: id }) });
    expect(await request(sock, { v: 1, type: "peek" })).toEqual({
      v: 1,
      ok: true,
      waiting: 0,
      pages: [],
    });
  });
});
