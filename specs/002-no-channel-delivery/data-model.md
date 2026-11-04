# Data Model: Delivery Without Channels

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

Changes to [feature 001's data model](../001-element-comment-picker/data-model.md). Types stay
in `shared/types.ts`. Entities not listed here are unchanged.

## Session (changed)

Two fields added. Both come from the server's `info` answer and can change while the session
runs.

- `mode`: `"channel" | "no-channel"`. Set at server start from `--no-push` (R15).
- `watch`: `"off" | "waiting" | "busy" | "gap"`. See Watch below. Always `"off"` in channel
  mode.

## InboxEntry (new, helper only)

One delivered batch held by the session's MCP server. Memory only (FR-005).

- `batch`: `Batch`, validated again on arrival.
- `receivedAt`: epoch ms.
- `pushed`: `boolean`. True when the server also pushed it as a channel event.
- `state`: `"waiting" | "picked-up"`.
- `pickedUpAt`: epoch ms or `null`.

**Transitions**

```text
deliver ──▶ waiting ──pick_up_comments──▶ picked-up
              │
              └── session ends ──▶ (gone; the extension shows not-picked-up)
```

**Limits** (R16)

- Waiting and not pushed: max 50. A 51st `deliver` fails with `inbox-full`.
- Waiting and pushed: max 50. The oldest is dropped when a new one arrives.
- Picked up: only `{batchId, pickedUpAt}` kept, last 200.
- A known `batch.id` on `deliver` returns the first answer; nothing is added.

## Watch (new, helper only)

One per session, no-channel mode only (R13).

- `state`: `"off" | "waiting" | "busy" | "gap"`.
- `since`: epoch ms of the last state change.
- `idleSince`: epoch ms of watch start or of the last comment arrival, whichever is later.
- `openWait`: the open `wait` connection, or `null`.

```text
off ──watch start──▶ gap ──wait opens──▶ waiting
waiting ──comment arrives / waiting comments exist──▶ busy  (wait answers "comments")
waiting ──45 min──▶ gap                                     (wait answers "timeout")
busy | gap ──wait opens──▶ waiting
gap ──120 s without wait──▶ off
any ──8 h since idleSince──▶ off                             (open wait answers "expired")
any ──watch stop──▶ off                                      (open wait answers "stopped")
waiting ──second wait opens──▶ waiting                       (old wait answers "replaced")
```

## HistoryEntry (changed, extension)

Stored under `history:<origin>` as before, still the last 20.

- `state`: adds `"waiting" | "picked-up" | "not-picked-up"` to `"delivered" | "failed"`.
  - channel mode, `deliver` ok → `delivered` (as feature 001).
  - no-channel mode, `deliver` ok → `waiting`.
  - `waiting` → `picked-up` when `batch-status` says so.
  - `waiting` → `not-picked-up` when `batch-status` answers `session-gone`.
- `pageKey`: `string`, the `pending:<origin><pathname>` key the comments came from.
- `comments`: `Comment[] | null`. Kept while `waiting` or `not-picked-up`; set to `null` on
  `picked-up` (FR-016). **Resend** appends them to `pageKey` with state `pending` and removes
  the history entry.

## Comment (unchanged)

The `CommentState` values stay as in feature 001. Pick-up states live on `HistoryEntry`
because they describe a batch, not a comment in the page's pending list.

## Error codes (changed)

Add `inbox-full`: the session already has 50 waiting batches. Extension behaviour: mark
failed, keep the comments, message "Claude has 50 unread batches; ask it to pick them up".
