# Contract: Extension ↔ Native Host (Firefox native messaging)

Host name: `claude_pointer`. Manifest: `~/.mozilla/native-messaging-hosts/claude_pointer.json`.

```json
{
  "name": "claude_pointer",
  "description": "Claude Pointer bridge to Claude Code sessions",
  "path": "/absolute/path/to/claude-pointer-native-host",
  "type": "stdio",
  "allowed_extensions": ["claude-pointer@ohaukeboe"]
}
```

The extension calls `browser.runtime.sendNativeMessage("claude_pointer", request)`. One
request, one response, then the host exits. Framing is Firefox's standard (4-byte native-endian
length + UTF-8 JSON). Max request 1 MB (Firefox limit 4 GB; ours is a sanity bound).

Every request has `v: 1` and `type`. Every response has `v: 1` and `ok`. Unknown `v` →
`{ ok: false, error: { code: "unsupported-version" } }`.

## `list-sessions`

Request:

```json
{ "v": 1, "type": "list-sessions", "pageUrl": "http://localhost:5173/admin", "pageTitle": "Admin" }
```

Response:

```json
{
  "v": 1,
  "ok": true,
  "sessions": [
    {
      "session": {
        "id": "48213-91722345",
        "projectDir": "/home/oskar/projects/shelf",
        "projectName": "shelf",
        "startedAt": "2026-10-06T17:02:11Z"
      },
      "reason": "port-owner",
      "score": 100
    }
  ]
}
```

- Sorted best first (research R3). Empty array when no session is running.
- `socketPath` is never exposed.

## `send-batch`

Request:

```json
{
  "v": 1,
  "type": "send-batch",
  "sessionId": "48213-91722345",
  "batch": { "id": "uuid", "pageUrl": "…", "comments": [ /* Comment, see data-model.md */ ] }
}
```

Success response (the channel server has accepted the batch and emitted the MCP notification):

```json
{ "v": 1, "ok": true, "batchId": "uuid", "deliveredAt": "2026-10-06T17:05:00Z" }
```

Failure response:

```json
{ "v": 1, "ok": false, "error": { "code": "session-gone", "message": "Session shelf (48213) has ended." } }
```

## Error codes

| Code | Meaning | Extension behaviour |
|------|---------|---------------------|
| `session-gone` | No socket for `sessionId`, or it refused connection. | Mark failed; ask user to pick a session (US2 scenario 4). |
| `timeout` | Channel server did not answer within 1500 ms. | Mark failed; offer retry. |
| `invalid-request` | Schema validation failed. | Mark failed; log; this is a bug. |
| `too-large` | Batch over 1 MB after serialisation. | Mark failed; ask user to shorten. |
| `unsupported-version` | `v` not understood. | Show "update the helper". |
| `internal` | Anything else. | Mark failed; offer retry. |

If the native host is not installed, Firefox rejects `sendNativeMessage`; the extension shows
setup instructions (link to quickstart) instead of an error code.

## Guarantees

- `send-batch` reaches **only** the socket named by `sessionId`. The host never falls back to
  another session (FR-013).
- Retrying with the same `batch.id` within 10 minutes is idempotent: the channel server
  answers `ok` without emitting a second notification.
