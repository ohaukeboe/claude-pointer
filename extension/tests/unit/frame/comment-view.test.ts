import { describe, expect, it, vi } from "vitest";
import { acceptPort, createCommentView } from "../../../src/frame/comment-view";
import type { FrameMessage, ViewMessage } from "../../../src/frame/protocol";

/** A mounted view on one end of a real channel; the test plays the content script. */
async function view(init: Partial<Extract<ViewMessage, { type: "init" }>> = {}) {
  const { port1, port2 } = new MessageChannel();
  const out: FrameMessage[] = [];
  port1.onmessage = (e: MessageEvent<FrameMessage>) => out.push(e.data);
  const mount = document.createElement("div");
  document.body.append(mount);
  createCommentView(port2, document, mount);
  const post = (m: ViewMessage) => port1.postMessage(m);
  post({ type: "init", label: "table.queue", allowAdd: false, canDelete: false, ...init });
  await vi.waitFor(() => expect(mount.querySelector("textarea")).not.toBeNull());
  const q = <T extends Element>(s: string) => mount.querySelector(s) as T;
  const textarea = q<HTMLTextAreaElement>("textarea");
  const sent = (type: FrameMessage["type"]) =>
    vi.waitFor(() => {
      const m = out.find((o) => o.type === type);
      expect(m).toBeDefined();
      return m!;
    });
  return { mount, out, post, q, textarea, sent };
}

function type(t: HTMLTextAreaElement, value: string) {
  t.value = value;
  t.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("comment view (in the extension frame)", () => {
  it("sends trimmed text over the port", async () => {
    const { textarea, q, sent } = await view();
    type(textarea, "  denser  ");
    q<HTMLButtonElement>("[data-action=send]").click();
    expect(await sent("send")).toEqual({ type: "send", text: "denser" });
  });

  it("opens with a focused textarea and the element label", async () => {
    const { textarea, q } = await view();
    expect(q("[data-role=label]").textContent).toBe("table.queue");
    expect(document.activeElement).toBe(textarea);
  });

  it("disables Send to Claude for empty or whitespace text (FR-007)", async () => {
    const { textarea, q } = await view();
    const send = q<HTMLButtonElement>("[data-action=send]");
    expect(send.textContent).toBe("Send to Claude");
    expect(send.disabled).toBe(true);
    type(textarea, "   \n ");
    expect(send.disabled).toBe(true);
    type(textarea, " make it denser ");
    expect(send.disabled).toBe(false);
  });

  it("sends with Ctrl+Enter", async () => {
    const { textarea, sent } = await view();
    type(textarea, "x");
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
    );
    expect(await sent("send")).toEqual({ type: "send", text: "x" });
  });

  it("blocks text over 10 000 chars with a message", async () => {
    const { textarea, q } = await view();
    type(textarea, "a".repeat(10_001));
    expect(q<HTMLButtonElement>("[data-action=send]").disabled).toBe(true);
    expect(q("[data-role=status]").textContent).toContain("10 001 / 10 000");
    type(textarea, "a".repeat(10_000));
    expect(q<HTMLButtonElement>("[data-action=send]").disabled).toBe(false);
  });

  it("asks to close on Escape and on the close control without sending", async () => {
    const { textarea, q, out } = await view();
    type(textarea, "draft");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    q<HTMLButtonElement>("[data-action=close]").click();
    await vi.waitFor(() => expect(out.filter((m) => m.type === "close")).toHaveLength(2));
    expect(out.some((m) => m.type === "send")).toBe(false);
  });

  it("hides Add comment unless allowed, and uses the given label", async () => {
    expect((await view()).q<HTMLButtonElement>("[data-action=add]").hidden).toBe(true);
    const { textarea, q, sent } = await view({ allowAdd: true, addLabel: "Save" });
    const add = q<HTMLButtonElement>("[data-action=add]");
    expect(add.hidden).toBe(false);
    expect(add.textContent).toBe("Save");
    type(textarea, " note ");
    add.click();
    expect(await sent("add")).toEqual({ type: "add", text: "note" });
  });

  it("shows Delete only when deleting is possible", async () => {
    expect((await view()).q<HTMLButtonElement>("[data-action=delete]").hidden).toBe(true);
    const { q, sent } = await view({ canDelete: true });
    q<HTMLButtonElement>("[data-action=delete]").click();
    expect(await sent("delete")).toEqual({ type: "delete" });
  });

  it("shows status and disables controls while busy", async () => {
    const { textarea, q, post } = await view();
    type(textarea, "x");
    post({ type: "busy", busy: true });
    post({ type: "status", kind: "info", text: "Sending…" });
    await vi.waitFor(() => expect(q("[data-role=status]").textContent).toBe("Sending…"));
    expect(q<HTMLButtonElement>("[data-action=send]").disabled).toBe(true);
    expect(textarea.readOnly).toBe(true);
    post({ type: "busy", busy: false });
    post({ type: "status", kind: "error", text: "Session ended" });
    await vi.waitFor(() => expect(q("[data-role=status]").getAttribute("data-kind")).toBe("error"));
    expect(q<HTMLButtonElement>("[data-action=send]").disabled).toBe(false);
    expect(textarea.readOnly).toBe(false);
  });

  it("keeps initial text (retry after failure)", async () => {
    const { textarea, q } = await view({ initialText: "kept" });
    expect(textarea.value).toBe("kept");
    expect(q<HTMLButtonElement>("[data-action=send]").disabled).toBe(false);
  });

  it("focuses the textarea on request", async () => {
    const { textarea, post } = await view();
    textarea.blur();
    post({ type: "focus" });
    await vi.waitFor(() => expect(document.activeElement).toBe(textarea));
  });

  it("reports its height on open and when the status changes it", async () => {
    let height = 180.4;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() =>
      DOMRect.fromRect({ width: 400, height }),
    );
    const { out, post } = await view();
    await vi.waitFor(() => expect(out).toContainEqual({ type: "size", height: 181 }));
    height = 220;
    post({ type: "status", kind: "error", text: "Session ended" });
    await vi.waitFor(() => expect(out).toContainEqual({ type: "size", height: 220 }));
  });
});

describe("frame handshake", () => {
  const offer = (data: unknown, port?: MessagePort) =>
    window.dispatchEvent(new MessageEvent("message", { data, ports: port ? [port] : [] }));

  it("takes the port only from a handshake with the nonce in its URL", async () => {
    const accepted = acceptPort(window, "n0nce");
    const page = new MessageChannel();
    const ours = new MessageChannel();
    offer({ type: "claude-pointer-init", nonce: "guess" }, page.port2);
    offer({ type: "claude-pointer-init", nonce: "n0nce" });
    offer({ type: "claude-pointer-init", nonce: "n0nce" }, ours.port2);
    expect(await accepted).toBe(ours.port2);
  });

  it("ignores later handshakes once a port is taken", async () => {
    const listen = vi.spyOn(window, "removeEventListener");
    const accepted = acceptPort(window, "n0nce");
    offer({ type: "claude-pointer-init", nonce: "n0nce" }, new MessageChannel().port2);
    await accepted;
    expect(listen).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("never accepts without a nonce", async () => {
    const accepted = acceptPort(window, "");
    const settled = vi.fn();
    void accepted.then(settled);
    offer({ type: "claude-pointer-init", nonce: "" }, new MessageChannel().port2);
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).not.toHaveBeenCalled();
  });
});
