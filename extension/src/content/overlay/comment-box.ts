// Comment box anchored to the selected element (FR-006, FR-007).

import {
  FRAME_PAGE,
  type FrameHandshake,
  type FrameMessage,
  type ViewMessage,
} from "../../frame/protocol";
import { h } from "./root";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const GAP = 8;

/** Below the element if it fits, else above, else pinned inside the viewport. */
export function positionBox(
  anchor: Box,
  size: { width: number; height: number },
  vp: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.max(GAP, Math.min(anchor.left, vp.width - size.width - GAP));
  const below = anchor.top + anchor.height + GAP;
  if (below + size.height + GAP <= vp.height && below >= GAP) return { left, top: below };
  const above = anchor.top - GAP - size.height;
  if (above >= GAP && above + size.height <= vp.height) return { left, top: above };
  return { left, top: Math.max(GAP, vp.height - size.height - GAP) };
}

export interface CommentBoxOptions {
  anchor: Box;
  label: string;
  allowAdd: boolean;
  initialText?: string;
  /** Label of the secondary button: "Add comment" (new) or "Save" (editing a pending one). */
  addLabel?: string;
  /** When set, a Delete button is shown (editing a pending comment). */
  onDelete?: () => void;
  onSend(text: string): void;
  onAdd(text: string): void;
  onClose(): void;
}

export interface CommentBox {
  el: HTMLElement;
  focus(): void;
  setBusy(busy: boolean): void;
  setStatus(kind: "info" | "ok" | "error", text: string): void;
  reposition(anchor: Box): void;
  destroy(): void;
}

/**
 * The box lives in an extension-origin iframe, so page listeners (even capture-phase ones on
 * window) never see what the user types. We talk to it over a private MessagePort.
 */
export function createCommentBox(
  o: CommentBoxOptions,
  doc: Document = document,
  frameUrl: string = browser.runtime.getURL(FRAME_PAGE),
): CommentBox {
  const nonce = crypto.randomUUID();
  const frame = h(doc, "iframe", {
    class: "comment-frame comment-box",
    src: `${frameUrl}#${nonce}`,
    title: "Comment on element",
  });
  const { port1: port, port2 } = new MessageChannel();
  const post = (m: ViewMessage) => port.postMessage(m);
  let anchor = o.anchor;
  let loaded = false;

  frame.addEventListener("load", () => {
    // A second load means something navigated the frame away from our page: give up.
    if (loaded) {
      o.onClose();
      return;
    }
    loaded = true;
    const handshake: FrameHandshake = { type: "claude-pointer-init", nonce };
    // URL.origin is "null" for moz-extension: in some engines; never post to that.
    const { protocol, host } = new URL(frameUrl);
    frame.contentWindow?.postMessage(handshake, `${protocol}//${host}`, [port2]);
  });
  port.onmessage = (e: MessageEvent<FrameMessage>) => {
    const m = e.data;
    switch (m.type) {
      case "send":
        o.onSend(m.text);
        return;
      case "add":
        o.onAdd(m.text);
        return;
      case "delete":
        o.onDelete?.();
        return;
      case "close":
        o.onClose();
        return;
      case "size":
        frame.style.height = `${Math.min(m.height, window.innerHeight - 2 * GAP)}px`;
        reposition(anchor);
        return;
    }
  };
  post({
    type: "init",
    label: o.label,
    allowAdd: o.allowAdd,
    addLabel: o.addLabel,
    canDelete: !!o.onDelete,
    initialText: o.initialText,
  });

  const reposition = (next: Box) => {
    anchor = next;
    const r = frame.getBoundingClientRect();
    const size = { width: r.width || 400, height: r.height || 200 };
    const pos = positionBox(next, size, { width: window.innerWidth, height: window.innerHeight });
    frame.style.left = `${pos.left}px`;
    frame.style.top = `${pos.top}px`;
  };
  reposition(o.anchor);

  return {
    el: frame,
    focus: () => {
      frame.focus();
      post({ type: "focus" });
    },
    setBusy: (busy) => post({ type: "busy", busy }),
    setStatus: (kind, text) => post({ type: "status", kind, text }),
    reposition,
    destroy: () => {
      port.close();
      frame.remove();
    },
  };
}
