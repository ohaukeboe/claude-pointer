import { afterEach, describe, expect, it, vi } from "vitest";
import { Controller, type BackgroundCall } from "../../../src/content/controller";
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
afterEach(() => {
  controllers.splice(0).forEach((c) => c.stop());
  vi.useRealTimers();
});

function setup(handler: (msg: BackgroundCall) => unknown) {
  document.body.innerHTML = `<main><table id="queue" class="review"><tr><td>Vagabond</td></tr></table><a href="#x">x</a></main>`;
  const calls: BackgroundCall[] = [];
  const send = vi.fn(async (msg: BackgroundCall) => {
    calls.push(msg);
    return handler(msg);
  });
  const c = new Controller({
    doc: document,
    win: window,
    send,
    shadowMode: "open",
    raf: (cb) => (cb(0), 1),
  });
  controllers.push(c);
  const ui = () => c.overlayRoot!;
  const q = <T extends Element>(s: string) => ui().querySelector(s) as T;
  const typeAndSend = async (text: string) => {
    const t = q<HTMLTextAreaElement>("textarea");
    t.value = text;
    t.dispatchEvent(new Event("input"));
    q<HTMLButtonElement>("[data-action=send]").click();
    await vi.waitFor(() => expect(q("[data-role=status]").textContent).not.toBe("Sending…"));
  };
  const pick = (sel: string) =>
    document
      .querySelector(sel)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return { c, send, calls, q, ui, pick, typeAndSend };
}

const ready = (msg: BackgroundCall) => {
  if (msg.type === "resolve-target") return { kind: "ready", session: shelf, suggestions: [] };
  if (msg.type === "send")
    return { ok: true, batchId: msg.batchId, deliveredAt: "2026-10-06T10:00:01Z" };
  return undefined;
};

