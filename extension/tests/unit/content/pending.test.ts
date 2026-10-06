import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingStore, pendingKey } from "../../../src/content/pending";
import { Controller, type BackgroundCall } from "../../../src/content/controller";
import { ext } from "../../../src/lib/browser";
import { makeComment, makeSelection } from "../../../../shared/fixtures";
import type { Session } from "../../../../shared/types";

const shelf: Session = {
  id: "1-1",
  projectDir: "/p/shelf",
  projectName: "shelf",
  startedAt: "2026-10-06T10:00:00Z",
};

describe("pendingKey", () => {
  it("is origin + pathname (ignores query and hash)", () => {
    expect(pendingKey("http://localhost:5173/admin?x=1#y")).toBe(
      "pending:http://localhost:5173/admin",
    );
  });
});

describe("PendingStore", () => {
  const url = "http://localhost:5173/admin";

  it("adds comments as pending in creation order", async () => {
    const s = new PendingStore(url);
    await s.add(makeComment({ id: "a", state: "draft" }));
    await s.add(makeComment({ id: "b" }));
    const list = await s.list();
    expect(list.map((c) => [c.id, c.state])).toEqual([
      ["a", "pending"],
      ["b", "pending"],
    ]);
    expect(await ext.storageGet(pendingKey(url))).toHaveLength(2);
  });

  it("edits text and deletes", async () => {
    const s = new PendingStore(url);
    await s.add(makeComment({ id: "a" }));
    await s.add(makeComment({ id: "b" }));
    await s.update("a", "new text");
    await s.remove("b");
    expect((await s.list()).map((c) => [c.id, c.text])).toEqual([["a", "new text"]]);
  });

  it("marks entries failed with the error and clears after success", async () => {
    const s = new PendingStore(url);
    await s.add(makeComment({ id: "a" }));
    await s.markFailed(["a"], "ended");
    expect(await s.list()).toMatchObject([{ id: "a", state: "failed", error: "ended" }]);
    await s.clear();
    expect(await s.list()).toEqual([]);
    expect(await ext.storageGet(pendingKey(url))).toBeUndefined();
  });

  it("is separate per page path", async () => {
    await new PendingStore(url).add(makeComment({ id: "a" }));
    expect(await new PendingStore("http://localhost:5173/other").list()).toEqual([]);
  });
});

