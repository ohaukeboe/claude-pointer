import { describe, expect, it, vi } from "vitest";
import { createCommentBox, positionBox } from "../../../src/content/overlay/comment-box";
import { createOverlay } from "../../../src/content/overlay/root";

const anchor = { left: 100, top: 100, width: 200, height: 50 };

function box(over: Partial<Parameters<typeof createCommentBox>[0]> = {}) {
  const overlay = createOverlay(document, "open");
  const onSend = vi.fn();
  const onAdd = vi.fn();
  const onClose = vi.fn();
  const b = createCommentBox({
    anchor,
    label: "table.queue",
    allowAdd: false,
    onSend,
    onAdd,
    onClose,
    ...over,
  });
  overlay.layer.append(b.el);
  const q = <T extends Element>(s: string) => b.el.querySelector(s) as T;
  return { overlay, b, onSend, onAdd, onClose, q };
}

function type(t: HTMLTextAreaElement, value: string) {
  t.value = value;
  t.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("comment box", () => {
  it("opens with a focused textarea and the element label", () => {
    const { b, q } = box();
    expect(b.textarea).toBe(q("textarea"));
    expect(b.el.getRootNode()).toBeInstanceOf(ShadowRoot);
    expect(q("[data-role=label]").textContent).toBe("table.queue");
    b.focus();
    expect((b.el.getRootNode() as ShadowRoot).activeElement).toBe(b.textarea);
  });

  it("disables Send to Claude for empty or whitespace text (FR-007)", () => {
    const { b, q } = box();
    const send = q<HTMLButtonElement>("[data-action=send]");
    expect(send.textContent).toBe("Send to Claude");
    expect(send.disabled).toBe(true);
    type(b.textarea, "   \n ");
    expect(send.disabled).toBe(true);
    type(b.textarea, " make it denser ");
    expect(send.disabled).toBe(false);
    send.click();
    expect(b.textarea.value).toBe(" make it denser ");
  });

  it("sends trimmed text", () => {
    const { b, q, onSend } = box();
    type(b.textarea, "  denser  ");
    q<HTMLButtonElement>("[data-action=send]").click();
    expect(onSend).toHaveBeenCalledWith("denser");
  });

  it("sends with Ctrl+Enter", () => {
    const { b, onSend } = box();
    type(b.textarea, "x");
    b.textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
    );
    expect(onSend).toHaveBeenCalledWith("x");
  });

  it("blocks text over 10 000 chars with a message", () => {
    const { b, q } = box();
    type(b.textarea, "a".repeat(10_001));
    expect(q<HTMLButtonElement>("[data-action=send]").disabled).toBe(true);
    expect(q("[data-role=status]").textContent).toContain("10 001 / 10 000");
    type(b.textarea, "a".repeat(10_000));
    expect(q<HTMLButtonElement>("[data-action=send]").disabled).toBe(false);
  });

  it("closes on Escape and on the close control without sending", () => {
    const { b, q, onClose, onSend } = box();
    type(b.textarea, "draft");
    b.textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    q<HTMLButtonElement>("[data-action=close]").click();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("hides Add comment unless allowed", () => {
    expect(box().q<HTMLButtonElement>("[data-action=add]").hidden).toBe(true);
    const { b, q, onAdd } = box({ allowAdd: true });
    const add = q<HTMLButtonElement>("[data-action=add]");
    expect(add.hidden).toBe(false);
    expect(add.textContent).toBe("Add comment");
    type(b.textarea, " note ");
    add.click();
    expect(onAdd).toHaveBeenCalledWith("note");
  });

  it("shows status and disables controls while busy", () => {
    const { b, q } = box();
    type(b.textarea, "x");
    b.setBusy(true);
    b.setStatus("info", "Sending…");
    expect(q<HTMLButtonElement>("[data-action=send]").disabled).toBe(true);
    expect(b.textarea.readOnly).toBe(true);
    expect(q("[data-role=status]").textContent).toBe("Sending…");
    b.setBusy(false);
    b.setStatus("error", "Session ended");
    expect(q("[data-role=status]").getAttribute("data-kind")).toBe("error");
    expect(q<HTMLButtonElement>("[data-action=send]").disabled).toBe(false);
  });

  it("keeps initial text (retry after failure)", () => {
    const { b, q } = box({ initialText: "kept" });
    expect(b.textarea.value).toBe("kept");
    expect(q<HTMLButtonElement>("[data-action=send]").disabled).toBe(false);
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
    const { b } = box();
    const page = vi.fn();
    document.addEventListener("keydown", page);
    window.addEventListener("input", page);
    b.textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", bubbles: true, composed: true }),
    );
    b.textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    expect(page).not.toHaveBeenCalled();
    document.removeEventListener("keydown", page);
    window.removeEventListener("input", page);
  });
});
