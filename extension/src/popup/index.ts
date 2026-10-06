// Toolbar popup: pick button, target session (FR-011), session change, send history (US4).

import type { Session, SessionSuggestion } from "../../../shared/types";
import { ext } from "../lib/browser";
import type { PopupCall, BackgroundCall } from "../lib/messages";
import type { HistoryEntry } from "../background/history";
import css from "./popup.css";
import { REASON_LABEL } from "../content/overlay/session-chooser";

type State =
  | { available: false; message: string }
  | {
      available: true;
      origin: string;
      pageUrl: string;
      target: Session | null;
      staleBinding: boolean;
      sessions: SessionSuggestion[];
      hostError: string | null;
      history?: HistoryEntry[];
    };

const doc = document;
const style = doc.createElement("style");
style.textContent = css;
doc.head.append(style);
const app = doc.getElementById("app")!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

const call = <T>(msg: PopupCall | BackgroundCall) => ext.sendMessage<T>(msg);
const tabParam = new URLSearchParams(location.search).get("tab");
const tabId = tabParam === null ? undefined : Number(tabParam);

function sessionList(state: Extract<State, { available: true }>): HTMLElement {
  if (state.sessions.length === 0) {
    return el(
      "p",
      { class: "muted" },
      "No sessions running. Start one with ",
      el("kbd", {}, "npx claude-pointer claude"),
      ".",
    );
  }
  return el(
    "ul",
    { class: "sessions" },
    ...state.sessions.map((s) => {
      const b = el(
        "button",
        { type: "button", "data-session": s.session.id },
        el("strong", {}, s.session.projectName),
        ` · ${REASON_LABEL[s.reason]}`,
        el("br"),
        el("span", { class: "mono muted" }, s.session.projectDir),
      );
      b.addEventListener("click", async () => {
        await call({ type: "confirm-target", pageUrl: state.pageUrl, session: s.session });
        await render();
      });
      return el("li", {}, b);
    }),
  );
}

function history(entries: HistoryEntry[] | undefined): HTMLElement | null {
  if (!entries || entries.length === 0) return null;
  return el(
    "section",
    {},
    el("h2", {}, "Recent sends"),
    el(
      "ul",
      { class: "history" },
      ...entries.map((h) =>
        el(
          "li",
          { "data-batch": h.batchId },
          el("span", {}, `${h.count} comment${h.count === 1 ? "" : "s"} → ${h.projectName}`),
          el("span", { class: `state-${h.state}` }, h.state),
          el("span", { class: "muted" }, new Date(h.sentAt).toLocaleTimeString()),
          h.error ? el("span", { class: "error" }, h.error) : el("span"),
        ),
      ),
    ),
  );
}

async function render(): Promise<void> {
  const state = await call<State>({ type: "popup-state", tabId });
  const pick = el("button", { class: "primary", type: "button", id: "pick" }, "Pick element");
  pick.addEventListener("click", async () => {
    const r = await call<{ ok: boolean; message?: string }>({ type: "toggle-picker", tabId });
    if (r.ok) window.close();
    else app.prepend(el("p", { class: "error" }, r.message ?? "Cannot start pick mode."));
  });

  const parts: Node[] = [
    el(
      "div",
      { class: "row" },
      el("h1", {}, "Claude Pointer"),
      el("span", { class: "muted" }, "Ctrl+Shift+Y"),
    ),
  ];
  if (!state.available) {
    parts.push(el("p", { class: "error", id: "unavailable" }, state.message));
    app.replaceChildren(...parts);
    return;
  }
  parts.push(pick);
  if (state.hostError) parts.push(el("p", { class: "error", id: "host-error" }, state.hostError));

  const targetSection = el(
    "section",
    { id: "target" },
    el("h2", {}, `Comments from ${state.origin} go to`),
  );
  if (state.target) {
    const change = el("button", { type: "button", id: "change" }, "Change");
    targetSection.append(
      el(
        "div",
        { class: "row" },
        el(
          "p",
          {},
          el("strong", {}, state.target.projectName),
          el("br"),
          el("span", { class: "mono muted" }, state.target.projectDir),
        ),
        change,
      ),
    );
    change.addEventListener("click", () => {
      change.replaceWith(sessionList(state));
    });
  } else {
    targetSection.append(
      el(
        "p",
        { class: "muted" },
        state.staleBinding
          ? "The chosen session has ended. Choose another:"
          : "Not chosen yet. Choose a session:",
      ),
      sessionList(state),
    );
  }
  parts.push(targetSection);
  const h = history(state.history);
  if (h) parts.push(h);
  app.replaceChildren(...parts);
}

void render();
