import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Controller,
  NO_SESSION_MESSAGE,
  STALE_BINDING_MESSAGE,
  type BackgroundCall,
} from "../../../src/content/controller";
import type { Session } from "../../../../shared/types";

const shelf: Session = {
  id: "1-1",
  projectDir: "/p/shelf",
  projectName: "shelf",
  startedAt: "2026-10-06T10:00:00Z",
};
const other: Session = {
  id: "2-2",
  projectDir: "/p/other",
  projectName: "other",
  startedAt: "2026-10-06T09:00:00Z",
};

const controllers: Controller[] = [];
afterEach(() => controllers.splice(0).forEach((c) => c.stop()));

function setup(handler: (msg: BackgroundCall, n: number) => unknown) {
  document.body.innerHTML = `<p id="t">x</p>`;
  const calls: BackgroundCall[] = [];
  const c = new Controller({
    doc: document,
    win: window,
    shadowMode: "open",
    raf: (cb) => (cb(0), 1),
    send: async (m) => {
      calls.push(m);
      return handler(m, calls.length);
    },
  });
  controllers.push(c);
  c.start();
  document
    .querySelector("#t")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  const q = <T extends Element>(s: string) => c.overlayRoot!.querySelector(s) as T;
  const t = q<HTMLTextAreaElement>("textarea");
  t.value = "keep this";
  t.dispatchEvent(new Event("input"));
  q<HTMLButtonElement>("[data-action=send]").click();
  return { c, calls, q };
}

describe("recovery when the session ended (FR-016, SC-006)", () => {
  it("keeps the comment, re-opens the chooser and retries with the same batch id", async () => {
    let resolves = 0;
    const { calls, q } = setup((m) => {
      if (m.type === "resolve-target") {
        resolves++;
        return resolves === 1
          ? { kind: "ready", session: shelf, suggestions: [] }
          : {
              kind: "choose",
              preselect: "2-2",
              suggestions: [{ session: other, reason: "recent", score: 49 }],
            };
      }
      if (m.type === "send" && m.sessionId === "1-1")
        return {
          ok: false,
          batchId: m.batchId,
          code: "session-gone",
          message: "The Claude Code session has ended.",
        };
      if (m.type === "send") return { ok: true, batchId: m.batchId, deliveredAt: "t" };
      return undefined;
    });
    await vi.waitFor(() => expect(q(".session-chooser")).not.toBeNull());
    expect(q("[data-role=hint]").textContent).toBe("That session has ended. Choose another one:");
    q<HTMLButtonElement>("[data-action=confirm]").click();
    await vi.waitFor(() => expect(q("[data-role=status]").textContent).toBe("Delivered to other"));
    const sends = calls.filter(
      (m): m is Extract<BackgroundCall, { type: "send" }> => m.type === "send",
    );
    expect(sends.map((m) => m.sessionId)).toEqual(["1-1", "2-2"]);
    expect(sends[0]!.batchId).toBe(sends[1]!.batchId);
    expect(sends[1]!.comments[0]!.text).toBe("keep this");
  });

  it("says no session is available when none is left, and keeps the text", async () => {
    let resolves = 0;
    const { q } = setup((m) => {
      if (m.type === "resolve-target")
        return ++resolves === 1
          ? { kind: "ready", session: shelf, suggestions: [] }
          : { kind: "none" };
      return { ok: false, batchId: "b", code: "session-gone", message: "ended" };
    });
    await vi.waitFor(() =>
      expect(q("[data-role=status]").textContent).toContain(NO_SESSION_MESSAGE),
    );
    expect(q<HTMLTextAreaElement>("textarea").value).toBe("keep this");
  });

  it("with no session running at all, shows the message and keeps the text (US2 scenario 3)", async () => {
    const { q, calls } = setup((m) => (m.type === "resolve-target" ? { kind: "none" } : undefined));
    await vi.waitFor(() => expect(q("[data-role=status]").textContent).toBe(NO_SESSION_MESSAGE));
    expect(q<HTMLTextAreaElement>("textarea").value).toBe("keep this");
    expect(calls.some((m) => m.type === "send")).toBe(false);
  });
});

describe("chooser keeps the session list fresh (FR-012)", () => {
  it("re-queries sessions every 2 s while open and stops when closed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let listed = 0;
    const { q, c } = setup((m) => {
      if (m.type === "resolve-target")
        return {
          kind: "choose",
          preselect: "1-1",
          suggestions: [{ session: shelf, reason: "recent", score: 49 }],
        };
      if (m.type === "list-sessions") {
        listed++;
        return {
          ok: true,
          sessions: [
            { session: shelf, reason: "recent", score: 49 },
            { session: other, reason: "recent", score: 48 },
          ],
        };
      }
      return undefined;
    });
    await vi.waitFor(() => expect(q(".session-chooser")).not.toBeNull());
    expect(c.overlayRoot!.querySelectorAll(".sessions li")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(listed).toBe(1);
    expect(c.overlayRoot!.querySelectorAll(".sessions li")).toHaveLength(2);
    expect(q<HTMLInputElement>("input[value='1-1']").checked).toBe(true);
    q<HTMLButtonElement>("[data-action=cancel]").click();
    await vi.advanceTimersByTimeAsync(6000);
    expect(listed).toBe(1);
    vi.useRealTimers();
  });
});

describe("stale binding", () => {
  it("explains that the chosen session ended before asking", async () => {
    const { q } = setup((m) =>
      m.type === "resolve-target"
        ? {
            kind: "choose",
            stale: true,
            preselect: "2-2",
            suggestions: [{ session: other, reason: "recent", score: 49 }],
          }
        : undefined,
    );
    await vi.waitFor(() => expect(q(".session-chooser")).not.toBeNull());
    expect(q("[data-role=hint]").textContent).toBe(STALE_BINDING_MESSAGE);
  });
});

describe("a single failed comment is kept even if the box is closed (SC-006)", () => {
  it("stores the failed draft as a pending comment", async () => {
    const { PendingStore } = await import("../../../src/content/pending");
    const { q, c } = setup((m) =>
      m.type === "resolve-target"
        ? { kind: "ready", session: shelf, suggestions: [] }
        : {
            ok: false,
            batchId: "b",
            code: "timeout",
            message: "The session did not answer in time.",
          },
    );
    await vi.waitFor(() =>
      expect(q("[data-role=status]").textContent).toBe("The session did not answer in time."),
    );
    c.stop();
    const stored = await new PendingStore(location.href).list();
    expect(stored.map((x) => [x.text, x.state])).toEqual([["keep this", "failed"]]);
  });
});
