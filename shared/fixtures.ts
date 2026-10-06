// Test fixtures shared by helper and extension tests.
import type { Batch, Comment, Selection } from "./types";

export function makeSelection(over: Partial<Selection> = {}): Selection {
  return {
    url: "http://localhost:5173/admin",
    title: "Admin",
    selector: "main > table.queue",
    tag: "table",
    id: null,
    classes: ["queue"],
    text: "Review queue",
    html: '<table class="queue"></table>',
    rect: { x: 1, y: 2, width: 300, height: 200 },
    viewport: { width: 1280, height: 800 },
    source: null,
    frame: null,
    ...over,
  };
}

export function makeComment(over: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    text: "make it denser",
    selection: makeSelection(),
    createdAt: "2026-10-06T17:00:00.000Z",
    state: "pending",
    error: null,
    ...over,
  };
}

export function makeBatch(over: Partial<Batch> = {}): Batch {
  return {
    id: "b1",
    sessionId: "100-200",
    pageUrl: "http://localhost:5173/admin",
    comments: [makeComment()],
    ...over,
  };
}