describe("Controller with pending comments (US3)", () => {
  const controllers: Controller[] = [];
  afterEach(() => controllers.splice(0).forEach((c) => c.stop()));

  function setup(handler: (m: BackgroundCall) => unknown = () => undefined) {
    document.body.innerHTML = `<h1 id="a">A</h1><p id="b">B</p><button id="c">C</button>`;
    const calls: BackgroundCall[] = [];
    const c = new Controller({
      doc: document,
      win: window,
      shadowMode: "open",
      raf: (cb) => (cb(0), 1),
      send: async (m) => {
        calls.push(m);
        return handler(m);
      },
    });
    controllers.push(c);
    const q = <T extends Element>(s: string) => c.overlayRoot!.querySelector(s) as T;
    const qa = (s: string) => Array.from(c.overlayRoot!.querySelectorAll(s));
    const write = (text: string) => {
      const t = q<HTMLTextAreaElement>("textarea");
      t.value = text;
      t.dispatchEvent(new Event("input"));
    };
    const pick = (sel: string) =>
      document
        .querySelector(sel)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return { c, calls, q, qa, write, pick };
  }

  const ok = (m: BackgroundCall) =>
    m.type === "resolve-target"
      ? { kind: "ready", session: shelf, suggestions: [] }
      : m.type === "send"
        ? { ok: true, batchId: m.batchId, deliveredAt: "t" }
        : undefined;

  it("Add comment stores a pending comment, shows a numbered marker and continues picking", async () => {
    const { c, q, qa, write, pick } = setup(ok);
    await c.start();
    pick("#a");
    expect(q<HTMLButtonElement>("[data-action=add]").hidden).toBe(false);
    write("first");
    q<HTMLButtonElement>("[data-action=add]").click();
    await vi.waitFor(() => expect(qa(".marker")).toHaveLength(1));
    expect(q(".comment-box")).toBeNull();
    expect(q(".marker").textContent).toBe("1");
    pick("#b");
    write("second");
    q<HTMLButtonElement>("[data-action=add]").click();
    await vi.waitFor(() => expect(qa(".marker").map((m) => m.textContent)).toEqual(["1", "2"]));
    expect(c.active).toBe(true);
    expect((await new PendingStore(location.href).list()).map((x) => x.text)).toEqual([
      "first",
      "second",
    ]);
  });

  it("restores markers after reload by re-resolving selectors; hides unresolvable ones with a notice", async () => {
    const store = new PendingStore(location.href);
    document.body.innerHTML = `<h1 id="a">A</h1>`;
    await store.add(
      makeComment({ id: "x", text: "on a", selection: makeSelection({ selector: "#a" }) }),
    );
    await store.add(
      makeComment({ id: "y", text: "gone", selection: makeSelection({ selector: "#missing" }) }),
    );
    const { c, qa, q } = setup(ok);
    document.body.innerHTML = `<h1 id="a">A</h1>`;
    await c.start();
    expect(qa(".marker").map((m) => (m as HTMLElement).hidden)).toEqual([false, true]);
    expect(q("[data-role=notice]").textContent).toBe(
      "1 pending comment could not be placed on this page; it will still be sent.",
    );
  });

  it("clicking a marker lets the user edit or delete that comment", async () => {
    const { c, q, qa, write, pick } = setup(ok);
    await c.start();
    pick("#a");
    write("first");
    q<HTMLButtonElement>("[data-action=add]").click();
    await vi.waitFor(() => expect(qa(".marker")).toHaveLength(1));
    (q(".marker") as HTMLElement).click();
    expect(q<HTMLTextAreaElement>("textarea").value).toBe("first");
    expect(q<HTMLButtonElement>("[data-action=add]").textContent).toBe("Save");
    write("edited");
    q<HTMLButtonElement>("[data-action=add]").click();
    await vi.waitFor(async () =>
      expect((await new PendingStore(location.href).list())[0]!.text).toBe("edited"),
    );
    (q(".marker") as HTMLElement).click();
    q<HTMLButtonElement>("[data-action=delete]").click();
    await vi.waitFor(() => expect(qa(".marker")).toHaveLength(0));
    expect(await new PendingStore(location.href).list()).toEqual([]);
  });

  it("Send to Claude sends all pending comments plus the draft as one batch, then clears markers", async () => {
    const { c, q, qa, write, pick, calls } = setup(ok);
    await c.start();
    pick("#a");
    write("one");
    q<HTMLButtonElement>("[data-action=add]").click();
    await vi.waitFor(() => expect(qa(".marker")).toHaveLength(1));
    pick("#b");
    write("two");
    q<HTMLButtonElement>("[data-action=add]").click();
    await vi.waitFor(() => expect(qa(".marker")).toHaveLength(2));
    pick("#c");
    write("three");
    q<HTMLButtonElement>("[data-action=send]").click();
    await vi.waitFor(() => expect(q("[data-role=status]").textContent).toBe("Delivered to shelf"));
    const send = calls.find(
      (m): m is Extract<BackgroundCall, { type: "send" }> => m.type === "send",
    )!;
    expect(send.comments.map((x) => x.text)).toEqual(["one", "two", "three"]);
    expect(send.comments.map((x) => x.selection.selector)).toEqual(["#a", "#b", "#c"]);
    expect(qa(".marker")).toHaveLength(0);
    expect(await new PendingStore(location.href).list()).toEqual([]);
  });

  it("Send from an edited marker sends all pending without duplicating it", async () => {
    const { c, q, qa, write, pick, calls } = setup(ok);
    await c.start();
    pick("#a");
    write("one");
    q<HTMLButtonElement>("[data-action=add]").click();
    await vi.waitFor(() => expect(qa(".marker")).toHaveLength(1));
    (q(".marker") as HTMLElement).click();
    write("one!");
    q<HTMLButtonElement>("[data-action=send]").click();
    await vi.waitFor(() => expect(calls.some((m) => m.type === "send")).toBe(true));
    const send = calls.find(
      (m): m is Extract<BackgroundCall, { type: "send" }> => m.type === "send",
    )!;
    expect(send.comments.map((x) => x.text)).toEqual(["one!"]);
  });

  it("keeps pending comments as failed when sending fails", async () => {
    const { c, q, qa, write, pick } = setup((m) =>
      m.type === "resolve-target"
        ? { kind: "ready", session: shelf, suggestions: [] }
        : m.type === "send"
          ? {
              ok: false,
              batchId: m.batchId,
              code: "timeout",
              message: "The session did not answer in time.",
            }
          : undefined,
    );
    await c.start();
    pick("#a");
    write("one");
    q<HTMLButtonElement>("[data-action=add]").click();
    await vi.waitFor(() => expect(qa(".marker")).toHaveLength(1));
    pick("#b");
    write("two");
    q<HTMLButtonElement>("[data-action=send]").click();
    await vi.waitFor(() =>
      expect(q("[data-role=status]").textContent).toBe("The session did not answer in time."),
    );
    const stored = await new PendingStore(location.href).list();
    expect(stored.map((x) => [x.text, x.state])).toEqual([
      ["one", "failed"],
      ["two", "failed"],
    ]);
    expect(qa(".marker").map((m) => m.getAttribute("data-state"))).toEqual(["failed", "failed"]);
  });
});
