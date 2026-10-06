import { PassThrough } from "node:stream";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeFrame, readFrame } from "../../../src/native-host/framing";
import {
  discoverSessions,
  handleNativeRequest,
  runNativeHost,
} from "../../../src/native-host/index";
import { makeBatch } from "../../../../shared/fixtures";
import { startFakeSession } from "../../support/fake-session";
import { tempDir } from "../../support/tmp";
import { createServer } from "node:net";
import { writeFileSync, existsSync } from "node:fs";

describe("handleNativeRequest", () => {
  it("lists sessions newest first", async () => {
    const dir = join(tempDir(), "cp");
    const old = await startFakeSession({
      dir,
      id: "1-1",
      projectDir: "/p/old",
      startedAt: "2026-01-01T00:00:00Z",
    });
    const neu = await startFakeSession({
      dir,
      id: "2-2",
      projectDir: "/p/new",
      startedAt: "2026-02-01T00:00:00Z",
    });
    const res = await handleNativeRequest(
      { v: 1, type: "list-sessions", pageUrl: "https://x/", pageTitle: "" },
      { dir },
    );
    expect(res.ok && "sessions" in res && res.sessions.map((s) => s.session.id)).toEqual([
      "2-2",
      "1-1",
    ]);
    await old.close();
    await neu.close();
  });

  it("removes stale socket files while listing", async () => {
    const dir = join(tempDir(), "cp");
    const live = await startFakeSession({ dir, id: "1-1", projectDir: "/p/a" });
    const stale = join(dir, "9-9.sock");
    writeFileSync(stale, "");
    const sessions = await discoverSessions(dir);
    expect(sessions.map((s) => s.id)).toEqual(["1-1"]);
    expect(existsSync(stale)).toBe(false);
    await live.close();
  });

  it("ignores sockets that answer garbage", async () => {
    const dir = join(tempDir(), "cp");
    const live = await startFakeSession({ dir, id: "1-1", projectDir: "/p/a" });
    const server = createServer((s) => s.end('{"v":1,"ok":true,"session":{"id":3}}\n'));
    await new Promise<void>((r) => server.listen(join(dir, "5-5.sock"), r));
    expect((await discoverSessions(dir)).map((s) => s.id)).toEqual(["1-1"]);
    server.close();
    await live.close();
  });

  it("passes through error responses other than session-gone", async () => {
    const dir = join(tempDir(), "cp");
    const fake = await startFakeSession({ dir, id: "1-1", projectDir: "/p/a" });
    const comments = Array.from({ length: 10 }, (_, i) => ({
      ...makeBatch().comments[0]!,
      id: `c${i}`,
      text: "x".repeat(10_000),
    }));
    const res = await handleNativeRequest(
      {
        v: 1,
        type: "send-batch",
        sessionId: "1-1",
        batch: makeBatch({ sessionId: "1-1", comments }),
      },
      { dir },
    );
    expect(res).toMatchObject({ ok: false, error: { code: "too-large" } });
    await fake.close();
  });

  it("rejects a mismatching delivered batchId as internal", async () => {
    const dir = join(tempDir(), "cp");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { mode: 0o700 });
    const server = createServer((s) =>
      s.end('{"v":1,"ok":true,"batchId":"other","deliveredAt":"t"}\n'),
    );
    await new Promise<void>((r) => server.listen(join(dir, "1-1.sock"), r));
    const res = await handleNativeRequest(
      { v: 1, type: "send-batch", sessionId: "1-1", batch: makeBatch({ sessionId: "1-1" }) },
      { dir },
    );
    expect(res).toMatchObject({ ok: false, error: { code: "internal" } });
    server.close();
  });
});

describe("runNativeHost", () => {
  async function run(input: Buffer): Promise<unknown> {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const out = readFrame(stdout);
    stdin.end(input);
    await runNativeHost(stdin, stdout, { dir: join(tempDir(), "cp") });
    return out;
  }

  it("answers one framed request", async () => {
    const res = await run(
      encodeFrame({ v: 1, type: "list-sessions", pageUrl: "https://x/", pageTitle: "" }),
    );
    expect(res).toEqual({ v: 1, ok: true, sessions: [] });
  });

  it("answers too-large for an oversized frame", async () => {
    const head = Buffer.alloc(4);
    head.writeUInt32LE(2 * 1024 * 1024);
    expect(await run(head)).toMatchObject({ ok: false, error: { code: "too-large" } });
  });

  it("answers invalid-request for bad JSON", async () => {
    const head = Buffer.alloc(4);
    head.writeUInt32LE(3);
    expect(await run(Buffer.concat([head, Buffer.from("{x}")]))).toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
  });
});

describe("send-batch to an ended session", () => {
  it("returns session-gone and removes nothing else", async () => {
    const dir = join(tempDir(), "cp");
    const res = await handleNativeRequest(
      { v: 1, type: "send-batch", sessionId: "7-7", batch: makeBatch({ sessionId: "7-7" }) },
      { dir },
    );
    expect(res).toMatchObject({ ok: false, error: { code: "session-gone" } });
  });
});
