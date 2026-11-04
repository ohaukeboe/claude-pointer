// Comment box for controller tests: the real frame view, mounted inline and driven over a
// synchronous fake port, so tests can reach its DOM through the overlay's shadow root.

import type { CommentBox, CommentBoxOptions } from "../../../src/content/overlay/comment-box";
import { createCommentView } from "../../../src/frame/comment-view";
import type { FrameMessage, ViewMessage } from "../../../src/frame/protocol";

export function inlineBox(o: CommentBoxOptions, doc: Document): CommentBox {
  const el = doc.createElement("div");
  const fromView = (m: FrameMessage) => {
    if (m.type === "send") o.onSend(m.text);
    else if (m.type === "add") o.onAdd(m.text);
    else if (m.type === "delete") o.onDelete?.();
    else if (m.type === "close") o.onClose();
  };
  const port = { onmessage: null, postMessage: fromView } as unknown as MessagePort;
  createCommentView(port, doc, el);
  const post = (m: ViewMessage) => port.onmessage!({ data: m } as MessageEvent);
  post({
    type: "init",
    label: o.label,
    allowAdd: o.allowAdd,
    addLabel: o.addLabel,
    canDelete: !!o.onDelete,
    initialText: o.initialText,
  });
  return {
    el,
    focus: () => post({ type: "focus" }),
    setBusy: (busy) => post({ type: "busy", busy }),
    setStatus: (kind, text) => post({ type: "status", kind, text }),
    reposition: () => {},
    destroy: () => el.remove(),
  };
}
