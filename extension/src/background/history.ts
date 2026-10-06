// Send history per origin, last 20 entries (US4, data-model "history:<origin>").

import { ext } from "../lib/browser";

export interface HistoryEntry {
  batchId: string;
  sentAt: string;
  count: number;
  sessionId: string;
  projectName: string;
  state: "delivered" | "failed";
  error: string | null;
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
