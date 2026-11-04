# Contract: Session Socket — additions

Extends [feature 001's session socket](../../001-element-comment-picker/contracts/session-socket.md).
Directory, socket permissions, framing and `v: 1` are unchanged. All additions are new
fields or new request types; an older native host keeps working.

Clients: the native host (`info`, `deliver`, `status`), `claude-pointer wait` (`wait`) and
`claude-pointer notice` (`peek`).

## `info` (changed)

`session` gains `mode` and `watch` (see [data-model.md](../data-model.md)):

```json
{ "v": 1, "ok": true, "session": { "id": "…", "projectDir": "…", "projectName": "…",
  "startedAt": "…", "mode": "no-channel", "watch": "waiting" } }
```

## `deliver` (changed)

Every accepted batch enters the inbox (R16). The success answer gains `status`:

```json
{ "v": 1, "ok": true, "batchId": "…", "deliveredAt": "…", "status": "waiting" }
```

- `status: "pushed"` in channel mode, `"waiting"` in no-channel mode.
- New failure: `inbox-full`.
- A known `batchId` returns the first answer unchanged.
- In no-channel mode, if a `wait` is open it answers `comments` right after this reply.

## `status` (new)

Request: `{"v":1,"type":"status","batchIds":["a","b"]}` (1–20 ids).

Response:

```json
{ "v": 1, "ok": true, "statuses": [
  { "batchId": "a", "state": "picked-up", "at": "2026-11-04T17:05:00Z" },
  { "batchId": "b", "state": "waiting", "at": null } ] }
```

`state` is `waiting`, `picked-up`, or `unknown` (never seen, or dropped by the limits).

## `peek` (new)

Request: `{"v":1,"type":"peek"}`

Response: `{"v":1,"ok":true,"waiting":2,"pages":["http://localhost:5173/admin"]}`

Counts waiting batches that were **not** pushed (FR-014). `pages` holds distinct `pageUrl`
values, max 5. No comment text, no element data. Does not change any state.

## `wait` (new)

Request: `{"v":1,"type":"wait"}`

The server holds the connection open and answers once:

```json
{ "v": 1, "ok": true, "outcome": "comments", "waiting": 2 }
```

| `outcome`  | When                                                          |
|------------|---------------------------------------------------------------|
| `comments` | Unpushed batches are waiting (now, or when one arrives)       |
| `timeout`  | 45 minutes passed with no comment                             |
| `expired`  | 8 hours with no comment since watch start or the last comment |
| `stopped`  | The watch is off (never started, or stopped by the user)      |
| `replaced` | A newer `wait` connection opened                              |

In channel mode the watch is always off, so `wait` answers `stopped` at once.
If the client disconnects first, the server treats it as a `timeout` for state purposes
(state `gap`). Watch state transitions are in [data-model.md](../data-model.md).
