// Background message handling, separate from listener registration so it is unit-testable.

import type { BackgroundCall, PopupCall } from "../lib/messages";
import { ext, type TabInfo } from "../lib/browser";
import { clearBinding, getBinding, originOf, setBinding } from "./binding";
import { pendingKey } from "../content/pending";
import {
  applyStatuses,
  getHistory,
  markSessionGone,
  recordSend,
  resend,
  type HistoryEntry,
} from "./history";
import { batchStatus, listSessions, resolveTarget, sendComments } from "./send";

export const UNAVAILABLE_MESSAGE = "Pick mode is not available on this page.";

export function canPick(url: string): boolean {
  return /^(https?|file):/i.test(url);
}

export async function togglePicker(
  tab: TabInfo | undefined,
): Promise<{ ok: boolean; message?: string }> {
  if (!tab) return { ok: false, message: "No active tab." };
  if (!canPick(tab.url)) {
    await ext.setBadge(tab.id, "!", UNAVAILABLE_MESSAGE);
    return { ok: false, message: UNAVAILABLE_MESSAGE };
  }
  try {
    await ext.injectContent(tab.id);
  } catch {
    await ext.setBadge(tab.id, "!", UNAVAILABLE_MESSAGE);
    return { ok: false, message: UNAVAILABLE_MESSAGE };
  }
  await ext.setBadge(tab.id, "", "Claude Pointer");
  try {
    await ext.injectPageWorld(tab.id); // optional source hints (research R7)
  } catch {
    // Page world blocked (e.g. sandboxed frame): hints are optional.
  }
  await ext.sendToTab(tab.id, { type: "toggle" });
  return { ok: true };
}

export async function popupState(tab: TabInfo | undefined) {
  if (!tab || !canPick(tab.url)) return { available: false as const, message: UNAVAILABLE_MESSAGE };
  const origin = originOf(tab.url);
  const [binding, listed, history] = await Promise.all([
    getBinding(origin),
    listSessions(tab.url, tab.title),
    getHistory(origin),
  ]);
  const sessions = "ok" in listed ? listed.sessions : [];
  const target = binding
    ? (sessions.find((s) => s.session.id === binding.sessionId)?.session ?? null)
    : null;
  return {
    available: true as const,
    origin,
    pageUrl: tab.url,
    target,
    staleBinding: binding !== undefined && target === null,
    sessions,
    hostError: "ok" in listed ? null : listed.message,
    history,
  };
}

const STATUS_IDS_MAX = 20;

/** One `batch-status` per session for this origin's waiting sends (research R17). */
export async function refreshStatuses(origin: string): Promise<HistoryEntry[]> {
  const bySession = new Map<string, string[]>();
  for (const h of await getHistory(origin)) {
    if (h.state !== "waiting") continue;
    bySession.set(h.sessionId, [...(bySession.get(h.sessionId) ?? []), h.batchId]);
  }
  for (const [sessionId, ids] of bySession) {
    const res = await batchStatus(sessionId, ids.slice(0, STATUS_IDS_MAX));
    if (res.ok) await applyStatuses(origin, res.statuses);
    else if (res.code === "session-gone") await markSessionGone(origin, sessionId);
  }
  return getHistory(origin);
}

/** The popup acts on the active tab; `tabId` lets a popup opened in its own tab target another. */
function tabFor(tabId: number | undefined): Promise<TabInfo | undefined> {
  return tabId === undefined ? ext.activeTab() : ext.getTab(tabId);
}

export async function handleMessage(msg: BackgroundCall | PopupCall): Promise<unknown> {
  switch (msg.type) {
    case "resolve-target":
      return resolveTarget(msg.pageUrl, msg.pageTitle);
    case "list-sessions":
      return listSessions(msg.pageUrl, msg.pageTitle);
    case "confirm-target":
      return setBinding(originOf(msg.pageUrl), msg.session);
    case "send": {
      const res = await sendComments(msg);
      const waiting = res.ok && res.status === "waiting";
      await recordSend(originOf(msg.pageUrl), {
        batchId: res.batchId,
        sentAt: new Date().toISOString(),
        count: msg.comments.length,
        sessionId: msg.sessionId,
        projectName: msg.projectName,
        state: res.ok ? (waiting ? "waiting" : "delivered") : "failed",
        error: res.ok ? null : res.message,
        pageKey: pendingKey(msg.pageUrl),
        comments: waiting ? msg.comments : null,
      });
      return res;
    }
    case "toggle-picker":
      return togglePicker(await tabFor(msg.tabId));
    case "popup-state":
      return popupState(await tabFor(msg.tabId));
    case "forget-target":
      return clearBinding(originOf(msg.pageUrl));
    case "batch-status":
      return refreshStatuses(msg.origin);
    case "resend":
      return resend(msg.origin, msg.batchId);
    default:
      return undefined;
  }
}