describe("Controller (US1)", () => {
  it("toggle starts and stops pick mode and restores the page completely (FR-005)", () => {
    const { c } = setup(ready);
    const before = document.documentElement.outerHTML;
    c.toggle();
    expect(c.active).toBe(true);
    expect(document.querySelector("claude-pointer-ui")).not.toBeNull();
    c.toggle();
    expect(c.active).toBe(false);
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("opens the comment box anchored to the clicked element and keeps the page from reacting", () => {
    const { c, q, pick } = setup(ready);
    const pageClick = vi.fn();
    document.querySelector("a")!.addEventListener("click", pageClick);
    c.start();
    pick("a");
    expect(pageClick).not.toHaveBeenCalled();
    expect(q(".comment-box")).not.toBeNull();
    expect(q("[data-role=label]").textContent).toBe("a");
    expect((c.overlayRoot as ShadowRoot).activeElement).toBe(q("textarea"));
  });

  it("sends one comment with element context and shows the delivery", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { c, q, calls, pick, typeAndSend } = setup(ready);
    c.start();
    pick("#queue");
    await typeAndSend("  make this denser ");
    const sendCall = calls.find((m) => m.type === "send")!;
    expect(sendCall).toMatchObject({ type: "send", pageUrl: location.href, sessionId: "1-1" });
    if (sendCall.type !== "send") throw new Error();
    expect(sendCall.comments).toHaveLength(1);
    expect(sendCall.comments[0]).toMatchObject({
      text: "make this denser",
      state: "draft",
      selection: {
        selector: "#queue",
        tag: "table",
        id: "queue",
        classes: ["review"],
        text: "Vagabond",
      },
    });
    expect(q("[data-role=status]").textContent).toBe("Delivered to shelf");
    expect(q("[data-role=status]").getAttribute("data-kind")).toBe("ok");
    vi.advanceTimersByTime(2000);
    expect(c.active).toBe(false);
  });

  it("asks which session to use on first send, then remembers it", async () => {
    const { c, q, calls, pick } = setup((msg) => {
      if (msg.type === "resolve-target")
        return {
          kind: "choose",
          preselect: "2-2",
          suggestions: [
            { session: shelf, reason: "port-owner", score: 100 },
            { session: other, reason: "recent", score: 40 },
          ],
        };
      if (msg.type === "send") return { ok: true, batchId: msg.batchId, deliveredAt: "t" };
      return undefined;
    });
    c.start();
    pick("#queue");
    const t = q<HTMLTextAreaElement>("textarea");
    t.value = "x";
    t.dispatchEvent(new Event("input"));
    q<HTMLButtonElement>("[data-action=send]").click();
    await vi.waitFor(() => expect(q(".session-chooser")).not.toBeNull());
    expect(q<HTMLInputElement>("input[value='2-2']").checked).toBe(true);
    expect(q("[data-session='1-1']").textContent).toContain("dev server");
    q<HTMLInputElement>("input[value='1-1']").dispatchEvent(new Event("change"));
    q<HTMLButtonElement>("[data-action=confirm]").click();
    await vi.waitFor(() => expect(q("[data-role=status]").textContent).toBe("Delivered to shelf"));
    expect(calls.map((m) => m.type)).toEqual(["resolve-target", "confirm-target", "send"]);
    expect(calls[1]).toMatchObject({ type: "confirm-target", session: shelf });
    expect(calls[2]).toMatchObject({ sessionId: "1-1" });
    expect(q(".session-chooser")).toBeNull();
  });

  it("cancelling the chooser keeps the comment and sends nothing", async () => {
    const { c, q, calls, pick } = setup((msg) =>
      msg.type === "resolve-target"
        ? {
            kind: "choose",
            preselect: "1-1",
            suggestions: [{ session: shelf, reason: "recent", score: 1 }],
          }
        : undefined,
    );
    c.start();
    pick("#queue");
    const t = q<HTMLTextAreaElement>("textarea");
    t.value = "keep me";
    t.dispatchEvent(new Event("input"));
    q<HTMLButtonElement>("[data-action=send]").click();
    await vi.waitFor(() => expect(q(".session-chooser")).not.toBeNull());
    q<HTMLButtonElement>("[data-action=cancel]").click();
    expect(q(".session-chooser")).toBeNull();
    expect(q<HTMLTextAreaElement>("textarea").value).toBe("keep me");
    expect(calls.map((m) => m.type)).toEqual(["resolve-target"]);
  });

  it.each([
    [{ kind: "none" }, "No Claude Code session is running"],
    [{ kind: "no-host", message: "Install the helper." }, "Install the helper."],
    [
      { kind: "error", code: "internal", message: "Something went wrong." },
      "Something went wrong.",
    ],
  ])("shows %j as an error and keeps the text", async (target, text) => {
    const { c, q, pick, typeAndSend } = setup((msg) =>
      msg.type === "resolve-target" ? target : undefined,
    );
    c.start();
    pick("#queue");
    await typeAndSend("keep");
    expect(q("[data-role=status]").textContent).toContain(text);
    expect(q("[data-role=status]").getAttribute("data-kind")).toBe("error");
    expect(q<HTMLTextAreaElement>("textarea").value).toBe("keep");
    expect(c.active).toBe(true);
  });

  it("shows a failed send and keeps the text", async () => {
    const { c, q, pick, typeAndSend } = setup((msg) => {
      if (msg.type === "resolve-target") return { kind: "ready", session: shelf, suggestions: [] };
      return {
        ok: false,
        batchId: "B",
        code: "timeout",
        message: "The session did not answer in time.",
      };
    });
    c.start();
    pick("#queue");
    await typeAndSend("keep");
    expect(q("[data-role=status]").textContent).toBe("The session did not answer in time.");
    expect(q<HTMLTextAreaElement>("textarea").value).toBe("keep");
  });

  it("retries a failed send with the same batch id (idempotent)", async () => {
    let n = 0;
    const { c, q, calls, pick, typeAndSend } = setup((msg) => {
      if (msg.type === "resolve-target") return { kind: "ready", session: shelf, suggestions: [] };
      if (msg.type === "send")
        return ++n === 1
          ? { ok: false, batchId: msg.batchId, code: "timeout", message: "t/o" }
          : { ok: true, batchId: msg.batchId, deliveredAt: "t" };
      return undefined;
    });
    c.start();
    pick("#queue");
    await typeAndSend("x");
    q<HTMLButtonElement>("[data-action=send]").click();
    await vi.waitFor(() => expect(q("[data-role=status]").textContent).toBe("Delivered to shelf"));
    const ids = calls
      .filter((m) => m.type === "send")
      .map((m) => (m.type === "send" ? m.batchId : ""));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("Escape in the comment box closes everything without sending", () => {
    const { c, q, send, pick } = setup(ready);
    c.start();
    pick("#queue");
    q("textarea").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(c.active).toBe(false);
    expect(document.querySelector("claude-pointer-ui")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("Escape with no selection ends pick mode", () => {
    const { c } = setup(ready);
    c.start();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(c.active).toBe(false);
  });

  it("outlines the hovered element with its label", () => {
    const { c, q } = setup(ready);
    c.start();
    c.picker!.setHovered(document.querySelector("#queue"));
    expect(q<HTMLElement>("[data-role=outline]").hidden).toBe(false);
    expect(q("[data-role=outline-label]").textContent).toBe("table#queue.review");
    c.picker!.setHovered(null);
    expect(q<HTMLElement>("[data-role=outline]").hidden).toBe(true);
  });

  it("uses the source probe for the label and selection when available", async () => {
    const { calls, q, typeAndSend } = setup(ready);
    const probe = vi.fn(() => ({
      component: "ReviewQueue",
      file: "src/Q.tsx",
      line: 4,
      column: 2,
      via: "react" as const,
    }));
    const c2 = new Controller({
      doc: document,
      win: window,
      send: async (m) => {
        calls.push(m);
        return ready(m);
      },
      shadowMode: "open",
      raf: (cb) => (cb(0), 1),
      probe,
    });
    controllers.push(c2);
    c2.start();
    c2.picker!.setHovered(document.querySelector("#queue"));
    expect(c2.overlayRoot!.querySelector("[data-role=outline-label]")!.textContent).toBe(
      "ReviewQueue · table#queue.review",
    );
    document
      .querySelector("#queue")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const t = c2.overlayRoot!.querySelector("textarea") as HTMLTextAreaElement;
    t.value = "x";
    t.dispatchEvent(new Event("input"));
    (c2.overlayRoot!.querySelector("[data-action=send]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.some((m) => m.type === "send")).toBe(true));
    const s = calls.find((m) => m.type === "send");
    expect(s?.type === "send" && s.comments[0]!.selection.source?.component).toBe("ReviewQueue");
    void q;
    void typeAndSend;
  });
});
