// Send history per origin, last 20 entries (US4, data-model "history:<origin>"), plus the
// pick-up states of feature 002 (specs/002-no-channel-delivery/data-model.md "HistoryEntry").

import type { BatchStatus, Comment } from "../../../shared/types";
import { ext } from "../lib/browser";

export type HistoryState = "delivered" | "failed" | "waiting" | "picked-up" | "not-picked-up";

export interface HistoryEntry {
  batchId: string;
  sentAt: string;
  count: number;
  sessionId: string;
  projectName: string;
  state: HistoryState;
  error: string | null;
  /** `pending:<origin><pathname>` the comments came from; absent before feature 002. */
  pageKey?: string;
  /** Kept while `waiting` or `not-picked-up` so the batch can be resent (FR-016). */
  comments?: Comment[] | null;
}

export const HISTORY_LIMIT = 20;
const key = (origin: string) => `history:${origin}`;

export async function getHistory(origin: string): Promise<HistoryEntry[]> {
  return (await ext.storageGet<HistoryEntry[]>(key(origin))) ?? [];
}

/** Newest first; a retry with the same batchId replaces its entry. */
export async function recordSend(origin: string, entry: HistoryEntry): Promise<void> {
  const rest = (await getHistory(origin)).filter((h) => h.batchId !== entry.batchId);
  await ext.storageSet({ [key(origin)]: [entry, ...rest].slice(0, HISTORY_LIMIT) });
}

async function update(
  origin: string,
  change: (h: HistoryEntry) => HistoryEntry,
): Promise<HistoryEntry[]> {
  const next = (await getHistory(origin)).map(change);
  await ext.storageSet({ [key(origin)]: next });
  return next;
}

/** Apply a `batch-status` answer; `unknown` leaves the entry as it is. */
export function applyStatuses(origin: string, statuses: BatchStatus[]): Promise<HistoryEntry[]> {
  const picked = new Set(statuses.filter((s) => s.state === "picked-up").map((s) => s.batchId));
  return update(origin, (h) =>
    h.state === "waiting" && picked.has(h.batchId)
      ? { ...h, state: "picked-up", comments: null }
      : h,
  );
}

/** The session ended: its waiting batches will never be picked up. */
export function markSessionGone(origin: string, sessionId: string): Promise<HistoryEntry[]> {
  return update(origin, (h) =>
    h.state === "waiting" && h.sessionId === sessionId ? { ...h, state: "not-picked-up" } : h,
  );
}

/** Put a batch's comments back on its page as pending comments and drop the entry. */
export async function resend(origin: string, batchId: string): Promise<boolean> {
  const all = await getHistory(origin);
  const entry = all.find((h) => h.batchId === batchId);
  if (!entry?.pageKey || !entry.comments) return false;
  const pending = (await ext.storageGet<Comment[]>(entry.pageKey)) ?? [];
  const back = entry.comments
    .filter((c) => !pending.some((p) => p.id === c.id))
    .map((c) => ({ ...c, state: "pending" as const, error: null }));
  await ext.storageSet({
    [entry.pageKey]: [...pending, ...back],
    [key(origin)]: all.filter((h) => h.batchId !== batchId),
  });
  return true;
}
