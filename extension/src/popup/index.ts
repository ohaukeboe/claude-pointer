// Toolbar popup: pick button, target session (FR-011), session change, send history (US4),
// and for feature 002 the delivery mode, watch state and pick-up status of each send.

import type { Session, SessionSuggestion } from "../../../shared/types";
import { ext } from "../lib/browser";
import type { PopupCall, BackgroundCall } from "../lib/messages";
import type { HistoryEntry, HistoryState } from "../background/history";
import css from "./popup.css";
import { REASON_LABEL, modeSuffix } from "../content/overlay/session-chooser";

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
        ` · ${REASON_LABEL[s.reason]}${modeSuffix(s.session)}`,
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

const STATE_LABEL: Record<HistoryState, string> = {
  delivered: "delivered",
  failed: "failed",
  waiting: "Waiting",
  "picked-up": "Picked up",
  "not-picked-up": "Not picked up",
};

/** Watch state of a no-channel target (feature 002 FR-004, FR-013). */
function watchLabel(target: Session): string | null {
  if (target.mode !== "no-channel") return null;
  if (target.watch === "busy") return "Watching (busy)";
  if (target.watch === "waiting" || target.watch === "gap") return "Watching";
  return "Not watching — type /mcp__claude-pointer__comments";
}

function historyRow(h: HistoryEntry, origin: string): HTMLElement {
  const extra: Node[] = [];
  if (h.error) extra.push(el("span", { class: "error" }, h.error));
  if (h.state === "not-picked-up" && h.comments) {
    const again = el("button", { type: "button", "data-action": "resend" }, "Resend");
    again.addEventListener("click", async () => {
      await call({ type: "resend", origin, batchId: h.batchId });
      await render();
    });
    extra.push(again);
  }
  return el(
    "li",
    { "data-batch": h.batchId, "data-state": h.state },
    el("span", {}, `${h.count} comment${h.count === 1 ? "" : "s"} → ${h.projectName}`),
    el("span", { class: `state-${h.state}` }, STATE_LABEL[h.state] ?? h.state),
    el("span", { class: "muted" }, new Date(h.sentAt).toLocaleTimeString()),
    ...(extra.length ? extra : [el("span")]),
  );
}

function history(entries: HistoryEntry[] | undefined, origin: string): HTMLElement | null {
  if (!entries || entries.length === 0) return null;
  return el(
    "section",
    { id: "history" },
    el("h2", {}, "Recent sends"),
    el("ul", { class: "history" }, ...entries.map((h) => historyRow(h, origin))),
  );
}

const POLL_MS = 1000;
let poll: ReturnType<typeof setInterval> | null = null;

/**
 * While the popup is open: refresh waiting sends and the target's watch state once per
 * second (research R17), and stop when there is nothing left to follow.
 */
function startPolling(state: Extract<State, { available: true }>): void {
  if (poll !== null) clearInterval(poll);
  poll = null;
  const follows = (entries: HistoryEntry[] | undefined, target: Session | null) =>
    (entries ?? []).some((h) => h.state === "waiting") || target?.mode === "no-channel";
  if (!follows(state.history, state.target)) return;
  let busy = false;
  poll = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const entries = await call<HistoryEntry[]>({ type: "batch-status", origin: state.origin });
      const section = history(entries, state.origin);
      const old = doc.getElementById("history");
      if (section && old) old.replaceWith(section);
      let target = state.target;
      if (target?.mode === "no-channel") {
        const fresh = await call<State>({ type: "popup-state", tabId });
        if (fresh.available && fresh.target) {
          target = fresh.target;
          const label = watchLabel(target);
          const w = doc.getElementById("watch");
          if (w && label) w.textContent = label;
        }
      }
      if (!follows(entries, target) && poll !== null) {
        clearInterval(poll);
        poll = null;
      }
    } finally {
      busy = false;
    }
  }, POLL_MS);
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
          state.target.mode ? el("span", { class: "muted" }, modeSuffix(state.target)) : "",
          el("br"),
          el("span", { class: "mono muted" }, state.target.projectDir),
        ),
        change,
      ),
    );
    const watch = watchLabel(state.target);
    if (watch) targetSection.append(el("p", { id: "watch", class: "muted" }, watch));
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
  const h = history(state.history, state.origin);
  if (h) parts.push(h);
  app.replaceChildren(...parts);
  startPolling(state);
}

void render();
