import { describe, expect, it, vi } from "vitest";
import {
  createCommentBox,
  positionBox,
  type CommentBoxOptions,
} from "../../../src/content/overlay/comment-box";
import type { FrameMessage, ViewMessage } from "../../../src/frame/protocol";
import { createOverlay } from "../../../src/content/overlay/root";

const anchor = { left: 100, top: 100, width: 200, height: 50 };
const FRAME_URL = "moz-extension://6d1f3c52/comment-frame.html";

/** A box whose frame is faked: the test plays the frame on the other end of the port. */
function box(over: Partial<CommentBoxOptions> = {}) {
  const onSend = vi.fn();
  const onAdd = vi.fn();
  const onClose = vi.fn();
  const b = createCommentBox(
    { anchor, label: "table.queue", allowAdd: false, onSend, onAdd, onClose, ...over },
    document,
    FRAME_URL,
  );
  const frame = b.el as HTMLIFrameElement;
  const postMessage = vi.fn();
  Object.defineProperty(frame, "contentWindow", { value: { postMessage } });
  const got: ViewMessage[] = [];
  let port: MessagePort | null = null;
  /** Fire the frame's load event and take the port the box hands over. */
  const load = async () => {
    frame.dispatchEvent(new Event("load"));
    const call = postMessage.mock.calls.at(-1)!;
    port = (call[2] as MessagePort[])[0]!;
    port.onmessage = (e: MessageEvent<ViewMessage>) => got.push(e.data);
    await vi.waitFor(() => expect(got.length).toBeGreaterThan(0));
    return call;
  };
  const reply = (m: FrameMessage) => port!.postMessage(m);
  return { b, frame, postMessage, load, got, reply, onSend, onAdd, onClose };
}

describe("comment box (content side)", () => {
  it("is an iframe on the extension's frame page with a secret nonce", () => {
    const { frame } = box();
    expect(frame.localName).toBe("iframe");
    const url = new URL(frame.src);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(FRAME_URL);
    expect(url.hash.length).toBeGreaterThan(16);
    expect(box().frame.src).not.toBe(frame.src);
  });

  it("hands its port only to the extension origin, with the nonce, then sends init", async () => {
    const { frame, load, got } = box({ initialText: "kept", allowAdd: true, addLabel: "Save" });
    const [data, targetOrigin, transfer] = await load();
    expect(targetOrigin).toBe("moz-extension://6d1f3c52");
    expect(data).toEqual({ type: "claude-pointer-init", nonce: new URL(frame.src).hash.slice(1) });
    expect(transfer).toHaveLength(1);
    expect(got[0]).toEqual({
      type: "init",
      label: "table.queue",
      allowAdd: true,
      addLabel: "Save",
      canDelete: false,
      initialText: "kept",
    });
  });

  it("turns frame messages into callbacks", async () => {
    const onDelete = vi.fn();
    const { load, reply, onSend, onAdd, onClose } = box({ onDelete });
    await load();
    reply({ type: "send", text: "denser" });
    reply({ type: "add", text: "note" });
    reply({ type: "delete" });
    reply({ type: "close" });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith("denser");
    expect(onAdd).toHaveBeenCalledWith("note");
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("forwards busy, status and focus to the frame", async () => {
    const { b, load, got } = box();
    await load();
    b.setBusy(true);
    b.setStatus("error", "Session ended");
    b.focus();
    await vi.waitFor(() => expect(got).toHaveLength(4));
    expect(got.slice(1)).toEqual([
      { type: "busy", busy: true },
      { type: "status", kind: "error", text: "Session ended" },
      { type: "focus" },
    ]);
  });

  it("sizes the frame to its content within the viewport and repositions it", async () => {
    const { frame, load, reply } = box({
      anchor: { left: 100, top: 650, width: 200, height: 100 },
    });
    vi.spyOn(frame, "getBoundingClientRect").mockImplementation(() =>
      DOMRect.fromRect({ width: 400, height: parseFloat(frame.style.height) || 0 }),
    );
    await load();
    reply({ type: "size", height: 200 });
    await vi.waitFor(() => expect(frame.style.height).toBe("200px"));
    expect(frame.style.top).toBe(`${650 - 8 - 200}px`);
    reply({ type: "size", height: 5000 });
    await vi.waitFor(() => expect(frame.style.height).toBe(`${window.innerHeight - 16}px`));
  });

  it("closes if the frame is navigated away from our page", async () => {
    const { frame, load, onClose } = box();
    await load();
    frame.dispatchEvent(new Event("load"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("positionBox", () => {
  const vp = { width: 1280, height: 800 };
  const size = { width: 400, height: 200 };

  it("places the box below the element when there is room", () => {
    expect(positionBox({ left: 100, top: 100, width: 200, height: 50 }, size, vp)).toEqual({
      left: 100,
      top: 158,
    });
  });

  it("places it above when there is no room below", () => {
    expect(positionBox({ left: 100, top: 650, width: 200, height: 100 }, size, vp)).toEqual({
      left: 100,
      top: 442,
    });
  });

  it("clamps into the viewport when neither fits (huge element)", () => {
    expect(positionBox({ left: -50, top: -100, width: 2000, height: 2000 }, size, vp)).toEqual({
      left: 8,
      top: 592,
    });
  });

  it("clamps horizontally at the right edge and on narrow screens", () => {
    expect(positionBox({ left: 1200, top: 10, width: 50, height: 20 }, size, vp).left).toBe(872);
    expect(
      positionBox(
        { left: 100, top: 10, width: 50, height: 20 },
        { width: 304, height: 200 },
        { width: 320, height: 640 },
      ).left,
    ).toBe(8);
  });
});

describe("overlay root", () => {
  it("isolates UI in a shadow root on one host element and removes it on destroy", () => {
    const before = document.body.childElementCount;
    const o = createOverlay(document, "open");
    expect(document.documentElement.contains(o.host)).toBe(true);
    expect(o.host.shadowRoot).toBe(o.root);
    expect(o.contains(o.layer)).toBe(true);
    expect(o.contains(document.body)).toBe(false);
    o.destroy();
    expect(document.documentElement.contains(o.host)).toBe(false);
    expect(document.body.childElementCount).toBe(before);
  });

  it("uses a closed shadow root by default", () => {
    const o = createOverlay(document);
    expect(o.host.shadowRoot).toBeNull();
    o.destroy();
  });
});

describe("keyboard isolation", () => {
  it("does not let typing in the UI bubble to page handlers", () => {
    const o = createOverlay(document, "open");
    const input = document.createElement("input");
    o.layer.append(input);
    const page = vi.fn();
    document.addEventListener("keydown", page);
    window.addEventListener("input", page);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true, composed: true }));
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    expect(page).not.toHaveBeenCalled();
    document.removeEventListener("keydown", page);
    window.removeEventListener("input", page);
    o.destroy();
  });
});
