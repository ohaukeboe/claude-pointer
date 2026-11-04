# Contract: Extension ↔ Native Host — additions

Extends [feature 001's native messaging contract](../../001-element-comment-picker/contracts/native-messaging.md).
Host name, framing, one request per host start and `v: 1` are unchanged.

## `list-sessions` (changed)

Each `session` gains `mode` and `watch`, copied from the socket's `info` answer.

## `send-batch` (changed)

The success answer gains `status` (`"pushed"` or `"waiting"`), copied from `deliver`.
The extension stores `delivered` for `pushed` and `waiting` for `waiting`.

## `batch-status` (new)

Request:

```json
{ "v": 1, "type": "batch-status", "sessionId": "48213-91722345", "batchIds": ["a", "b"] }
```

Response: the socket's `status` answer, passed through unchanged. Errors: `session-gone`
(socket missing or refused), `timeout`, `invalid-request`.

The popup sends one `batch-status` per session per second while it is open, only for
history entries in state `waiting` (R17).

## Error codes (changed)

| Code         | Meaning                                 | Extension behaviour            |
|--------------|-----------------------------------------|--------------------------------|
| `inbox-full` | Session already holds 50 unread batches | Mark failed; keep the comments |
