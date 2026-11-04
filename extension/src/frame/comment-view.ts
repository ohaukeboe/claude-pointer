// Comment box view inside the extension frame (FR-006, FR-007). Page scripts cannot see
// events here; the content script drives it over a MessagePort.

import { LIMITS } from "../../../shared/validate";
import { h } from "../content/overlay/root";
import type { FrameHandshake, FrameMessage, ViewMessage } from "./protocol";

/**
 * Resolves with the port from the first handshake that carries `nonce`. The page can post
 * to this frame too (window.frames), but it cannot read the nonce in our URL.
 */
export function acceptPort(win: Window, nonce: string): Promise<MessagePort> {
  return new Promise((resolve) => {
    if (!nonce) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as Partial<FrameHandshake> | null;
      const port = e.ports[0];
      if (d?.type !== "claude-pointer-init" || d.nonce !== nonce || !port) return;
      win.removeEventListener("message", onMessage);
      resolve(port);
    };
    win.addEventListener("message", onMessage);
  });
}

const fmt = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");

export function createCommentView(port: MessagePort, doc: Document, mount: HTMLElement): void {
  const post = (m: FrameMessage) => port.postMessage(m);
  let textarea: HTMLTextAreaElement | null = null;
  let panel: HTMLElement | null = null;
  let busy = false;
  let refresh = () => {};
  let setStatus = (_kind: "info" | "ok" | "error", _text: string) => {};

  const reportSize = () => {
    if (panel) post({ type: "size", height: Math.ceil(panel.getBoundingClientRect().height) });
  };

  const render = (o: Extract<ViewMessage, { type: "init" }>) => {
    const ta = h(doc, "textarea", {
      "aria-label": "Comment",
      placeholder: "Describe the issue or suggestion…",
      rows: "4",
    });
    ta.value = o.initialText ?? "";
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
      { type: "button", "data-action": "delete", hidden: !o.canDelete },
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
      ta,
      status,
      h(doc, "div", { class: "actions" }, del, add, send),
    );

    let lengthError = false;
    const text = () => ta.value.trim();
    setStatus = (kind, message) => {
      status.setAttribute("data-kind", kind);
      status.textContent = message;
      reportSize();
    };
    refresh = () => {
      const len = text().length;
      const tooLong = len > LIMITS.commentText;
      send.disabled = busy || len === 0 || tooLong;
      add.disabled = send.disabled;
      ta.readOnly = busy;
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
    const submit = (type: "send" | "add") => {
      refresh();
      if (!send.disabled) post({ type, text: text() });
    };

    ta.addEventListener("input", refresh);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        post({ type: "close" });
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit("send");
      }
    });
    send.addEventListener("click", () => submit("send"));
    add.addEventListener("click", () => submit("add"));
    close.addEventListener("click", () => post({ type: "close" }));
    del.addEventListener("click", () => post({ type: "delete" }));

    mount.replaceChildren(el);
    // The user can drag the textarea taller; the frame must follow.
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(reportSize).observe(el);
    textarea = ta;
    panel = el;
    refresh();
    ta.focus();
    reportSize();
  };

  port.onmessage = (e: MessageEvent<ViewMessage>) => {
    const m = e.data;
    switch (m.type) {
      case "init":
        render(m);
        return;
      case "busy":
        busy = m.busy;
        refresh();
        return;
      case "status":
        setStatus(m.kind, m.text);
        return;
      case "focus":
        textarea?.focus();
        return;
    }
  };
}
