// Inbox: batches delivered to this session, held in memory until Claude picks them up
// (specs/002-no-channel-delivery/data-model.md "InboxEntry", research R16).

import type { Batch, BatchStatus } from "../../../shared/types";

export const INBOX_LIMITS = {
  /** Waiting batches that were not pushed; one more is refused with `inbox-full`. */
  waiting: 50,
  /** Pushed batches never picked up; the oldest is dropped when one more arrives. */
  pushed: 50,
  /** Picked-up records kept for status queries. */
  pickedUp: 200,
} as const;

export interface InboxEntry {
  batch: Batch;
  receivedAt: number;
  pushed: boolean;
}

interface PickedUp {
  receivedAt: number;
  pushed: boolean;
  pickedUpAt: number;
}

export type AddResult =
  { kind: "added" | "duplicate"; receivedAt: number; pushed: boolean } | { kind: "full" };

export interface TakeResult {
  entries: InboxEntry[];
  /** Batches still waiting after this take. */
  remaining: number;
}

export interface Inbox {
  add(batch: Batch, o: { pushed: boolean }): AddResult;
  /**
   * Take waiting batches oldest first while their total `measure` stays within `maxBytes`,
   * always at least one, and mark them picked up before returning.
   */
  take(maxBytes: number, measure: (entry: InboxEntry) => number): TakeResult;
  status(batchIds: string[]): BatchStatus[];
  /** Waiting batches that were not pushed: the ones a watch or a notice reports. */
  waitingCount(): number;
  /** Count and distinct pages (max 5) of unpushed waiting batches; changes nothing. */
  peek(): { waiting: number; pages: string[] };
}

const PEEK_PAGES = 5;

export function createInbox({ now = Date.now }: { now?: () => number } = {}): Inbox {
  // Map iteration order is insertion order, so `waiting` is oldest first.
  const waiting = new Map<string, InboxEntry>();
  const pickedUp = new Map<string, PickedUp>();

  const unpushed = () => [...waiting.values()].filter((e) => !e.pushed).length;

  return {
    add(batch, { pushed }) {
      const known = waiting.get(batch.id) ?? pickedUp.get(batch.id);
      if (known) return { kind: "duplicate", receivedAt: known.receivedAt, pushed: known.pushed };
      if (!pushed && unpushed() >= INBOX_LIMITS.waiting) return { kind: "full" };
      if (pushed) {
        const old = [...waiting.values()].filter((e) => e.pushed);
        if (old.length >= INBOX_LIMITS.pushed) waiting.delete(old[0]!.batch.id);
      }
      const receivedAt = now();
      waiting.set(batch.id, { batch, receivedAt, pushed });
      return { kind: "added", receivedAt, pushed };
    },

    take(maxBytes, measure) {
      // No `await` in here: two concurrent pick-ups can never take the same batch (FR-008).
      const entries: InboxEntry[] = [];
      let total = 0;
      for (const entry of waiting.values()) {
        const size = measure(entry);
        if (entries.length > 0 && total + size > maxBytes) break;
        entries.push(entry);
        total += size;
      }
      const t = now();
      for (const e of entries) {
        waiting.delete(e.batch.id);
        pickedUp.set(e.batch.id, { receivedAt: e.receivedAt, pushed: e.pushed, pickedUpAt: t });
      }
      while (pickedUp.size > INBOX_LIMITS.pickedUp) {
        pickedUp.delete(pickedUp.keys().next().value!);
      }
      return { entries, remaining: waiting.size };
    },

    status(batchIds) {
      return batchIds.map((batchId) => {
        if (waiting.has(batchId)) return { batchId, state: "waiting", at: null };
        const done = pickedUp.get(batchId);
        if (done)
          return { batchId, state: "picked-up", at: new Date(done.pickedUpAt).toISOString() };
        return { batchId, state: "unknown", at: null };
      });
    },

    waitingCount: unpushed,

    peek() {
      const unread = [...waiting.values()].filter((e) => !e.pushed);
      const pages = [...new Set(unread.map((e) => e.batch.pageUrl))].slice(0, PEEK_PAGES);
      return { waiting: unread.length, pages };
    },
  };
}
