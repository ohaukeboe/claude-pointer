import { describe, expect, it, vi } from "vitest";
import { resolveTarget, sendComments } from "../../../src/background/send";
import { ext } from "../../../src/lib/browser";
import { makeComment } from "../../../../shared/fixtures";
import type { Session } from "../../../../shared/types";

const shelf: Session = {
  id: "1-1",
  projectDir: "/p/shelf",
  projectName: "shelf",
  startedAt: "2026-10-06T10:00:00Z",
};
const PAGE = "http://localhost:5173/admin";

function native(impl: (msg: { type: string }) => unknown) {
  return vi.spyOn(ext, "sendNative").mockImplementation(async (m) => impl(m as { type: string }));
}

describe("resolveTarget (US1)", () => {
  it("asks the user to choose on the first send from an origin", async () => {
    native(() => ({ v: 1, ok: true, sessions: [{ session: shelf, reason: "recent", score: 49 }] }));
    const r = await resolveTarget(PAGE, "Admin");
    expect(r).toEqual({
      kind: "choose",
      suggestions: [{ session: shelf, reason: "recent", score: 49 }],
      preselect: "1-1",
    });
    expect(ext.sendNative).toHaveBeenCalledWith({
      v: 1,
      type: "list-sessions",
      pageUrl: PAGE,
      pageTitle: "Admin",
    });
  });

  it("reports when no session is running", async () => {
    native(() => ({ v: 1, ok: true, sessions: [] }));
    expect(await resolveTarget(PAGE, "")).toEqual({ kind: "none" });
  });

  it("reports a missing native host", async () => {
    vi.spyOn(ext, "sendNative").mockRejectedValue(
      new Error("No such native application claude_pointer"),
    );
    expect(await resolveTarget(PAGE, "")).toMatchObject({ kind: "no-host" });
  });

  it("reports a host error response", async () => {
    native(() => ({ v: 1, ok: false, error: { code: "unsupported-version", message: "old" } }));
    expect(await resolveTarget(PAGE, "")).toMatchObject({
      kind: "error",
      code: "unsupported-version",
    });
  });
});

describe("sendComments (US1)", () => {
  it("builds one batch and maps ok to delivered", async () => {
    const spy = native(() => ({
      v: 1,
      ok: true,
      batchId: "B",
      deliveredAt: "2026-10-06T10:00:01Z",
    }));
    const c = makeComment({ state: "draft" });
    const r = await sendComments({ pageUrl: PAGE, sessionId: "1-1", comments: [c], batchId: "B" });
    expect(r).toEqual({ ok: true, batchId: "B", deliveredAt: "2026-10-06T10:00:01Z" });
    const sent = spy.mock.calls[0]![0] as {
      type: string;
      sessionId: string;
      batch: { id: string; sessionId: string; pageUrl: string; comments: { state: string }[] };
    };
    expect(sent.type).toBe("send-batch");
    expect(sent.sessionId).toBe("1-1");
    expect(sent.batch).toMatchObject({ id: "B", sessionId: "1-1", pageUrl: PAGE });
    expect(sent.batch.comments[0]!.state).toBe("sending");
  });

  it("creates a UUID batch id when none is given", async () => {
    const spy = native((m) => ({
      v: 1,
      ok: true,
      batchId: (m as unknown as { batch: { id: string } }).batch.id,
      deliveredAt: "t",
    }));
    const r = await sendComments({ pageUrl: PAGE, sessionId: "1-1", comments: [makeComment()] });
    expect(r.ok).toBe(true);
    const id = (spy.mock.calls[0]![0] as { batch: { id: string } }).batch.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ["session-gone", "The Claude Code session has ended."],
    ["timeout", "The session did not answer in time."],
    ["too-large", "The comments are too long. Shorten them and try again."],
    ["unsupported-version", "Update the claude-pointer helper (npx claude-pointer install)."],
    ["invalid-request", "Claude Pointer sent an invalid request (this is a bug)."],
    ["internal", "Something went wrong while sending."],
  ])("maps %s to a failure message", async (code, message) => {
    native(() => ({ v: 1, ok: false, error: { code, message: "host text" } }));
    const r = await sendComments({
      pageUrl: PAGE,
      sessionId: "1-1",
      comments: [makeComment()],
      batchId: "B",
    });
    expect(r).toEqual({ ok: false, batchId: "B", code, message });
  });

  it("maps a missing native host to no-host", async () => {
    vi.spyOn(ext, "sendNative").mockRejectedValue(new Error("No such native application"));
    const r = await sendComments({
      pageUrl: PAGE,
      sessionId: "1-1",
      comments: [makeComment()],
      batchId: "B",
    });
    expect(r).toMatchObject({ ok: false, code: "no-host" });
  });

  it("refuses to send invalid comments without calling the host", async () => {
    const spy = native(() => ({}));
    const r = await sendComments({
      pageUrl: PAGE,
      sessionId: "1-1",
      comments: [makeComment({ text: "  " })],
      batchId: "B",
    });
    expect(r).toMatchObject({ ok: false, code: "invalid-request" });
    expect(spy).not.toHaveBeenCalled();
  });
});
