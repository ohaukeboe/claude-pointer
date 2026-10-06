# Data Model: Element Comment Picker

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

Types are shared by the extension and the helper from `shared/types.ts`. Wire formats are in
[contracts/](./contracts/).

## Selection

One picked element. Built in the content script; immutable after creation.

| Field | Type | Rule |
|-------|------|------|
| `url` | string | Full page URL at pick time. |
| `title` | string | `document.title`, max 200 chars. |
| `selector` | string | Unique CSS selector path; `document.querySelectorAll(selector)` MUST return exactly this element at pick time. |
| `tag` | string | Lower-case tag name. |
| `id` | string \| null | Element `id`, if any. |
| `classes` | string[] | Max 20 entries. |
| `text` | string | Visible text (`innerText`), whitespace-collapsed, max 500 chars, `…` if cut. |
| `html` | string | `outerHTML`, sanitised (R9), max 4096 chars, `…` if cut. |
| `rect` | `{x, y, width, height}` | Page coordinates in CSS px, integers. |
| `viewport` | `{width, height}` | `innerWidth`/`innerHeight` at pick time. |
| `source` | `SourceHint \| null` | From page-world probe (R7). |
| `frame` | string \| null | Frame URL if the element is inside an iframe, else `null`. |

**SourceHint**: `{ component: string | null, file: string | null, line: number | null,
column: number | null, via: "attribute" | "svelte" | "vue" | "react" }`.

## Comment

| Field | Type | Rule |
|-------|------|------|
| `id` | string | Random UUID. |
| `text` | string | Trimmed. Non-empty (FR-007). Max 10 000 chars. |
| `selection` | Selection | Exactly one. |
| `createdAt` | string | ISO 8601. |
| `state` | `"draft" \| "pending" \| "sending" \| "delivered" \| "failed"` | See transitions. |
| `error` | string \| null | Set only in `failed`. |

**State transitions**

```text
draft ──Add comment──▶ pending ──Send──▶ sending ──ok──▶ delivered
  │                       ▲                 │
  └──Send to Claude───────┼────▶ sending    └──error──▶ failed ──retry / pick other session──▶ sending
                          └──────── edit (text only) ┘
draft ──close/Escape──▶ (discarded)
pending ──delete──▶ (discarded)
```

- `failed` keeps text and selection (FR-016, SC-006).
- `delivered` comments leave pending storage and go to history.

## Batch

One send. Created when the user presses **Send to Claude**.

| Field | Type | Rule |
|-------|------|------|
| `id` | string | Random UUID; idempotency key for retries. |
| `sessionId` | string | Target session. Exactly one (FR-013). |
| `pageUrl` | string | Page the batch was sent from. |
| `comments` | Comment[] | 1–50, in creation order. |

## Session

One running Claude Code session with the channel server attached. Owned by the helper;
the extension only sees a snapshot.

| Field | Type | Rule |
|-------|------|------|
| `id` | string | `<claudePid>-<processStartTicks>` — unique even after PID reuse. |
| `projectDir` | string | Absolute path; channel server `process.cwd()`. |
| `projectName` | string | `basename(projectDir)`. |
| `startedAt` | string | ISO 8601. |
| `socketPath` | string | `$XDG_RUNTIME_DIR/claude-pointer/<id>.sock`. Helper-internal; not sent to the extension. |

**Lifecycle**: socket created when the channel server starts; removed on exit. The native
host treats a socket that refuses connection as stale and deletes it.

## SessionSuggestion

Returned by `list-sessions` (see contracts). `{ session: Session, reason: "port-owner" |
"name-match" | "recent", score: number }`, sorted best first.

## SiteBinding

Stored in `browser.storage.local` under `binding:<origin>`.

| Field | Type | Rule |
|-------|------|------|
| `origin` | string | `URL.origin` of the page. |
| `sessionId` | string | Confirmed target. |
| `projectDir` | string | For display, and to pre-select a session with the same project if the old one ended. |
| `confirmedAt` | string | ISO 8601. |

Valid only while `sessionId` is in the current session list; otherwise the user is asked again
(FR-010).

## Stored keys (`browser.storage.local`)

| Key | Value |
|-----|-------|
| `pending:<origin><pathname>` | `Comment[]` with state `pending` or `failed` |
| `binding:<origin>` | `SiteBinding` |
| `history:<origin>` | last 20 `{ batchId, sentAt, count, sessionId, projectName, state, error }` |
