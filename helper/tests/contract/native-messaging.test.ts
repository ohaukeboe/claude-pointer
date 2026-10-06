// Contract: specs/001-element-comment-picker/contracts/native-messaging.md (real `native-host` binary).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeBatch } from "../../../shared/fixtures";
import { nativeCall } from "../support/cli";
import { startFakeSession } from "../support/fake-session";
import { tempDir } from "../support/tmp";

describe("native host", () => {
  it("lists one running session with reason recent and no socketPath", async () => {
    const runtime = tempDir();
    const fake = await startFakeSession({
      dir: join(runtime, "claude-pointer"),
      id: "11-22",
      projectDir: "/p/shelf",
    });
    const res = (await nativeCall(
      { v: 1, type: "list-sessions", pageUrl: "https://example.com/", pageTitle: "Ex" },
      { XDG_RUNTIME_DIR: runtime },
    )) as { ok: boolean; sessions: { session: Record<string, unknown>; reason: string }[] };
    expect(res.ok).toBe(true);
    expect(res.sessions).toHaveLength(1);
    expect(res.sessions[0]!.reason).toBe("recent");
    expect(res.sessions[0]!.session).toEqual(fake.session);
    expect(JSON.stringify(res)).not.toContain("socketPath");
    expect(JSON.stringify(res)).not.toContain(".sock");
    await fake.close();
  });

  it("returns an empty list when no session runs", async () => {
    const res = await nativeCall(
      { v: 1, type: "list-sessions", pageUrl: "https://example.com/", pageTitle: "" },
      { XDG_RUNTIME_DIR: tempDir() },
    );
    expect(res).toEqual({ v: 1, ok: true, sessions: [] });
  });

  it("sends a batch to the named session only", async () => {
    const runtime = tempDir();
    const dir = join(runtime, "claude-pointer");
    const a = await startFakeSession({ dir, id: "1-1", projectDir: "/p/a" });
    const b = await startFakeSession({ dir, id: "2-2", projectDir: "/p/b" });
    const batch = makeBatch({ sessionId: "2-2" });
    const res = await nativeCall(
      { v: 1, type: "send-batch", sessionId: "2-2", batch },
      { XDG_RUNTIME_DIR: runtime },
    );
    expect(res).toMatchObject({ v: 1, ok: true, batchId: batch.id });
    expect(a.prompts).toHaveLength(0);
    expect(b.prompts).toHaveLength(1);
    await a.close();
    await b.close();
  });

  it("returns session-gone for an unknown session", async () => {
    const batch = makeBatch({ sessionId: "9-9" });
    const res = await nativeCall(
      { v: 1, type: "send-batch", sessionId: "9-9", batch },
      { XDG_RUNTIME_DIR: tempDir() },
    );
    expect(res).toMatchObject({ v: 1, ok: false, error: { code: "session-gone" } });
  });

  it("returns unsupported-version for v: 2", async () => {
    const res = await nativeCall({ v: 2, type: "list-sessions" }, { XDG_RUNTIME_DIR: tempDir() });
    expect(res).toMatchObject({ ok: false, error: { code: "unsupported-version" } });
  });

  it("returns invalid-request for a malformed batch", async () => {
    const res = await nativeCall(
      { v: 1, type: "send-batch", sessionId: "1-1", batch: { id: "x" } },
      { XDG_RUNTIME_DIR: tempDir() },
    );
    expect(res).toMatchObject({ ok: false, error: { code: "invalid-request" } });
  });

  it("returns invalid-request for a session id that is not <pid>-<ticks>", async () => {
    const batch = makeBatch({ sessionId: "../x" });
    const res = await nativeCall(
      { v: 1, type: "send-batch", sessionId: "../x", batch },
      { XDG_RUNTIME_DIR: tempDir() },
    );
    expect(res).toMatchObject({ ok: false, error: { code: "invalid-request" } });
  });
});
