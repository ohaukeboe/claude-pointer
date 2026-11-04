import { createConnection } from "node:net";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createListener } from "../../../src/registry/listener";
import { request } from "../../../src/registry/socket-client";
import { makeBatch } from "../../../../shared/fixtures";
import type { Session, SocketRequest } from "../../../../shared/types";
import { tempDir } from "../../support/tmp";

const session: Session = {
  id: "100-200",
  projectDir: "/home/u/projects/shelf",
  projectName: "shelf",
  startedAt: "2026-10-06T17:00:00.000Z",
};

function rawLine(path: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = createConnection(path, () => s.write(line));
    let buf = "";
    s.on("data", (d) => (buf += d.toString()));
    s.on("end", () => resolve(buf));
    s.on("error", reject);
  });
}

describe("createListener", () => {
  it("creates <id>.sock with mode 0600 in a 0700 dir", async () => {
    const dir = join(tempDir(), "cp");
    const l = await createListener({ dir, session: () => session, handlers: { deliver: vi.fn() } });
    expect(l.path).toBe(join(dir, "100-200.sock"));
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(l.path).mode & 0o777).toBe(0o600);
    await l.close();
    expect(existsSync(l.path)).toBe(false);
  });

  it("answers info with the session", async () => {
    const dir = join(tempDir(), "cp");
    const l = await createListener({ dir, session: () => session, handlers: { deliver: vi.fn() } });
    await expect(request(l.path, { v: 1, type: "info" })).resolves.toEqual({
      v: 1,
      ok: true,
      session,
    });
    await l.close();
  });

  it("passes a valid deliver to onDeliver and returns its answer", async () => {
    const dir = join(tempDir(), "cp");
    const onDeliver = vi
      .fn()
      .mockResolvedValue({ v: 1, ok: true, batchId: "b1", deliveredAt: "t" });
    const l = await createListener({
      dir,
      session: () => session,
      handlers: { deliver: onDeliver },
    });
    const batch = makeBatch();
    await expect(request(l.path, { v: 1, type: "deliver", batch })).resolves.toEqual({
      v: 1,
      ok: true,
      batchId: "b1",
      deliveredAt: "t",
    });
    expect(onDeliver).toHaveBeenCalledWith(batch);
    await l.close();
  });

  it("re-validates the batch and rejects invalid ones without calling onDeliver", async () => {
    const dir = join(tempDir(), "cp");
    const onDeliver = vi.fn();
    const l = await createListener({
      dir,
      session: () => session,
      handlers: { deliver: onDeliver },
    });
    const res = await request(l.path, {
      v: 1,
      type: "deliver",
      batch: makeBatch({ comments: [] }),
    });
    expect(res).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    expect(onDeliver).not.toHaveBeenCalled();
    await l.close();
  });

  it("rejects a batch addressed to another session", async () => {
    const dir = join(tempDir(), "cp");
    const onDeliver = vi.fn();
    const l = await createListener({
      dir,
      session: () => session,
      handlers: { deliver: onDeliver },
    });
    const res = await request(l.path, {
      v: 1,
      type: "deliver",
      batch: makeBatch({ sessionId: "1-1" }),
    });
    expect(res).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    expect(onDeliver).not.toHaveBeenCalled();
    await l.close();
  });

  it("answers bad JSON with invalid-request", async () => {
    const dir = join(tempDir(), "cp");
    const l = await createListener({ dir, session: () => session, handlers: { deliver: vi.fn() } });
    const out = await rawLine(l.path, "{nope\n");
    expect(JSON.parse(out)).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    await l.close();
  });

  it("maps onDeliver exceptions to internal", async () => {
    const dir = join(tempDir(), "cp");
    const l = await createListener({
      dir,
      session: () => session,
      handlers: { deliver: vi.fn().mockRejectedValue(new Error("boom")) },
    });
    const res = await request(l.path, { v: 1, type: "deliver", batch: makeBatch() });
    expect(res).toMatchObject({ ok: false, error: { code: "internal", message: "boom" } });
    await l.close();
  });

  it("replaces a stale socket file with the same name", async () => {
    const dir = join(tempDir(), "cp");
    const a = await createListener({ dir, session: () => session, handlers: { deliver: vi.fn() } });
    // simulate crash: keep file, drop server
    await a.close({ keepFile: true });
    const b = await createListener({ dir, session: () => session, handlers: { deliver: vi.fn() } });
    await expect(request(b.path, { v: 1, type: "info" })).resolves.toMatchObject({ ok: true });
    await b.close();
  });

  it("reads the session on every info request", async () => {
    const dir = join(tempDir(), "cp");
    let watch: Session["watch"] = "off";
    const l = await createListener({
      dir,
      session: () => ({ ...session, mode: "no-channel", watch }),
      handlers: {},
    });
    watch = "waiting";
    await expect(request(l.path, { v: 1, type: "info" })).resolves.toMatchObject({
      session: { mode: "no-channel", watch: "waiting" },
    });
    await l.close();
  });

  it("answers a request with no handler with invalid-request", async () => {
    const dir = join(tempDir(), "cp");
    const l = await createListener({ dir, session: () => session, handlers: {} });
    const reqs: SocketRequest[] = [
      { v: 1, type: "deliver", batch: makeBatch() },
      { v: 1, type: "status", batchIds: ["b1"] },
      { v: 1, type: "peek" },
      { v: 1, type: "wait" },
    ];
    for (const req of reqs) {
      await expect(request(l.path, req)).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid-request" },
      });
    }
    await l.close();
  });

  it("passes status and peek to their handlers", async () => {
    const dir = join(tempDir(), "cp");
    const status = vi.fn().mockReturnValue({ v: 1, ok: true, statuses: [] });
    const peek = vi.fn().mockReturnValue({ v: 1, ok: true, waiting: 0, pages: [] });
    const l = await createListener({ dir, session: () => session, handlers: { status, peek } });
    await expect(request(l.path, { v: 1, type: "status", batchIds: ["b1"] })).resolves.toEqual({
      v: 1,
      ok: true,
      statuses: [],
    });
    expect(status).toHaveBeenCalledWith(["b1"]);
    await expect(request(l.path, { v: 1, type: "peek" })).resolves.toMatchObject({ waiting: 0 });
    await l.close();
  });

  it("holds a wait open until the handler answers", async () => {
    const dir = join(tempDir(), "cp");
    let answer: (v: unknown) => void = () => {};
    const wait = vi.fn(() => new Promise((r) => (answer = r)));
    const l = await createListener({
      dir,
      session: () => session,
      handlers: { wait: wait as never },
    });
    const res = request(l.path, { v: 1, type: "wait" }, null);
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    answer({ v: 1, ok: true, outcome: "comments", waiting: 1 });
    await expect(res).resolves.toEqual({ v: 1, ok: true, outcome: "comments", waiting: 1 });
    await l.close();
  });

  it("aborts the wait signal when the client disconnects", async () => {
    const dir = join(tempDir(), "cp");
    let signal: AbortSignal | undefined;
    const wait = vi.fn((s: AbortSignal) => {
      signal = s;
      return new Promise(() => {});
    });
    const l = await createListener({
      dir,
      session: () => session,
      handlers: { wait: wait as never },
    });
    const s = createConnection(l.path, () =>
      s.write(JSON.stringify({ v: 1, type: "wait" }) + "\n"),
    );
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(signal!.aborted).toBe(false);
    s.destroy();
    await vi.waitFor(() => expect(signal!.aborted).toBe(true));
    await l.close();
  });

  it("closes even while a wait is open", async () => {
    const dir = join(tempDir(), "cp");
    const wait = vi.fn(() => new Promise(() => {}));
    const l = await createListener({
      dir,
      session: () => session,
      handlers: { wait: wait as never },
    });
    const res = request(l.path, { v: 1, type: "wait" }, null);
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    await l.close();
    await expect(res).resolves.toMatchObject({ ok: false });
  });

  it("refuses to start in a group-readable dir", async () => {
    const { mkdirSync, chmodSync } = await import("node:fs");
    const dir = join(tempDir(), "open");
    mkdirSync(dir);
    chmodSync(dir, 0o750);
    await expect(
      createListener({ dir, session: () => session, handlers: { deliver: vi.fn() } }),
    ).rejects.toThrow(/group\/world/);
  });
});
