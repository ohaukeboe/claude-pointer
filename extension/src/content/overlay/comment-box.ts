// Comment box anchored to the selected element (FR-006, FR-007).

import { LIMITS } from "../../../../shared/validate";
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
  textarea: HTMLTextAreaElement;
  focus(): void;
  setBusy(busy: boolean): void;
  setStatus(kind: "info" | "ok" | "error", text: string): void;
  reposition(anchor: Box): void;
  destroy(): void;
}

const fmt = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");

export function createCommentBox(o: CommentBoxOptions, doc: Document = document): CommentBox {
  const textarea = h(doc, "textarea", {
    "aria-label": "Comment",
    placeholder: "Describe the issue or suggestion…",
    rows: "4",
  });
  textarea.value = o.initialText ?? "";
  const status = h(doc, "div", {
    class: "status",
    "data-role": "status",
    role: "status",
    "aria-live": "polite",
  });
  const close = h(
    doc,
    "button",
    { class: "icon", type: "button", "data-action": "close", "aria-label": "Close" },
    "×",
  );
  const add = h(
    doc,
    "button",
    { type: "button", "data-action": "add", hidden: !o.allowAdd },
    o.addLabel ?? "Add comment",
  );
  const del = h(
    doc,
    "button",
    { type: "button", "data-action": "delete", hidden: !o.onDelete },
    "Delete",
  );
  const send = h(
    doc,
    "button",
    { class: "primary", type: "button", "data-action": "send" },
    "Send to Claude",
  );
  const el = h(
    doc,
    "section",
    { class: "panel comment-box", role: "dialog", "aria-label": "Comment on element" },
    h(
      doc,
      "div",
      { class: "panel-head" },
      h(doc, "span", { class: "panel-title" }, "Comment"),
      h(doc, "span", { class: "panel-label", "data-role": "label", title: o.label }, o.label),
      close,
    ),
    textarea,
    status,
    h(doc, "div", { class: "actions" }, del, add, send),
  );

  let busy = false;
  let lengthError = false;
  const text = () => textarea.value.trim();
  const refresh = () => {
    const len = text().length;
    const empty = len === 0;
    const tooLong = len > LIMITS.commentText;
    send.disabled = busy || empty || tooLong;
    add.disabled = send.disabled;
    if (tooLong) {
      lengthError = true;
      setStatus(
        "error",
        `Comment is too long (${fmt(len)} / ${fmt(LIMITS.commentText)} characters).`,
      );
    } else if (lengthError) {
      lengthError = false;
      setStatus("info", "");
    }
  };
  const setStatus = (kind: "info" | "ok" | "error", message: string) => {
    status.setAttribute("data-kind", kind);
    status.textContent = message;
  };
  const submit = (fn: (t: string) => void) => {
    refresh();
    if (!send.disabled) fn(text());
  };

  textarea.addEventListener("input", refresh);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      o.onClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit(o.onSend);
    }
  });
  send.addEventListener("click", () => submit(o.onSend));
  add.addEventListener("click", () => submit(o.onAdd));
  close.addEventListener("click", () => o.onClose());
  del.addEventListener("click", () => o.onDelete?.());
  refresh();

  const reposition = (anchor: Box) => {
    const r = el.getBoundingClientRect();
    const size = { width: r.width || 400, height: r.height || 200 };
    const pos = positionBox(anchor, size, { width: window.innerWidth, height: window.innerHeight });
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
  };
  reposition(o.anchor);

  return {
    el,
    textarea,
    focus: () => textarea.focus(),
    setBusy: (b) => {
      busy = b;
      textarea.readOnly = b;
      refresh();
    },
    setStatus,
    reposition,
    destroy: () => el.remove(),
  };
}
